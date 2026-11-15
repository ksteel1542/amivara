import { HttpStatus, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { ApiError } from '../src/common/api-error';
import { OTP_SENDER } from '../src/modules/auth/otp-sender';
import { MEDIA_STORAGE } from '../src/modules/media/media-storage';
import type { ProviderVerification } from '../src/modules/payments/payment-provider';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { PaystackClient, paystackSignature } from '../src/modules/payments/paystack.client';
import { PrismaService } from '../src/prisma/prisma.service';
import { CapturingSender, createMember, FakeMediaStorage } from './support/members';

/**
 * Milestone 2 (docs/MONETIZATION_PLAN.md): Paystack top-ups. Paystack itself is
 * stubbed (startCheckout / verify); signatures, intents, crediting, the
 * first-purchase bonus and idempotency run for real against PostgreSQL.
 */
describe('Coin top-ups via Paystack (integration, PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let paystack: PaystackClient;
  let payments: PaymentsService;
  const otp = new CapturingSender();
  const SECRET = process.env.PAYSTACK_SECRET_KEY!;

  /** What the stubbed Paystack says about each reference. */
  const remote = new Map<string, Partial<ProviderVerification>>();
  let verifyCalls = 0;

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
    paystack = app.get(PaystackClient);
    payments = app.get(PaymentsService);
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE users, otp_challenges, signup_blocks, audit_log, ledger_accounts, ledger_transactions, ledger_entries, promo_claims, payment_intents RESTART IDENTITY CASCADE`;
    remote.clear();
    verifyCalls = 0;
    jest.restoreAllMocks();
    jest
      .spyOn(paystack, 'startCheckout')
      .mockImplementation(async (r) => ({ checkoutUrl: `https://checkout.paystack.test/${r.reference}` }));
    jest.spyOn(paystack, 'verify').mockImplementation(async (reference) => {
      verifyCalls++;
      await new Promise((r) => setTimeout(r, 5)); // let concurrent confirmations overlap
      return {
        outcome: 'pending',
        amountKobo: 0,
        currency: 'NGN',
        providerTransactionId: '4099260516',
        channel: 'card',
        paidAt: null,
        reason: null,
        ...remote.get(reference),
      };
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  async function member() {
    const token = await createMember(app, otp);
    const auth = { Authorization: `Bearer ${token}` };
    const id = (await http().get('/v1/me').set(auth).expect(200)).body.id as string;
    await http().post('/v1/me/guidelines/accept').set(auth).expect(204);
    return { id, auth };
  }

  async function packageId(coins: number): Promise<string> {
    return (await prisma.coinPackage.findFirstOrThrow({ where: { coins } })).id;
  }

  async function topup(m: { auth: Record<string, string> }, coins = 2000) {
    const res = await http()
      .post('/v1/wallet/topups')
      .set(m.auth)
      .send({ package_id: await packageId(coins), provider: 'paystack' })
      .expect(201);
    return res.body as { id: string; reference: string; amount_kobo: number; checkout_url: string };
  }

  /** Paystack marks a reference as paid (the stub's view). */
  function paid(reference: string, amountKobo: number) {
    remote.set(reference, { outcome: 'succeeded', amountKobo, currency: 'NGN', paidAt: new Date() });
  }

  function webhook(payload: unknown, signature?: string) {
    const raw = JSON.stringify(payload);
    return http()
      .post('/v1/payments/paystack/webhook')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', signature ?? paystackSignature(raw, SECRET))
      .send(raw);
  }

  const chargeSuccess = (reference: string, amount = 1) => ({
    event: 'charge.success',
    data: { reference, amount, currency: 'NGN', status: 'success' },
  });

  async function expectLedgerBalanced() {
    const unbalanced = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT transaction_id AS id FROM ledger_entries GROUP BY transaction_id HAVING SUM(amount) <> 0`;
    expect(unbalanced).toEqual([]);
  }

  it('the wallet lists Paystack as the checkout, and a top-up starts a checkout', async () => {
    const m = await member();
    const wallet = await http().get('/v1/wallet').set(m.auth).expect(200);
    expect(wallet.body.payment_providers).toEqual(['paystack']);

    const t = await topup(m, 2000);
    expect(t).toMatchObject({
      status: 'pending',
      provider: 'paystack',
      coins: 2000,
      amount_kobo: 350000,
      price_ngn: 3500,
    });
    expect(t.checkout_url).toBe(`https://checkout.paystack.test/${t.reference}`);
    expect(t.reference).toMatch(/^amv_[0-9a-f]{24}$/);

    const sent = jest.mocked(paystack.startCheckout).mock.calls[0]![0];
    expect(sent).toMatchObject({ reference: t.reference, amountKobo: 350000 });
    // A phone-only member: a pseudonymous receipt address, and ids only in metadata.
    expect(sent.email).toMatch(/^m-[0-9a-f]{24}@members\.amivara\.com$/);
    expect(Object.keys(sent.metadata).sort()).toEqual(['coins', 'payment_intent_id']);
  });

  it('a signed charge.success webhook credits coins once, with the first-purchase bonus as promo coins', async () => {
    const m = await member(); // 100 starter coins come with the first wallet load
    await http().get('/v1/wallet').set(m.auth).expect(200);
    const t = await topup(m, 2000);
    paid(t.reference, 350000);

    await webhook(chargeSuccess(t.reference)).expect(200, { received: true });
    const wallet = await http().get('/v1/wallet').set(m.auth).expect(200);
    expect(wallet.body).toMatchObject({
      balance: 2500,
      paid_coins: 2000,
      promo_coins: 500,
      first_purchase_eligible: false,
    });

    // Paystack retries the same event: nothing more is credited.
    await webhook(chargeSuccess(t.reference)).expect(200);
    await webhook(chargeSuccess(t.reference)).expect(200);
    expect((await http().get('/v1/wallet').set(m.auth)).body.balance).toBe(2500);

    const status = await http().get(`/v1/wallet/topups/${t.id}`).set(m.auth).expect(200);
    expect(status.body).toMatchObject({
      status: 'succeeded',
      coins: 2000,
      bonus_coins: 400,
      total_coins: 2400,
      balance: 2500,
    });

    const history = await http().get('/v1/wallet/transactions').set(m.auth).expect(200);
    expect(history.body.transactions[0]).toMatchObject({ kind: 'topup', coins: 2400, reason: 'top_up' });
    expect(await prisma.ledgerTransaction.count({ where: { kind: 'TOPUP' } })).toBe(1);
    await expectLedgerBalanced();
  });

  it('only the first purchase gets the bonus', async () => {
    const m = await member();
    const first = await topup(m, 500);
    paid(first.reference, 100000);
    await webhook(chargeSuccess(first.reference)).expect(200);
    const second = await topup(m, 500);
    paid(second.reference, 100000);
    await webhook(chargeSuccess(second.reference)).expect(200);

    const w = await http().get('/v1/wallet').set(m.auth).expect(200);
    expect(w.body).toMatchObject({ paid_coins: 1000, promo_coins: 100 + 100 }); // starter + one bonus
    expect(w.body.packages[0]).toMatchObject({ coins: 500, total_coins: 500 });
  });

  it('refuses forged webhooks and never trusts the webhook body', async () => {
    const m = await member();
    const t = await topup(m, 10000);
    paid(t.reference, 1500000);

    await webhook(chargeSuccess(t.reference), 'a'.repeat(128)).expect(401);
    await webhook(chargeSuccess(t.reference), 'not-hex').expect(401);
    await http()
      .post('/v1/payments/paystack/webhook')
      .set('Content-Type', 'application/json')
      .send(chargeSuccess(t.reference))
      .expect(401);
    // Signed with another key.
    const raw = JSON.stringify(chargeSuccess(t.reference));
    await webhook(chargeSuccess(t.reference), paystackSignature(raw, 'sk_test_someone_else')).expect(401);
    expect(verifyCalls).toBe(0);

    // A correctly signed event for an unpaid reference credits nothing: Paystack's verify decides.
    remote.delete(t.reference);
    await webhook(chargeSuccess(t.reference, 1500000)).expect(200);
    expect((await http().get('/v1/wallet').set(m.auth)).body.paid_coins).toBe(0);
    // Unknown and foreign references are acknowledged and ignored.
    await webhook(chargeSuccess('amv_000000000000000000000000')).expect(200);
    await webhook(chargeSuccess('someone-elses-ref')).expect(200);
    await webhook({ event: 'transfer.success', data: { reference: t.reference } }).expect(200);
  });

  it('a payment for the wrong amount is held, not credited', async () => {
    const m = await member();
    const t = await topup(m, 30000);
    paid(t.reference, 100000); // ₦1,000 paid for the ₦40,000 package
    await webhook(chargeSuccess(t.reference)).expect(200);

    const status = await http().get(`/v1/wallet/topups/${t.id}`).set(m.auth).expect(200);
    expect(status.body).toMatchObject({ status: 'failed', balance: null });
    expect((await prisma.paymentIntent.findUniqueOrThrow({ where: { id: t.id } })).failureReason).toBe(
      'amount_mismatch',
    );
    expect((await http().get('/v1/wallet').set(m.auth)).body.paid_coins).toBe(0);
  });

  it('the app poll credits a payment whose webhook never came; only the owner can see it', async () => {
    const m = await member();
    const other = await member();
    const t = await topup(m, 500);

    const pending = await http().get(`/v1/wallet/topups/${t.id}`).set(m.auth).expect(200);
    expect(pending.body.status).toBe('pending');
    paid(t.reference, 100000);
    await new Promise((r) => setTimeout(r, 3100)); // the poll asks Paystack at most every 3 seconds
    const done = await http().get(`/v1/wallet/topups/${t.id}`).set(m.auth).expect(200);
    expect(done.body).toMatchObject({ status: 'succeeded', total_coins: 600, balance: 600 }); // wallet not opened yet: no starter coins

    await http().get(`/v1/wallet/topups/${t.id}`).set(other.auth).expect(404);
    await http().get(`/v1/wallet/topups/${t.id}`).expect(401);
  });

  it('webhooks, polls and the reconciler racing on one payment credit it once', async () => {
    const m = await member();
    const t = await topup(m, 2000);
    paid(t.reference, 350000);
    await Promise.all([
      ...Array.from({ length: 5 }, () => webhook(chargeSuccess(t.reference)).expect(200)),
      ...Array.from({ length: 5 }, () => payments.confirm(t.reference)),
    ]);
    const w = await http().get('/v1/wallet').set(m.auth).expect(200);
    expect(w.body).toMatchObject({ paid_coins: 2000, promo_coins: 100 + 400 });
    expect(await prisma.ledgerTransaction.count({ where: { kind: 'TOPUP' } })).toBe(1);
    await expectLedgerBalanced();
  });

  it('reconciliation: credits late payments, records declines, abandons day-old checkouts', async () => {
    const m = await member();
    const late = await topup(m, 500);
    const declined = await topup(m, 2000);
    const stale = await topup(m, 10000);
    await prisma.paymentIntent.updateMany({ data: { createdAt: new Date(Date.now() - 10 * 60 * 1000) } });
    await prisma.paymentIntent.update({
      where: { id: stale.id },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });
    paid(late.reference, 100000);
    remote.set(declined.reference, { outcome: 'failed', reason: 'Declined' });

    expect(await payments.reconcile()).toEqual({ checked: 3, succeeded: 1, failed: 1, abandoned: 1 });
    const rows = await prisma.paymentIntent.findMany({ orderBy: { amountKobo: 'asc' } });
    expect(rows.map((r) => [r.coins, r.status, r.failureReason])).toEqual([
      [500, 'SUCCEEDED', null],
      [2000, 'FAILED', 'declined: Declined'],
      [10000, 'ABANDONED', null],
    ]);

    // An abandoned checkout that is paid after all still credits.
    paid(stale.reference, 1500000);
    await webhook(chargeSuccess(stale.reference)).expect(200);
    expect((await http().get('/v1/wallet').set(m.auth)).body.paid_coins).toBe(10500);
    await expectLedgerBalanced();
  });

  it('validates packages and providers, and limits unfinished checkouts', async () => {
    const m = await member();
    await http()
      .post('/v1/wallet/topups')
      .set(m.auth)
      .send({ package_id: '00000000-0000-4000-8000-000000000000' })
      .expect(404);
    const play = await http()
      .post('/v1/wallet/topups')
      .set(m.auth)
      .send({ package_id: await packageId(500), provider: 'google_play' })
      .expect(503);
    expect(play.body.error.code).toBe('PAYMENTS_UNAVAILABLE');
    await http().post('/v1/wallet/topups').set(m.auth).send({ package_id: 'nope' }).expect(400);

    for (let i = 0; i < 10; i++) await topup(m, 500);
    const limited = await http()
      .post('/v1/wallet/topups')
      .set(m.auth)
      .send({ package_id: await packageId(500) })
      .expect(429);
    expect(limited.body.error.code).toBe('TOPUP_RATE_LIMITED');
  });

  it('a provider outage while starting checkout fails cleanly', async () => {
    const m = await member();
    jest
      .mocked(paystack.startCheckout)
      .mockRejectedValueOnce(new ApiError(HttpStatus.BAD_GATEWAY, 'PAYMENT_PROVIDER_ERROR', 'Provider down'));
    const res = await http()
      .post('/v1/wallet/topups')
      .set(m.auth)
      .send({ package_id: await packageId(500) })
      .expect(502);
    expect(res.body.error.code).toBe('PAYMENT_PROVIDER_ERROR');
    const intent = await prisma.paymentIntent.findFirstOrThrow();
    expect(intent).toMatchObject({ status: 'FAILED', failureReason: 'checkout_not_started' });
  });

  it('the database keeps succeeded top-ups tied to their ledger transaction', async () => {
    const m = await member();
    const t = await topup(m, 500);
    await expect(
      prisma.paymentIntent.update({ where: { id: t.id }, data: { status: 'SUCCEEDED', paidAt: new Date() } }),
    ).rejects.toThrow(/payment_intents_succeeded_chk/);
  });
});
