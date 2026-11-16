import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MessageCipher } from '../src/common/message-cipher';
import { OTP_SENDER } from '../src/modules/auth/otp-sender';
import { MEDIA_STORAGE } from '../src/modules/media/media-storage';
import { paystackSignature } from '../src/modules/payments/paystack.client';
import {
  type Bank,
  PAYOUT_PROVIDER,
  type PayoutProvider,
  type TransferOutcome,
  TransferRefused,
} from '../src/modules/payouts/payout-provider';
import { PayoutsService } from '../src/modules/payouts/payouts.service';
import { LedgerService } from '../src/modules/wallet/ledger.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CapturingSender, createMember, FakeMediaStorage } from './support/members';

/** Stands in for Paystack Transfers: one known account, scriptable transfer outcomes. */
class FakePayouts implements PayoutProvider {
  configured = true;
  readonly transfers: Array<{ amountKobo: number; recipientCode: string; reference: string }> = [];
  /** What the next transfer call does. */
  next: TransferOutcome | 'refuse' | 'timeout' = 'pending';
  /** What verify returns, per reference. */
  readonly state = new Map<string, TransferOutcome>();

  async listBanks(): Promise<Bank[]> {
    return [
      { code: '058', name: 'Guaranty Trust Bank' },
      { code: '999992', name: 'OPay Digital Services Limited (OPay)' },
    ];
  }
  async resolveAccount(accountNumber: string, bankCode: string) {
    return accountNumber === '0123456789' && bankCode === '058' ? { accountName: 'ADA CHIOMA OKAFOR' } : null;
  }
  async createRecipient() {
    return 'RCP_test123';
  }
  async transfer(input: { amountKobo: number; recipientCode: string; reference: string }) {
    this.transfers.push(input);
    if (this.next === 'refuse') throw new TransferRefused('Insufficient balance');
    if (this.next === 'timeout') throw new Error('socket hang up');
    this.state.set(input.reference, this.next);
    return { outcome: this.next, transferCode: 'TRF_1' };
  }
  async verifyTransfer(reference: string) {
    return { outcome: this.state.get(reference) ?? 'pending', transferCode: 'TRF_1', reason: null };
  }
}

/**
 * Milestone 8 (MONETIZATION_PLAN.md M7/M8): Host bank accounts (resolved and
 * encrypted), held earnings maturing after 7 days, withdrawals of at least
 * ₦5,000 (₦1 a coin by default), one payout in flight per Host, Paystack
 * transfer webhooks re-checked with verify, and failed or reversed transfers
 * returning the coins to available earnings.
 */
describe('Host payouts (integration, PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let payouts: PayoutsService;
  const otp = new CapturingSender();
  const provider = new FakePayouts();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OTP_SENDER)
      .useValue(otp)
      .overrideProvider(MEDIA_STORAGE)
      .useValue(new FakeMediaStorage())
      .overrideProvider(PAYOUT_PROVIDER)
      .useValue(provider)
      .compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    payouts = app.get(PayoutsService);
  });

  beforeEach(async () => {
    provider.transfers.length = 0;
    provider.state.clear();
    provider.next = 'pending';
    provider.configured = true;
    Object.assign(payouts, { enabled: true });
    await prisma.$executeRaw`TRUNCATE users, otp_challenges, signup_blocks, audit_log, ledger_accounts, ledger_transactions, ledger_entries, promo_claims, host_profiles, host_earnings, gift_sends, payouts, payout_accounts RESTART IDENTITY CASCADE`;
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

  /** Gives the Host `coins` of held earnings: a fan buys coins and sends Crowns (1,000 → 500 earned). */
  let adjustN = 0;
  async function earn(h: Member, crowns: number) {
    const fan = await member();
    const staff = await member({ role: 'MODERATOR' });
    await http()
      .post(`/v1/admin/users/${fan.id}/coins`)
      .set(staff.auth)
      .send({ coins: crowns * 1000, wallet: 'paid', reason: 'Test credit', idempotency_key: `po-adjust-${++adjustN}` })
      .expect(200);
    await http().post('/v1/matching/likes').set(h.auth).send({ user_id: fan.id }).expect(201);
    const matchId = (await http().post('/v1/matching/likes').set(fan.auth).send({ user_id: h.id }).expect(201)).body
      .match_id as string;
    const crown = (
      (await http().get('/v1/gifts').set(fan.auth)).body.gifts as Array<{ id: string; slug: string }>
    ).find((g) => g.slug === 'crown')!.id;
    for (let i = 0; i < crowns; i++) {
      await http()
        .post(`/v1/matches/${matchId}/gifts`)
        .set(fan.auth)
        .send({ gift_id: crown, idempotency_key: `crown-${adjustN}-${i}` })
        .expect(201);
    }
  }

  /** The 7-day hold passes. */
  const matureAll = (h: Member) =>
    prisma.hostEarning.updateMany({ where: { hostId: h.id }, data: { availableAt: new Date(Date.now() - 1000) } });

  const linkAccount = (h: Member) =>
    http().post('/v1/hosts/bank-account').set(h.auth).send({ bank_code: '058', account_number: '0123456789' });

  const summary = async (h: Member) => (await http().get('/v1/hosts/payouts').set(h.auth).expect(200)).body;

  function webhook(event: string, reference: string) {
    const body = JSON.stringify({ event, data: { reference } });
    const signature = paystackSignature(body, process.env.PAYSTACK_SECRET_KEY!);
    return http()
      .post('/v1/payments/paystack/webhook')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', signature)
      .send(body);
  }

  async function expectLedgerBalanced() {
    const unbalanced = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT transaction_id AS id FROM ledger_entries GROUP BY transaction_id HAVING SUM(amount) <> 0`;
    expect(unbalanced).toEqual([]);
  }

  it('bank accounts: verified active Hosts only, resolved by the bank, saved encrypted', async () => {
    const plain = await member();
    expect((await linkAccount(plain).expect(403)).body.error.code).toBe('HOST_ONLY');

    const h = await host();
    const banks = await http().get('/v1/hosts/banks').set(h.auth).expect(200);
    expect(banks.body.banks).toContainEqual({ code: '999992', name: 'OPay Digital Services Limited (OPay)' });

    const wrong = await http()
      .post('/v1/hosts/bank-account/resolve')
      .set(h.auth)
      .send({ bank_code: '058', account_number: '0000000000' })
      .expect(422);
    expect(wrong.body.error.code).toBe('ACCOUNT_NOT_RESOLVED');
    await http()
      .post('/v1/hosts/bank-account/resolve')
      .set(h.auth)
      .send({ bank_code: '058', account_number: '12345' })
      .expect(400);
    await http()
      .post('/v1/hosts/bank-account/resolve')
      .set(h.auth)
      .send({ bank_code: '000', account_number: '0123456789' })
      .expect(400); // not a listed bank

    const resolved = await http()
      .post('/v1/hosts/bank-account/resolve')
      .set(h.auth)
      .send({ bank_code: '058', account_number: '0123456789' })
      .expect(200);
    expect(resolved.body).toEqual({
      bank_code: '058',
      bank_name: 'Guaranty Trust Bank',
      account_name: 'ADA CHIOMA OKAFOR',
      account_last4: '6789',
    });

    const saved = await linkAccount(h).expect(200);
    expect(saved.body.account).toEqual({
      bank_code: '058',
      bank_name: 'Guaranty Trust Bank',
      account_last4: '6789',
      account_name: 'ADA CHIOMA OKAFOR',
    });
    const row = await prisma.payoutAccount.findUniqueOrThrow({ where: { userId: h.id } });
    expect(row.accountNumberEnc).not.toContain('0123456789');
    expect(app.get(MessageCipher).decrypt(row.accountNumberEnc)).toBe('0123456789');
    expect(row.recipientCode).toBe('RCP_test123');
    expect((await http().get('/v1/hosts/bank-account').set(h.auth).expect(200)).body.account.account_last4).toBe(
      '6789',
    );
  });

  it('earnings mature after the 7-day hold; withdrawals need ₦5,000 and a bank account', async () => {
    const h = await host();
    await earn(h, 12); // 6,000 coins held
    let s = await summary(h);
    expect(s).toMatchObject({
      pending_coins: 6000,
      available_coins: 0,
      kobo_per_coin: 100,
      min_withdraw_coins: 5000,
      min_withdraw_kobo: 500_000,
      payouts_enabled: true,
      account: null,
    });
    expect((await http().post('/v1/hosts/withdraw').set(h.auth).send({}).expect(409)).body.error.code).toBe(
      'NO_PAYOUT_ACCOUNT',
    );
    await linkAccount(h).expect(200);
    const held = await http().post('/v1/hosts/withdraw').set(h.auth).send({}).expect(422);
    expect(held.body.error).toMatchObject({ code: 'BELOW_MINIMUM_WITHDRAWAL', details: { available_coins: 0 } });

    await matureAll(h);
    s = await summary(h);
    expect(s).toMatchObject({ pending_coins: 0, available_coins: 6000, available_kobo: 600_000 });
    const tooSmall = await http().post('/v1/hosts/withdraw').set(h.auth).send({ coins: 4999 }).expect(422);
    expect(tooSmall.body.error.code).toBe('BELOW_MINIMUM_WITHDRAWAL');
    const tooBig = await http().post('/v1/hosts/withdraw').set(h.auth).send({ coins: 6001 }).expect(422);
    expect(tooBig.body.error.code).toBe('INSUFFICIENT_EARNINGS');
  }, 60_000);

  it('a withdrawal sends a Paystack transfer once; the success webhook (re-checked) settles it', async () => {
    const h = await host();
    await earn(h, 12);
    await matureAll(h);
    await linkAccount(h).expect(200);

    const res = await http().post('/v1/hosts/withdraw').set(h.auth).send({}).expect(201);
    expect(res.body.payout).toMatchObject({
      coins: 6000,
      amount_kobo: 600_000,
      status: 'pending',
      bank_name: 'Guaranty Trust Bank',
      account_last4: '6789',
    });
    expect(provider.transfers).toHaveLength(1);
    expect(provider.transfers[0]).toMatchObject({ amountKobo: 600_000, recipientCode: 'RCP_test123' });
    const reference = provider.transfers[0]!.reference;
    expect((await summary(h)).available_coins).toBe(0);

    // A forged webhook changes nothing.
    await http()
      .post('/v1/payments/paystack/webhook')
      .set('x-paystack-signature', 'f'.repeat(128))
      .send({ event: 'transfer.success', data: { reference } })
      .expect(401);
    // The webhook alone isn't trusted: Paystack still says pending.
    await webhook('transfer.success', reference).expect(200);
    expect((await summary(h)).payouts[0].status).toBe('pending');

    provider.state.set(reference, 'success');
    await webhook('transfer.success', reference).expect(200);
    await webhook('transfer.success', reference).expect(200); // replayed: no double settlement
    const s = await summary(h);
    expect(s.payouts[0]).toMatchObject({ status: 'success', completed_at: expect.any(String) });
    expect(s.available_coins).toBe(0);
    expect(await app.get(LedgerService).balance(null, 'PLATFORM_PAYOUTS')).toBe(6000);
    expect(await app.get(LedgerService).balance(null, 'PAYOUT_CLEARING')).toBe(0);
    await expectLedgerBalanced();
  }, 60_000);

  it('the same balance can’t be withdrawn twice, even at the same moment', async () => {
    const h = await host();
    await earn(h, 12);
    await matureAll(h);
    await linkAccount(h).expect(200);
    await summary(h); // the app shows the balance (matured) before Withdraw
    const [a, b] = await Promise.all([
      http().post('/v1/hosts/withdraw').set(h.auth).send({}),
      http().post('/v1/hosts/withdraw').set(h.auth).send({}),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(provider.transfers).toHaveLength(1);
    expect(await prisma.payout.count()).toBe(1);
    // Nor while it's in flight, nor can the bank account change under it.
    expect((await http().post('/v1/hosts/withdraw').set(h.auth).send({}).expect(409)).body.error.code).toBe(
      'PAYOUT_IN_PROGRESS',
    );
    expect((await linkAccount(h).expect(409)).body.error.code).toBe('PAYOUT_IN_PROGRESS');
  }, 60_000);

  it('a failed transfer returns the coins; a reversal after success does too', async () => {
    const h = await host();
    await earn(h, 12);
    await matureAll(h);
    await linkAccount(h).expect(200);

    await http().post('/v1/hosts/withdraw').set(h.auth).send({ coins: 5000 }).expect(201);
    const first = provider.transfers[0]!.reference;
    provider.state.set(first, 'failed');
    await webhook('transfer.failed', first).expect(200);
    let s = await summary(h);
    expect(s.payouts[0]).toMatchObject({ status: 'failed' });
    expect(s.available_coins).toBe(6000);

    // Paystack refusing outright (e.g. its balance is too low): failed at once, nothing lost.
    provider.next = 'refuse';
    const refused = await http().post('/v1/hosts/withdraw').set(h.auth).send({}).expect(201);
    expect(refused.body.payout).toMatchObject({ status: 'failed', failure_reason: 'Insufficient balance' });
    expect((await summary(h)).available_coins).toBe(6000);

    // Success, then the bank reverses it.
    provider.next = 'success';
    const paid = await http().post('/v1/hosts/withdraw').set(h.auth).send({}).expect(201);
    expect(paid.body.payout.status).toBe('success');
    expect((await summary(h)).available_coins).toBe(0);
    const third = provider.transfers.at(-1)!.reference;
    provider.state.set(third, 'reversed');
    await webhook('transfer.reversed', third).expect(200);
    s = await summary(h);
    expect(s.payouts[0]).toMatchObject({ status: 'reversed' });
    expect(s.available_coins).toBe(6000);
    await expectLedgerBalanced();
  }, 60_000);

  it('an unknown outcome stays pending until the reconciler checks; the safety switch stops withdrawals', async () => {
    const h = await host();
    await earn(h, 12);
    await matureAll(h);
    await linkAccount(h).expect(200);

    provider.next = 'timeout';
    const res = await http().post('/v1/hosts/withdraw').set(h.auth).send({}).expect(201);
    expect(res.body.payout.status).toBe('pending');
    provider.state.set(provider.transfers[0]!.reference, 'success');
    expect(await payouts.reconcile(0)).toBe(1);
    expect((await summary(h)).payouts[0].status).toBe('success');

    Object.assign(payouts, { enabled: false });
    expect((await http().post('/v1/hosts/withdraw').set(h.auth).send({}).expect(503)).body.error.code).toBe(
      'PAYOUTS_DISABLED',
    );
    expect((await summary(h)).payouts_enabled).toBe(false);
  }, 60_000);
});
