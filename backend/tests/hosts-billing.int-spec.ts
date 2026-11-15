import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { OTP_SENDER } from '../src/modules/auth/otp-sender';
import { HostsService } from '../src/modules/hosts/hosts.service';
import { startOfLagosDay } from '../src/modules/hosts/message-billing';
import { MEDIA_STORAGE } from '../src/modules/media/media-storage';
import { WalletService } from '../src/modules/wallet/wallet.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CapturingSender, createMember, FakeMediaStorage } from './support/members';

/**
 * Milestone 3 (docs/MONETIZATION_PLAN.md): opt-in Verified Hosts, paid
 * messages after the daily free allowance, the Host's held share of bought
 * coins and its release, and Host icebreakers. Defaults: 10 coins a message,
 * 3 free a day per conversation, 50% share, 7-day hold.
 */
describe('Hosts and paid messages (integration, PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let hosts: HostsService;
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
    hosts = app.get(HostsService);
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE users, otp_challenges, signup_blocks, audit_log, ledger_accounts, ledger_transactions, ledger_entries, promo_claims, payment_intents, host_profiles, host_earnings RESTART IDENTITY CASCADE`;
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  interface Member {
    id: string;
    auth: { Authorization: string };
  }

  async function member(opts: { verified?: boolean; role?: 'MODERATOR' } = {}): Promise<Member> {
    const token = await createMember(app, otp);
    const auth = { Authorization: `Bearer ${token}` };
    const id = (await http().get('/v1/me').set(auth).expect(200)).body.id as string;
    await http().post('/v1/me/guidelines/accept').set(auth).expect(204);
    await prisma.user.update({
      where: { id },
      data: { ageVerified: opts.verified ?? true, ...(opts.role ? { role: opts.role } : {}) },
    });
    return { id, auth };
  }

  async function host(): Promise<Member> {
    const h = await member();
    await http().post('/v1/me/host').set(h.auth).expect(200);
    return h;
  }

  async function makeMatch(a: Member, b: Member): Promise<string> {
    await http().post('/v1/matching/likes').set(b.auth).send({ user_id: a.id }).expect(201);
    return (await http().post('/v1/matching/likes').set(a.auth).send({ user_id: b.id }).expect(201)).body
      .match_id as string;
  }

  const send = (m: Member, matchId: string, body: string) =>
    http().post(`/v1/matches/${matchId}/messages`).set(m.auth).send({ body });

  let adjustN = 0;
  async function credit(m: Member, coins: number, wallet: 'paid' | 'promo') {
    const staff = await member({ role: 'MODERATOR' });
    await http()
      .post(`/v1/admin/users/${m.id}/coins`)
      .set(staff.auth)
      .send({ coins, wallet, reason: 'Test credit', idempotency_key: `test-adjust-${++adjustN}` })
      .expect(200);
  }

  // Straight from the ledger: GET /wallet would grant the starter coins on first load.
  const balance = (m: Member) => app.get(WalletService).balances(m.id);

  async function expectLedgerBalanced() {
    const unbalanced = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT transaction_id AS id FROM ledger_entries GROUP BY transaction_id HAVING SUM(amount) <> 0`;
    expect(unbalanced).toEqual([]);
  }

  it('opting in needs NIN verification; any verified member can host, and can pause', async () => {
    const unverified = await member({ verified: false });
    const denied = await http().post('/v1/me/host').set(unverified.auth).expect(403);
    expect(denied.body.error.code).toBe('VERIFICATION_REQUIRED');
    expect((await http().get('/v1/me').set(unverified.auth)).body).toMatchObject({
      capabilities: { host: false },
      host_status: null,
    });

    const h = await member();
    const on = await http().post('/v1/me/host').set(h.auth).expect(200);
    expect(on.body.host).toMatchObject({ status: 'active', revenue_share_bps: 5000, hold_days: 7 });
    expect((await http().get('/v1/me').set(h.auth)).body).toMatchObject({
      capabilities: { host: true },
      host_status: 'active',
    });
    const paused = await http().post('/v1/me/host/pause').set(h.auth).expect(200);
    expect(paused.body.host.status).toBe('paused');
    await http().post('/v1/me/host').set(h.auth).expect(200); // resume
    expect((await http().get('/v1/me/host').set(h.auth)).body.host.status).toBe('active');
  });

  it('messages to a Host: 3 free a day, then 10 coins each, with the Host earning half of bought coins', async () => {
    const h = await host();
    const fan = await member();
    const matchId = await makeMatch(fan, h);
    await credit(fan, 15, 'paid');
    await credit(fan, 5, 'promo');

    const history = await http().get(`/v1/matches/${matchId}/messages`).set(fan.auth).expect(200);
    expect(history.body.billing).toEqual({ paid: true, price_coins: 10, free_per_day: 3, free_remaining_today: 3 });
    expect(history.body.host_tools).toBe(false);

    for (const left of [2, 1, 0]) {
      const free = await send(fan, matchId, `free ${left}`).expect(201);
      expect(free.body).toMatchObject({ coins_charged: 0, free_remaining_today: left });
    }
    // 4th: 10 coins. Promo first (5 promo + 5 bought): the Host earns half of the bought 5 → 2 (rounded down).
    const paid1 = await send(fan, matchId, 'paid one').expect(201);
    expect(paid1.body).toMatchObject({ coins_charged: 10, balance: 10, free_remaining_today: 0 });
    // 5th: 10 bought coins → Host earns 5.
    await send(fan, matchId, 'paid two').expect(201);
    expect((await balance(fan)).balance).toBe(0);

    const refused = await send(fan, matchId, 'no coins left').expect(402);
    expect(refused.body.error).toMatchObject({ code: 'INSUFFICIENT_COINS', details: { balance: 0, required: 10 } });
    // Nothing stored for the refused message.
    const after = await http().get(`/v1/matches/${matchId}/messages`).set(fan.auth).expect(200);
    expect(after.body.messages.map((m: { body: string }) => m.body)).not.toContain('no coins left');
    expect(after.body.messages).toHaveLength(5);

    const earnings = await http().get('/v1/me/host/earnings').set(h.auth).expect(200);
    expect(earnings.body).toMatchObject({ pending_coins: 7, available_coins: 0, hold_days: 7 });
    expect(earnings.body.recent.map((e: { coins: number }) => e.coins)).toEqual([5, 2]);

    // The Host replies for free and sees the icebreaker bar.
    const reply = await send(h, matchId, 'Thanks for the messages!').expect(201);
    expect(reply.body).toMatchObject({ coins_charged: 0, free_remaining_today: null });
    const hostView = await http().get(`/v1/matches/${matchId}/messages`).set(h.auth).expect(200);
    expect(hostView.body).toMatchObject({ host_tools: true, billing: { paid: false } });

    // Promo coins never become earnings: platform revenue + Host earnings = the bought coins spent (15).
    const [revenue] = await prisma.$queryRaw<Array<{ sum: bigint }>>`
      SELECT COALESCE(SUM(e.amount), 0) AS sum FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
       WHERE a.kind = 'PLATFORM_REVENUE'`;
    expect(Number(revenue!.sum) + 7).toBe(15);
    await expectLedgerBalanced();
  });

  it('only promo coins: the message is paid, but the Host earns nothing', async () => {
    const h = await host();
    const fan = await member();
    const matchId = await makeMatch(fan, h);
    await credit(fan, 10, 'promo');
    for (let i = 0; i < 3; i++) await send(fan, matchId, `hi ${i}`).expect(201);
    await send(fan, matchId, 'paid with promo').expect(201);
    expect((await http().get('/v1/me/host/earnings').set(h.auth)).body).toMatchObject({
      pending_coins: 0,
      recent: [],
    });
  });

  it('members who are not Hosts, and paused Hosts, chat for free', async () => {
    const a = await member();
    const b = await member();
    const matchId = await makeMatch(a, b);
    for (let i = 0; i < 6; i++) await send(a, matchId, `hello ${i}`).expect(201);
    expect((await http().get(`/v1/matches/${matchId}/messages`).set(a.auth)).body.billing.paid).toBe(false);

    await http().post('/v1/me/host').set(b.auth).expect(200);
    await http().post('/v1/me/host/pause').set(b.auth).expect(200);
    const res = await send(a, matchId, 'still free').expect(201);
    expect(res.body.coins_charged).toBe(0);
    expect(await prisma.ledgerTransaction.count({ where: { kind: 'SPEND' } })).toBe(0);
  });

  it('the free allowance resets at midnight in Lagos', async () => {
    const h = await host();
    const fan = await member();
    const matchId = await makeMatch(fan, h);
    for (let i = 0; i < 3; i++) await send(fan, matchId, `today ${i}`).expect(201);
    // Move today's messages to yesterday (Lagos time).
    await prisma.message.updateMany({
      where: { matchId },
      data: { createdAt: new Date(startOfLagosDay(new Date()).getTime() - 60_000) },
    });
    const res = await send(fan, matchId, 'a new day').expect(201);
    expect(res.body).toMatchObject({ coins_charged: 0, free_remaining_today: 2 });

    expect(startOfLagosDay(new Date('2026-11-16T22:59:00Z')).toISOString()).toBe('2026-11-15T23:00:00.000Z');
    expect(startOfLagosDay(new Date('2026-11-16T23:00:00Z')).toISOString()).toBe('2026-11-16T23:00:00.000Z');
  });

  it('concurrent sends cannot share the last free message or overdraw', async () => {
    const h = await host();
    const fan = await member();
    const matchId = await makeMatch(fan, h);
    await credit(fan, 20, 'paid');
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => send(fan, matchId, `burst ${i}`)));
    const ok = results.filter((r) => r.status === 201);
    expect(ok).toHaveLength(5); // 3 free + 2 paid (20 coins)
    expect(results.filter((r) => r.status === 402)).toHaveLength(3);
    expect(ok.filter((r) => r.body.coins_charged === 10)).toHaveLength(2);
    expect((await balance(fan)).balance).toBe(0);
    expect((await http().get('/v1/me/host/earnings').set(h.auth)).body.pending_coins).toBe(10);
    await expectLedgerBalanced();
  });

  it('held earnings become available after the hold, once', async () => {
    const h = await host();
    const fan = await member();
    const matchId = await makeMatch(fan, h);
    await credit(fan, 40, 'paid');
    for (let i = 0; i < 7; i++) await send(fan, matchId, `msg ${i}`).expect(201); // 4 paid → 20 earned

    expect(await hosts.releaseDue()).toEqual({ hosts: 0, coins: 0 }); // still held
    const later = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    const [first, second] = await Promise.all([hosts.releaseDue(later), hosts.releaseDue(later)]);
    expect(first.coins + second.coins).toBe(20);
    expect(await hosts.releaseDue(later)).toEqual({ hosts: 0, coins: 0 });

    const earnings = await http().get('/v1/me/host/earnings').set(h.auth).expect(200);
    expect(earnings.body).toMatchObject({ pending_coins: 0, available_coins: 20 });
    expect(earnings.body.recent.every((e: { released: boolean }) => e.released)).toBe(true);
    await expectLedgerBalanced();
  });

  it('icebreakers: Hosts only, built from the other member’s public profile', async () => {
    const h = await host();
    const fan = await member();
    const matchId = await makeMatch(fan, h);
    await prisma.profile.update({
      where: { userId: fan.id },
      data: {
        city: 'Lagos',
        interests: ['afrobeats', 'football', 'cooking'],
        prompts: [{ prompt_id: 'jollof_take', answer: 'Party jollof wins, always.' }],
      },
    });
    await prisma.profile.update({ where: { userId: h.id }, data: { interests: ['football', 'travel'] } });

    const res = await http().get(`/v1/matches/${matchId}/icebreakers`).set(h.auth).expect(200);
    const texts = res.body.icebreakers.map((i: { text: string }) => i.text) as string[];
    expect(texts.length).toBeGreaterThanOrEqual(3);
    expect(texts.length).toBeLessThanOrEqual(5);
    expect(texts[0]).toMatch(/football/); // the shared interest comes first
    expect(texts.some((t) => t.includes('Lagos'))).toBe(true);
    expect(texts.some((t) => t.includes('jollof'))).toBe(true);
    // Stable for the day.
    const again = await http().get(`/v1/matches/${matchId}/icebreakers`).set(h.auth).expect(200);
    expect(again.body).toEqual(res.body);

    const notHost = await http().get(`/v1/matches/${matchId}/icebreakers`).set(fan.auth).expect(403);
    expect(notHost.body.error.code).toBe('HOST_ONLY');
    const stranger = await host();
    await http().get(`/v1/matches/${matchId}/icebreakers`).set(stranger.auth).expect(404);
  });
});
