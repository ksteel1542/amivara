import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { OTP_SENDER } from '../src/modules/auth/otp-sender';
import { MEDIA_STORAGE } from '../src/modules/media/media-storage';
import { AccountService } from '../src/modules/users/account.service';
import { WalletService } from '../src/modules/wallet/wallet.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CapturingSender, createMember, FakeMediaStorage } from './support/members';

/**
 * Milestone 1 (docs/MONETIZATION_PLAN.md): the double-entry coin ledger,
 * starter coins (once per member and per device), spending (promo coins
 * first, no overdraft under concurrency), staff adjustments and the wallet API.
 */
describe('Coin ledger and wallet (integration, PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let wallets: WalletService;
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
    wallets = app.get(WalletService);
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE users, otp_challenges, signup_blocks, audit_log, ledger_accounts, ledger_transactions, ledger_entries, promo_claims RESTART IDENTITY CASCADE`;
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  async function member(opts: { guidelines?: boolean; role?: 'MODERATOR' } = {}) {
    const token = await createMember(app, otp);
    const auth = { Authorization: `Bearer ${token}` };
    const id = (await http().get('/v1/me').set(auth).expect(200)).body.id as string;
    if (opts.guidelines ?? true) await http().post('/v1/me/guidelines/accept').set(auth).expect(204);
    if (opts.role) await prisma.user.update({ where: { id }, data: { role: opts.role } });
    return { id, auth };
  }

  /** Every ledger transaction sums to zero (the double-entry invariant), checked across the whole ledger. */
  async function expectLedgerBalanced() {
    const unbalanced = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT transaction_id AS id FROM ledger_entries GROUP BY transaction_id HAVING SUM(amount) <> 0`;
    expect(unbalanced).toEqual([]);
    const drift = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT a.id FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id
       GROUP BY a.id, a.balance HAVING a.balance <> COALESCE(SUM(e.amount), 0)`;
    expect(drift).toEqual([]); // cached balances match the entries
  }

  it('grants starter coins once, after the community guidelines', async () => {
    const m = await member({ guidelines: false });
    const before = await http().get('/v1/wallet').set(m.auth).expect(200);
    expect(before.body).toMatchObject({ balance: 0, starter: { granted: false, coins: 100 } });

    await http().post('/v1/me/guidelines/accept').set(m.auth).expect(204);
    const first = await http().get('/v1/wallet').set(m.auth).expect(200);
    expect(first.body).toMatchObject({ balance: 100, promo_coins: 100, paid_coins: 0, starter: { granted: true } });
    const again = await http().get('/v1/wallet').set(m.auth).expect(200);
    expect(again.body.balance).toBe(100); // not twice

    const history = await http().get('/v1/wallet/transactions').set(m.auth).expect(200);
    expect(history.body.transactions).toEqual([
      expect.objectContaining({ kind: 'starter_grant', coins: 100, reason: 'starter_coins' }),
    ]);
    await expectLedgerBalanced();
  });

  it('a second account on the same phone does not get starter coins again', async () => {
    const first = await member();
    await http().get('/v1/wallet').set(first.auth).expect(200);
    const second = await member();
    // Same device as the first account.
    const device = await prisma.deviceSession.findFirstOrThrow({ where: { userId: first.id } });
    await prisma.deviceSession.updateMany({ where: { userId: second.id }, data: { deviceHash: device.deviceHash } });

    const res = await http().get('/v1/wallet').set(second.auth).expect(200);
    expect(res.body).toMatchObject({ balance: 0, starter: { granted: false } });
    expect(await prisma.promoClaim.count()).toBe(1);
  });

  it('lists the top-up packages with the first-purchase bonus', async () => {
    const m = await member();
    const res = await http().get('/v1/wallet').set(m.auth).expect(200);
    expect(res.body.first_purchase_eligible).toBe(true);
    expect(res.body.packages.map((p: { coins: number }) => p.coins)).toEqual([500, 2000, 10000, 30000]);
    expect(res.body.packages[1]).toMatchObject({
      coins: 2000,
      bonus_coins: 0,
      first_purchase_bonus: 400,
      total_coins: 2400,
      price_kobo: 350000,
      price_ngn: 3500,
      label: 'Most popular',
    });
    // Final prices (founder, 15 Nov 2026).
    expect(
      res.body.packages.map((p: { coins: number; price_ngn: number; first_purchase_bonus: number }) => [
        p.coins,
        p.price_ngn,
        p.first_purchase_bonus,
      ]),
    ).toEqual([
      [500, 1000, 100],
      [2000, 3500, 400],
      [10000, 15000, 2000],
      [30000, 40000, 7500],
    ]);
  });

  it('spends promo coins first, then bought coins; refuses an overdraft with 402', async () => {
    const m = await member();
    await http().get('/v1/wallet').set(m.auth).expect(200); // 100 promo
    const staff = await member({ role: 'MODERATOR' });
    await http()
      .post(`/v1/admin/users/${m.id}/coins`)
      .set(staff.auth)
      .send({ coins: 50, wallet: 'paid', reason: 'Test credit', idempotency_key: 'adj-0001' })
      .expect(200);

    const spent = await wallets.spend({ userId: m.id, coins: 120, idempotencyKey: 'msg:1' });
    expect(spent).toMatchObject({ promoSpent: 100, paidSpent: 20, balance: 30, promo: 0, paid: 30 });

    // Replaying the same spend charges nothing more.
    const replay = await wallets.spend({ userId: m.id, coins: 120, idempotencyKey: 'msg:1' });
    expect(replay.balance).toBe(30);

    await expect(wallets.spend({ userId: m.id, coins: 31, idempotencyKey: 'msg:2' })).rejects.toMatchObject({
      code: 'INSUFFICIENT_COINS',
      details: { balance: 30, required: 31 },
    });
    expect((await http().get('/v1/wallet').set(m.auth)).body.balance).toBe(30);
    await expectLedgerBalanced();
  });

  it('never overdraws under concurrent spending', async () => {
    const m = await member({ guidelines: false });
    const staff = await member({ role: 'MODERATOR' });
    await http()
      .post(`/v1/admin/users/${m.id}/coins`)
      .set(staff.auth)
      .send({ coins: 5, wallet: 'paid', reason: 'Five coins', idempotency_key: 'adj-0002' })
      .expect(200);

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => wallets.spend({ userId: m.id, coins: 1, idempotencyKey: `burst:${i}` })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(15);
    expect((await wallets.balances(m.id)).balance).toBe(0);
    await expectLedgerBalanced();
  });

  it('staff adjustments: credits and debits, idempotent, audited, staff only', async () => {
    const m = await member({ guidelines: false });
    const staff = await member({ role: 'MODERATOR' });
    const body = { coins: 200, wallet: 'promo', reason: 'Goodwill after a failed call', idempotency_key: 'adj-1000' };
    await http().post(`/v1/admin/users/${m.id}/coins`).set(m.auth).send(body).expect(404); // members can't
    const credited = await http().post(`/v1/admin/users/${m.id}/coins`).set(staff.auth).send(body).expect(200);
    expect(credited.body).toMatchObject({ balance: 200, promo_coins: 200 });
    await http().post(`/v1/admin/users/${m.id}/coins`).set(staff.auth).send(body).expect(200); // same key: once
    expect((await wallets.balances(m.id)).balance).toBe(200);

    const tooMuch = await http()
      .post(`/v1/admin/users/${m.id}/coins`)
      .set(staff.auth)
      .send({ coins: -500, wallet: 'promo', reason: 'Clawback', idempotency_key: 'adj-1001' })
      .expect(402);
    expect(tooMuch.body.error.code).toBe('INSUFFICIENT_COINS');

    const audit = await prisma.auditLog.findMany({ where: { action: 'wallet.adjust' } });
    expect(audit).toHaveLength(2); // the replay is audited too, but posts nothing
    expect(audit[0]).toMatchObject({ actorId: staff.id, targetId: m.id });
    await http()
      .post(`/v1/admin/users/${m.id}/coins`)
      .set(staff.auth)
      .send({ coins: 0, wallet: 'promo', reason: 'Nothing', idempotency_key: 'adj-1002' })
      .expect(400);
    await expectLedgerBalanced();
  });

  it('the ledger is append-only and survives the member being purged', async () => {
    const m = await member();
    await http().get('/v1/wallet').set(m.auth).expect(200);
    await expect(prisma.ledgerEntry.updateMany({ data: { amount: 9999n } })).rejects.toThrow(/append-only/);

    await http().delete('/v1/users/me').set(m.auth).expect(202);
    await prisma.user.update({ where: { id: m.id }, data: { deletedAt: new Date(Date.now() - 31 * 864e5) } });
    expect(await app.get(AccountService).purgeDue()).toBe(1);

    const orphaned = await prisma.ledgerAccount.findMany({ where: { kind: 'MEMBER_COINS_PROMO' } });
    expect(orphaned).toHaveLength(1);
    expect(orphaned[0]!.ownerId).toBeNull(); // history kept, member gone
    expect(await prisma.ledgerEntry.count()).toBe(2);
    await expectLedgerBalanced();
  });

  it('wallet history pages and needs sign-in', async () => {
    const m = await member({ guidelines: false });
    const staff = await member({ role: 'MODERATOR' });
    for (let i = 0; i < 3; i++) {
      await http()
        .post(`/v1/admin/users/${m.id}/coins`)
        .set(staff.auth)
        .send({ coins: 10 + i, wallet: 'paid', reason: `Credit ${i}`, idempotency_key: `adj-page-${i}` })
        .expect(200);
    }
    const first = await http().get('/v1/wallet/transactions?limit=2').set(m.auth).expect(200);
    expect(first.body.transactions.map((t: { coins: number }) => t.coins)).toEqual([12, 11]);
    const next = await http()
      .get(`/v1/wallet/transactions?limit=2&before=${first.body.next_before}`)
      .set(m.auth)
      .expect(200);
    expect(next.body.transactions.map((t: { coins: number }) => t.coins)).toEqual([10]);
    await http().get('/v1/wallet').expect(401);
  });
});
