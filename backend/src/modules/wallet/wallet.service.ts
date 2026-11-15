import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Prisma } from '../../../generated/prisma';
import { ApiError } from '../../common/api-error';
import { HasherService } from '../../common/hasher.service';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService, type TransactionKind } from './ledger.service';

export interface Balances {
  balance: number;
  paid: number;
  promo: number;
}

export interface SpendResult extends Balances {
  transactionId: string;
  /** Coins taken from promo (starter/promotional) coins: these never become Host earnings. */
  promoSpent: number;
  /** Coins taken from bought coins: the only part a Host can earn from (M3). */
  paidSpent: number;
}

const kobo = (n: bigint) => Number(n);

/**
 * Member wallets (MONETIZATION_PLAN.md M1): balances, starter coins, spending
 * (promo coins first) and staff adjustments, all on top of LedgerService.
 */
@Injectable()
export class WalletService {
  private readonly starterCoins: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly hasher: HasherService,
    config: ConfigService<Env, true>,
  ) {
    this.starterCoins = config.get('STARTER_COINS', { infer: true });
  }

  async balances(userId: string): Promise<Balances> {
    const [paid, promo] = await Promise.all([
      this.ledger.balance(userId, 'MEMBER_COINS_PAID'),
      this.ledger.balance(userId, 'MEMBER_COINS_PROMO'),
    ]);
    return { balance: paid + promo, paid, promo };
  }

  /** GET /wallet: grants starter coins first if the member is due them. */
  async wallet(userId: string, sessionId: string | undefined) {
    const starter = await this.ensureStarter(userId, sessionId);
    const [balances, packages, purchases] = await Promise.all([
      this.balances(userId),
      this.prisma.coinPackage.findMany({ where: { active: true }, orderBy: { sort: 'asc' } }),
      this.prisma.ledgerTransaction.count({ where: { userId, kind: 'TOPUP' } }),
    ]);
    const firstPurchase = purchases === 0;
    return {
      balance: balances.balance,
      paid_coins: balances.paid,
      promo_coins: balances.promo,
      starter: { granted: starter.granted, coins: this.starterCoins },
      first_purchase_eligible: firstPurchase,
      packages: packages.map((p) => ({
        id: p.id,
        coins: p.coins,
        bonus_coins: p.bonusCoins,
        first_purchase_bonus: p.firstPurchaseBonus,
        total_coins: p.coins + p.bonusCoins + (firstPurchase ? p.firstPurchaseBonus : 0),
        price_kobo: kobo(p.priceKobo),
        price_ngn: kobo(p.priceKobo) / 100,
        play_product_id: p.playProductId,
        label: p.label,
      })),
    };
  }

  /**
   * One-time starter coins (MONETIZATION_PLAN.md 3a): only after the community
   * guidelines are accepted, once per member and once per device, so
   * throwaway accounts can't farm them. Returns whether the member has them.
   */
  async ensureStarter(userId: string, sessionId: string | undefined): Promise<{ granted: boolean }> {
    const key = `starter:${userId}`;
    if (await this.prisma.ledgerTransaction.findUnique({ where: { idempotencyKey: key }, select: { id: true } })) {
      return { granted: true };
    }
    if (this.starterCoins <= 0 || !sessionId) return { granted: false };

    const [user, session] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { status: true, guidelinesAcceptedAt: true } }),
      this.prisma.deviceSession.findUnique({ where: { id: sessionId }, select: { deviceHash: true } }),
    ]);
    if (!user?.guidelinesAcceptedAt || (user.status !== 'ACTIVE' && user.status !== 'PAUSED'))
      return { granted: false };
    if (!session?.deviceHash) return { granted: false }; // no device id: can't enforce once-per-device
    const subject = this.hasher.hash('device', `promo:${session.deviceHash}`);

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.promoClaim.create({ data: { kind: 'starter', subject, userId } });
        await this.ledger.post(
          {
            kind: 'STARTER_GRANT',
            idempotencyKey: key,
            userId,
            metadata: { reason: 'starter_coins' },
            postings: [
              { ownerId: null, kind: 'PLATFORM_PROMO', amount: -this.starterCoins },
              { ownerId: userId, kind: 'MEMBER_COINS_PROMO', amount: this.starterCoins },
            ],
          },
          tx,
        );
      });
      return { granted: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Either this device already claimed starter coins, or a concurrent request just granted them.
        const mine = await this.prisma.ledgerTransaction.findUnique({ where: { idempotencyKey: key } });
        return { granted: mine !== null };
      }
      throw error;
    }
  }

  /**
   * Spends coins: promo coins first, then bought coins. Concurrent spends are
   * serialised on the member's account rows, and the database refuses any
   * overdraft. 402 INSUFFICIENT_COINS when the balance can't cover it, which
   * the app turns into the in-place top-up sheet.
   */
  async spend(input: {
    userId: string;
    coins: number;
    kind?: TransactionKind;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<SpendResult> {
    if (!Number.isInteger(input.coins) || input.coins <= 0) throw new Error('Spend must be a positive whole number');
    const existing = await this.prisma.ledgerTransaction.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing)
      return {
        ...(await this.balances(input.userId)),
        ...(existing.metadata as object),
        transactionId: existing.id,
      } as SpendResult;

    const result = await this.prisma.$transaction(async (tx) => {
      // Lock the member's coin accounts for the rest of the transaction.
      const rows = await tx.$queryRaw<Array<{ kind: string; balance: bigint }>>`
        SELECT kind::text AS kind, balance FROM ledger_accounts
         WHERE owner_id = ${input.userId}::uuid AND kind IN ('MEMBER_COINS_PAID', 'MEMBER_COINS_PROMO')
         FOR UPDATE`;
      const promo = Number(rows.find((r) => r.kind === 'MEMBER_COINS_PROMO')?.balance ?? 0n);
      const paid = Number(rows.find((r) => r.kind === 'MEMBER_COINS_PAID')?.balance ?? 0n);
      if (promo + paid < input.coins) {
        throw new ApiError(HttpStatus.PAYMENT_REQUIRED, 'INSUFFICIENT_COINS', "You don't have enough coins.", {
          balance: promo + paid,
          required: input.coins,
        });
      }
      const promoSpent = Math.min(promo, input.coins);
      const paidSpent = input.coins - promoSpent;
      const postings = [
        ...(promoSpent
          ? [
              { ownerId: input.userId, kind: 'MEMBER_COINS_PROMO' as const, amount: -promoSpent },
              { ownerId: null, kind: 'PLATFORM_PROMO' as const, amount: promoSpent },
            ]
          : []),
        ...(paidSpent
          ? [
              { ownerId: input.userId, kind: 'MEMBER_COINS_PAID' as const, amount: -paidSpent },
              { ownerId: null, kind: 'PLATFORM_REVENUE' as const, amount: paidSpent },
            ]
          : []),
      ];
      const posted = await this.ledger.post(
        {
          kind: input.kind ?? 'SPEND',
          idempotencyKey: input.idempotencyKey,
          userId: input.userId,
          metadata: { ...(input.metadata ?? {}), promoSpent, paidSpent },
          postings,
        },
        tx,
      );
      return { transactionId: posted.id, promoSpent, paidSpent };
    });
    return { ...(await this.balances(input.userId)), ...result };
  }

  /** Staff credit (+) or debit (−) of promo or paid coins. Audited by the caller. */
  async adjust(input: {
    actorId: string;
    userId: string;
    coins: number;
    wallet: 'promo' | 'paid';
    reason: string;
    idempotencyKey: string;
  }): Promise<Balances & { transactionId: string }> {
    const kind = input.wallet === 'paid' ? 'MEMBER_COINS_PAID' : 'MEMBER_COINS_PROMO';
    const posted = await this.ledger.post({
      kind: 'ADJUSTMENT',
      idempotencyKey: input.idempotencyKey,
      userId: input.userId,
      actorId: input.actorId,
      metadata: { reason: input.reason, wallet: input.wallet },
      postings: [
        { ownerId: input.userId, kind, amount: input.coins },
        { ownerId: null, kind: 'PLATFORM_ADJUSTMENTS', amount: -input.coins },
      ],
    });
    return { ...(await this.balances(input.userId)), transactionId: posted.id };
  }

  /** The member's own history: one line per transaction, with the net change to their coins. */
  async history(userId: string, opts: { before?: string; limit: number }) {
    const before = opts.before
      ? await this.prisma.ledgerTransaction.findFirst({
          where: { id: opts.before, userId },
          select: { createdAt: true },
        })
      : null;
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; kind: string; created_at: Date; metadata: unknown; net: bigint }>
    >`
      SELECT t.id, t.kind::text AS kind, t.created_at, t.metadata, SUM(e.amount) AS net
        FROM ledger_transactions t
        JOIN ledger_entries e ON e.transaction_id = t.id
        JOIN ledger_accounts a ON a.id = e.account_id
       WHERE a.owner_id = ${userId}::uuid AND a.kind IN ('MEMBER_COINS_PAID', 'MEMBER_COINS_PROMO')
         AND (${before?.createdAt ?? null}::timestamptz IS NULL OR t.created_at < ${before?.createdAt ?? null}::timestamptz)
       GROUP BY t.id
       ORDER BY t.created_at DESC
       LIMIT ${opts.limit + 1}::int`;
    const page = rows.slice(0, opts.limit);
    return {
      transactions: page.map((r) => ({
        id: r.id,
        kind: r.kind.toLowerCase(),
        coins: Number(r.net),
        created_at: r.created_at.toISOString(),
        reason: (r.metadata as { reason?: string } | null)?.reason ?? null,
      })),
      next_before: rows.length > opts.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }
}
