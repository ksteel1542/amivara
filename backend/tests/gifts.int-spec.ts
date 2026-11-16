import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { OTP_SENDER } from '../src/modules/auth/otp-sender';
import { MEDIA_STORAGE } from '../src/modules/media/media-storage';
import { WalletService } from '../src/modules/wallet/wallet.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CapturingSender, createMember, FakeMediaStorage } from './support/members';

/**
 * Virtual gifts (MONETIZATION_PLAN.md 3b) in 1-on-1 chats: only to active
 * Verified Hosts, paid from the sender's coins (promo first), the Host's
 * held share of bought coins only, shown as a gift message, idempotent.
 */
describe('Gifts (integration, PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const otp = new CapturingSender();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OTP_SENDER)
      .useValue(otp)
      .overrideProvider(MEDIA_STORAGE)
      .useValue(new FakeMediaStorage())
      .compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE users, otp_challenges, signup_blocks, audit_log, ledger_accounts, ledger_transactions, ledger_entries, promo_claims, host_profiles, host_earnings, gift_sends RESTART IDENTITY CASCADE`;
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  interface Member {
    id: string;
    auth: { Authorization: string };
  }

  async function member(opts: { role?: 'MODERATOR' } = {}): Promise<Member> {
    const token = await createMember(app, otp);
    const auth = { Authorization: `Bearer ${token}` };
    const id = (await http().get('/v1/me').set(auth).expect(200)).body.id as string;
    await http().post('/v1/me/guidelines/accept').set(auth).expect(204);
    await prisma.user.update({ where: { id }, data: { ageVerified: true, ...(opts.role ? { role: opts.role } : {}) } });
    return { id, auth };
  }

  async function makeMatch(a: Member, b: Member): Promise<string> {
    await http().post('/v1/matching/likes').set(b.auth).send({ user_id: a.id }).expect(201);
    return (await http().post('/v1/matching/likes').set(a.auth).send({ user_id: b.id }).expect(201)).body
      .match_id as string;
  }

  let adjustN = 0;
  async function credit(m: Member, coins: number, wallet: 'paid' | 'promo' = 'paid') {
    const staff = await member({ role: 'MODERATOR' });
    await http()
      .post(`/v1/admin/users/${m.id}/coins`)
      .set(staff.auth)
      .send({ coins, wallet, reason: 'Test credit', idempotency_key: `gift-adjust-${++adjustN}` })
      .expect(200);
  }

  async function giftId(slug: string): Promise<string> {
    const list = await http()
      .get('/v1/gifts')
      .set((await member()).auth)
      .expect(200);
    return (list.body.gifts as Array<{ id: string; slug: string }>).find((g) => g.slug === slug)!.id;
  }

  const send = (m: Member, matchId: string, gift: string, key: string) =>
    http().post(`/v1/matches/${matchId}/gifts`).set(m.auth).send({ gift_id: gift, idempotency_key: key });

  it('lists the catalogue, cheapest first', async () => {
    const m = await member();
    const res = await http().get('/v1/gifts').set(m.auth).expect(200);
    expect(res.body.gifts.map((g: { slug: string }) => g.slug)).toEqual(['rose', 'kiss', 'teddy', 'crown']);
    expect(res.body.gifts[0]).toMatchObject({ name: 'Rose', emoji: '🌹', price_coins: 20 });
  });

  it('a gift to a Host: charged once, half of the bought part held for the Host, shown in the chat', async () => {
    const h = await member();
    await http().post('/v1/me/host').set(h.auth).expect(200);
    const fan = await member();
    const matchId = await makeMatch(fan, h);
    await credit(fan, 10, 'promo');
    await credit(fan, 100);
    const kiss = await giftId('kiss');

    const sent = await send(fan, matchId, kiss, 'tap-0001').expect(201);
    expect(sent.body).toMatchObject({
      coins_charged: 50,
      balance: 60,
      message: { type: 'gift', gift: { slug: 'kiss', name: 'Kiss', emoji: '💋' } },
    });
    // 10 promo + 40 bought: the Host earns half of 40.
    expect((await http().get('/v1/me/host/earnings').set(h.auth)).body.pending_coins).toBe(20);

    // A retried tap is not charged again.
    const again = await send(fan, matchId, kiss, 'tap-0001').expect(201);
    expect(again.body.message.id).toBe(sent.body.message.id);
    expect((await app.get(WalletService).balances(fan.id)).balance).toBe(60);

    const history = await http().get(`/v1/matches/${matchId}/messages`).set(h.auth).expect(200);
    expect(history.body.messages[0]).toMatchObject({ type: 'gift', sender_id: fan.id, gift: { slug: 'kiss' } });
    expect(JSON.stringify(history.body.messages[0])).not.toContain('price');
  });

  it('only Hosts can receive gifts; not enough coins is a 402 that stores nothing', async () => {
    const a = await member();
    const b = await member();
    const ab = await makeMatch(a, b);
    await credit(a, 1000);
    const rose = await giftId('rose');
    expect((await send(a, ab, rose, 'tap-1000').expect(403)).body.error.code).toBe('HOST_ONLY');

    await http().post('/v1/me/host').set(b.auth).expect(200);
    const crown = await giftId('crown');
    await send(a, ab, crown, 'tap-1001').expect(201);
    const broke = await send(a, ab, crown, 'tap-1002').expect(402);
    expect(broke.body.error).toMatchObject({ code: 'INSUFFICIENT_COINS', details: { balance: 0, required: 1000 } });
    expect(await prisma.message.count({ where: { matchId: ab, type: 'GIFT' } })).toBe(1);
    const stranger = await member();
    await send(stranger, ab, rose, 'tap-1003').expect(404);
  });
});
