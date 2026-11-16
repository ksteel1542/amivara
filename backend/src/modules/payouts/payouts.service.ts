import { randomBytes } from 'node:crypto';

import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Payout, PayoutAccount } from '../../../generated/prisma';
import { ApiError } from '../../common/api-error';
import { MessageCipher } from '../../common/message-cipher';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { HostsService } from '../hosts/hosts.service';
import { LedgerService } from '../wallet/ledger.service';
import { PAYOUT_PROVIDER, type PayoutProvider, type TransferOutcome, TransferRefused } from './payout-provider';

type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

export const PAYOUT_REFERENCE_PREFIX = 'amvpo_';
/** Account look-ups per member per hour (each one is a call to the bank network). */
export const RESOLVES_PER_HOUR = 10;

/**
 * Host payouts (MONETIZATION_PLAN.md M7/M8) via Paystack Transfers.
 *
 * Earnings mature from held to available after the hold (HostsService.releaseDue,
 * also run here before any balance is shown or withdrawn). A withdrawal moves
 * available coins to PAYOUT_CLEARING in the same transaction that records the
 * payout, under a lock on the member's earnings account, and the database
 * allows one pending payout per member: the same balance can't go out twice.
 * Then the transfer starts with our unique reference. Paystack's answer (or its
 * webhook, always re-checked with verify) settles the payout (clearing →
 * PLATFORM_PAYOUTS) or returns the coins (→ available earnings). Off unless
 * PAYOUTS_ENABLED.
 */
@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);
  readonly enabled: boolean;
  readonly koboPerCoin: number;
  readonly minKobo: number;
  private readonly resolves = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly hosts: HostsService,
    private readonly cipher: MessageCipher,
    @Inject(PAYOUT_PROVIDER) private readonly provider: PayoutProvider,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('PAYOUTS_ENABLED', { infer: true });
    this.koboPerCoin = config.get('PAYOUT_KOBO_PER_COIN', { infer: true });
    this.minKobo = config.get('PAYOUT_MIN_NAIRA', { infer: true }) * 100;
  }

  /** The fewest coins that can be withdrawn. */
  get minCoins(): number {
    return Math.ceil(this.minKobo / this.koboPerCoin);
  }

  // ── Bank account ──

  async banks() {
    this.requireProvider();
    return { banks: await this.provider.listBanks() };
  }

  /** POST /hosts/bank-account/resolve: the account holder's name, before saving. */
  async resolve(userId: string, bankCode: string, accountNumber: string) {
    await this.requireHost(userId, { active: true });
    this.requireProvider();
    this.rateLimitResolve(userId);
    const bank = await this.bank(bankCode);
    const resolved = await this.provider.resolveAccount(accountNumber, bankCode);
    if (!resolved) throw this.notResolved();
    return {
      bank_code: bank.code,
      bank_name: bank.name,
      account_name: resolved.accountName,
      account_last4: accountNumber.slice(-4),
    };
  }

  /**
   * POST /hosts/bank-account: resolves the account again on the server (the app's
   * copy is never trusted), registers it with Paystack, and saves it encrypted.
   */
  async saveAccount(userId: string, bankCode: string, accountNumber: string) {
    await this.requireHost(userId, { active: true });
    this.requireProvider();
    if (await this.prisma.payout.count({ where: { userId, status: 'PENDING' } })) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'PAYOUT_IN_PROGRESS',
        'You can change your bank account once your payout completes.',
      );
    }
    this.rateLimitResolve(userId);
    const bank = await this.bank(bankCode);
    const resolved = await this.provider.resolveAccount(accountNumber, bankCode);
    if (!resolved) throw this.notResolved();
    const recipientCode = await this.provider.createRecipient({
      name: resolved.accountName,
      accountNumber,
      bankCode,
    });
    const data = {
      bankCode,
      bankName: bank.name,
      accountNumberEnc: this.cipher.encrypt(accountNumber),
      accountLast4: accountNumber.slice(-4),
      accountName: resolved.accountName,
      recipientCode,
    };
    const saved = await this.prisma.payoutAccount.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return { account: this.accountView(saved) };
  }

  async account(userId: string) {
    await this.requireHost(userId, { active: false });
    const account = await this.prisma.payoutAccount.findUnique({ where: { userId } });
    return { account: account ? this.accountView(account) : null };
  }

  // ── Balances and history ──

  /** GET /hosts/payouts: held vs available (coins and naira), the rules, the account and the history. */
  async summary(userId: string) {
    await this.requireHost(userId, { active: false });
    await this.hosts.releaseDue(new Date(), 500, userId);
    const [pending, available, account, payouts] = await Promise.all([
      this.ledger.balance(userId, 'MEMBER_EARNINGS_PENDING'),
      this.ledger.balance(userId, 'MEMBER_EARNINGS_AVAILABLE'),
      this.prisma.payoutAccount.findUnique({ where: { userId } }),
      this.prisma.payout.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 30 }),
    ]);
    return {
      pending_coins: pending,
      pending_kobo: pending * this.koboPerCoin,
      available_coins: available,
      available_kobo: available * this.koboPerCoin,
      kobo_per_coin: this.koboPerCoin,
      min_withdraw_coins: this.minCoins,
      min_withdraw_kobo: this.minKobo,
      payouts_enabled: this.enabled && this.provider.configured,
      account: account ? this.accountView(account) : null,
      payouts: payouts.map((p) => this.view(p)),
    };
  }

  // ── Withdrawing ──

  /** POST /hosts/withdraw: all available earnings, or `coins` of them. */
  async withdraw(userId: string, requestedCoins?: number) {
    if (!this.enabled) {
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'PAYOUTS_DISABLED',
        'Withdrawals are paused right now. Your earnings are safe.',
      );
    }
    this.requireProvider();
    await this.requireHost(userId, { active: false });
    const account = await this.prisma.payoutAccount.findUnique({ where: { userId } });
    if (!account) throw new ApiError(HttpStatus.CONFLICT, 'NO_PAYOUT_ACCOUNT', 'Add your bank account first.');
    await this.hosts.releaseDue(new Date(), 500, userId);

    const reference = `${PAYOUT_REFERENCE_PREFIX}${randomBytes(12).toString('hex')}`;
    const payout = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`payout:${userId}`}, 0))`;
      if (await tx.payout.count({ where: { userId, status: 'PENDING' } })) {
        throw new ApiError(HttpStatus.CONFLICT, 'PAYOUT_IN_PROGRESS', 'Your last payout is still on its way.');
      }
      const [row] = await tx.$queryRaw<Array<{ balance: bigint }>>`
        SELECT balance FROM ledger_accounts
         WHERE owner_id = ${userId}::uuid AND kind = 'MEMBER_EARNINGS_AVAILABLE'
         FOR UPDATE`;
      const available = Number(row?.balance ?? 0n);
      const coins = requestedCoins ?? available;
      if (coins < this.minCoins) {
        throw new ApiError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'BELOW_MINIMUM_WITHDRAWAL',
          `The minimum withdrawal is ₦${(this.minKobo / 100).toLocaleString('en-NG')}.`,
          { min_coins: this.minCoins, min_kobo: this.minKobo, available_coins: available },
        );
      }
      if (coins > available) {
        throw new ApiError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'INSUFFICIENT_EARNINGS',
          "That's more than you can withdraw.",
          {
            available_coins: available,
          },
        );
      }
      const posted = await this.ledger.post(
        {
          kind: 'PAYOUT',
          idempotencyKey: `payout:${reference}`,
          userId,
          metadata: { reason: 'payout', reference },
          postings: [
            { ownerId: userId, kind: 'MEMBER_EARNINGS_AVAILABLE', amount: -coins },
            { ownerId: null, kind: 'PAYOUT_CLEARING', amount: coins },
          ],
        },
        tx,
      );
      return tx.payout.create({
        data: {
          userId,
          coins,
          amountKobo: BigInt(coins * this.koboPerCoin),
          reference,
          bankName: account.bankName,
          accountLast4: account.accountLast4,
          accountName: account.accountName,
          ledgerTransactionId: posted.id,
        },
      });
    });

    try {
      const started = await this.provider.transfer({
        amountKobo: Number(payout.amountKobo),
        recipientCode: account.recipientCode,
        reference,
        reason: 'AMIVARA Host earnings',
      });
      if (started.transferCode) {
        await this.prisma.payout.update({ where: { id: payout.id }, data: { transferCode: started.transferCode } });
      }
      if (started.outcome !== 'pending') await this.apply(reference, started.outcome, started.transferCode, null);
    } catch (error) {
      if (error instanceof TransferRefused) {
        // Nothing was sent: the coins go straight back.
        await this.apply(reference, 'failed', null, error.message.slice(0, 120));
      } else {
        // Unknown (timeout, outage): it may have gone. Stays pending; the webhook or reconciler settles it.
        this.logger.warn(`Transfer ${reference} outcome unknown: ${(error as Error).message}`);
      }
    }
    const fresh = await this.prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    return { payout: this.view(fresh) };
  }

  /**
   * A Paystack transfer.* webhook. The body is only a prompt: the outcome is
   * read back from Paystack (verify transfer) before anything moves.
   */
  async onTransferEvent(reference: string): Promise<void> {
    if (!reference.startsWith(PAYOUT_REFERENCE_PREFIX)) return;
    const payout = await this.prisma.payout.findUnique({ where: { reference } });
    if (!payout) {
      this.logger.warn('Transfer webhook for an unknown payout');
      return;
    }
    const verified = await this.provider.verifyTransfer(reference);
    await this.apply(reference, verified.outcome, verified.transferCode, verified.reason);
  }

  /** Re-checks payouts that have been pending a while (lost webhooks, timeouts). */
  async reconcile(olderThanMs = 2 * 60_000): Promise<number> {
    if (!this.provider.configured) return 0;
    const stuck = await this.prisma.payout.findMany({
      where: { status: 'PENDING', createdAt: { lte: new Date(Date.now() - olderThanMs) } },
      select: { reference: true },
      take: 100,
    });
    let changed = 0;
    for (const { reference } of stuck) {
      try {
        const verified = await this.provider.verifyTransfer(reference);
        if (await this.apply(reference, verified.outcome, verified.transferCode, verified.reason)) changed++;
      } catch (error) {
        this.logger.warn(`Reconciling payout failed: ${(error as Error).message}`);
      }
    }
    return changed;
  }

  /**
   * Moves a payout to its outcome, once, under a row lock:
   * pending → success (clearing → PLATFORM_PAYOUTS), pending → failed (clearing → available),
   * success → reversed (PLATFORM_PAYOUTS → available). Anything else changes nothing.
   */
  private async apply(
    reference: string,
    outcome: TransferOutcome,
    transferCode: string | null,
    reason: string | null,
  ): Promise<boolean> {
    if (outcome === 'pending') return false;
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM payouts WHERE reference = ${reference} FOR UPDATE`;
      const payout = await tx.payout.findUnique({ where: { reference } });
      if (!payout || !payout.userId) return false;
      const now = new Date();
      if (payout.status === 'PENDING' && outcome === 'success') {
        const settled = await this.post(tx, 'PAYOUT_SETTLED', `payout-settled:${reference}`, payout, [
          { ownerId: null, kind: 'PAYOUT_CLEARING', amount: -payout.coins },
          { ownerId: null, kind: 'PLATFORM_PAYOUTS', amount: payout.coins },
        ]);
        await tx.payout.update({
          where: { id: payout.id },
          data: {
            status: 'SUCCESS',
            settleTransactionId: settled,
            completedAt: now,
            transferCode: transferCode ?? payout.transferCode,
          },
        });
        return true;
      }
      if (payout.status === 'PENDING' && (outcome === 'failed' || outcome === 'reversed')) {
        const returned = await this.post(tx, 'PAYOUT_RETURN', `payout-return:${reference}`, payout, [
          { ownerId: null, kind: 'PAYOUT_CLEARING', amount: -payout.coins },
          { ownerId: payout.userId, kind: 'MEMBER_EARNINGS_AVAILABLE', amount: payout.coins },
        ]);
        await tx.payout.update({
          where: { id: payout.id },
          data: {
            status: 'FAILED',
            returnTransactionId: returned,
            completedAt: now,
            failureReason: reason ?? 'Transfer failed',
          },
        });
        return true;
      }
      if (payout.status === 'SUCCESS' && outcome === 'reversed') {
        const returned = await this.post(tx, 'PAYOUT_RETURN', `payout-return:${reference}`, payout, [
          { ownerId: null, kind: 'PLATFORM_PAYOUTS', amount: -payout.coins },
          { ownerId: payout.userId, kind: 'MEMBER_EARNINGS_AVAILABLE', amount: payout.coins },
        ]);
        await tx.payout.update({
          where: { id: payout.id },
          data: { status: 'REVERSED', returnTransactionId: returned, failureReason: reason ?? 'Reversed by the bank' },
        });
        return true;
      }
      return false;
    });
  }

  private async post(
    tx: Tx,
    kind: 'PAYOUT_SETTLED' | 'PAYOUT_RETURN',
    key: string,
    payout: Payout,
    postings: Array<{
      ownerId: string | null;
      kind: 'PAYOUT_CLEARING' | 'PLATFORM_PAYOUTS' | 'MEMBER_EARNINGS_AVAILABLE';
      amount: number;
    }>,
  ): Promise<string> {
    const posted = await this.ledger.post(
      {
        kind,
        idempotencyKey: key,
        userId: payout.userId!,
        metadata: { reason: kind.toLowerCase(), reference: payout.reference },
        postings,
      },
      tx,
    );
    return posted.id;
  }

  // ── helpers ──

  private async requireHost(userId: string, opts: { active: boolean }): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { ageVerified: true, status: true, hostProfile: { select: { status: true } } },
    });
    if (!user.ageVerified) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'VERIFICATION_REQUIRED', 'Verify your identity to receive payouts.', {
        reason: 'payouts_require_verification',
      });
    }
    // Suspended or banned members' earnings are frozen while Safety reviews.
    if (user.status !== 'ACTIVE' || !user.hostProfile || (opts.active && user.hostProfile.status !== 'ACTIVE')) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'HOST_ONLY', 'Payouts are for active Verified Hosts.');
    }
  }

  private requireProvider(): void {
    if (!this.provider.configured) {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'PAYOUTS_UNAVAILABLE', 'Payouts are not available right now.');
    }
  }

  private async bank(code: string) {
    const bank = (await this.provider.listBanks()).find((b) => b.code === code);
    if (!bank) throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Choose your bank from the list.');
    return bank;
  }

  private rateLimitResolve(userId: string): void {
    const now = Date.now();
    const recent = (this.resolves.get(userId) ?? []).filter((t) => now - t < 60 * 60_000);
    if (recent.length >= RESOLVES_PER_HOUR) {
      throw new ApiError(
        HttpStatus.TOO_MANY_REQUESTS,
        'RESOLVE_RATE_LIMITED',
        'Too many account checks. Try again in an hour.',
        {
          retry_after: 3600,
        },
      );
    }
    recent.push(now);
    this.resolves.set(userId, recent);
  }

  private notResolved(): ApiError {
    return new ApiError(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'ACCOUNT_NOT_RESOLVED',
      "We couldn't find that account. Check the bank and the 10-digit account number.",
    );
  }

  private accountView(a: PayoutAccount) {
    return { bank_code: a.bankCode, bank_name: a.bankName, account_last4: a.accountLast4, account_name: a.accountName };
  }

  private view(p: Payout) {
    return {
      id: p.id,
      coins: p.coins,
      amount_kobo: Number(p.amountKobo),
      status: p.status.toLowerCase(),
      bank_name: p.bankName,
      account_last4: p.accountLast4,
      account_name: p.accountName,
      failure_reason: p.failureReason,
      created_at: p.createdAt.toISOString(),
      completed_at: p.completedAt?.toISOString() ?? null,
    };
  }
}
