import { randomBytes } from 'node:crypto';

import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { PaymentIntent } from '../../../generated/prisma';
import { ApiError } from '../../common/api-error';
import { HasherService } from '../../common/hasher.service';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService, type Posting } from '../wallet/ledger.service';
import { WalletService } from '../wallet/wallet.service';
import { enabledProviders, PROVIDER_ENUM, type PaymentProvider, type ProviderName } from './payment-provider';

export const PAYMENT_PROVIDER_LIST = Symbol('PAYMENT_PROVIDER_LIST');

/** Our references start with this, so webhooks for other integrations on the same Paystack account are ignored. */
export const REFERENCE_PREFIX = 'amv_';
/** At most this many unfinished checkouts per member per hour. */
export const MAX_PENDING_PER_HOUR = 10;
/** A checkout still unpaid after this long is marked abandoned (a late payment still credits). */
export const ABANDON_AFTER_MS = 24 * 60 * 60 * 1000;
/** The reconciler stops asking the provider about a checkout after this long. */
const RECONCILE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** The app polls a top-up while the member pays: ask the provider at most this often per checkout. */
const REFRESH_MIN_MS = 3_000;

const providerName = (p: PaymentIntent['provider']): ProviderName => (p === 'PAYSTACK' ? 'paystack' : 'google_play');

/**
 * Coin top-ups (MONETIZATION_PLAN.md M2). A checkout creates a payment intent;
 * coins are credited only after the provider's own API confirms the payment
 * (a webhook or the app only prompts the check), exactly once per reference,
 * whichever of webhook, app poll or reconciler gets there first.
 *
 * Bought coins are credited as paid coins. Package and first-purchase bonus
 * coins are credited as promo coins, so they can never become Host earnings.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly enabled: Set<ProviderName>;
  private readonly lastRefresh = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly wallets: WalletService,
    private readonly hasher: HasherService,
    @Inject(PAYMENT_PROVIDER_LIST) private readonly providers: PaymentProvider[],
    config: ConfigService<Env, true>,
  ) {
    this.enabled = enabledProviders(config.get('PAYMENT_PROVIDERS', { infer: true }));
  }

  /** Providers this API accepts and can actually use: the app hides top-ups when empty. */
  available(): ProviderName[] {
    return this.providers.filter((p) => this.enabled.has(p.name) && p.configured).map((p) => p.name);
  }

  private provider(name: ProviderName): PaymentProvider {
    const provider = this.providers.find((p) => p.name === name);
    if (!provider || !this.enabled.has(name) || !provider.configured) {
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'PAYMENTS_UNAVAILABLE',
        'Top-ups are not available right now.',
      );
    }
    return provider;
  }

  /** POST /wallet/topups: a payment intent and the provider's checkout URL. */
  async createTopup(userId: string, input: { packageId: string; provider: ProviderName }) {
    const provider = this.provider(input.provider);
    const pkg = await this.prisma.coinPackage.findFirst({ where: { id: input.packageId, active: true } });
    if (!pkg) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'That coin package is not available.');

    const recent = await this.prisma.paymentIntent.count({
      where: { userId, status: 'PENDING', createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
    });
    if (recent >= MAX_PENDING_PER_HOUR) {
      throw new ApiError(
        HttpStatus.TOO_MANY_REQUESTS,
        'TOPUP_RATE_LIMITED',
        'Too many unfinished top-ups. Please try again later.',
      );
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, emailVerifiedAt: true },
    });
    // Paystack needs an email for the receipt. Members without a verified email get a
    // pseudonymous address on our domain, so no other identifier is shared.
    const email =
      user.email && user.emailVerifiedAt
        ? user.email
        : `m-${this.hasher.hash('email', `paystack:${userId}`).slice(0, 24)}@members.amivara.com`;

    const intent = await this.prisma.paymentIntent.create({
      data: {
        userId,
        packageId: pkg.id,
        provider: PROVIDER_ENUM[input.provider],
        reference: `${REFERENCE_PREFIX}${randomBytes(12).toString('hex')}`,
        amountKobo: pkg.priceKobo,
        coins: pkg.coins,
      },
    });
    try {
      const { checkoutUrl } = await provider.startCheckout({
        reference: intent.reference,
        amountKobo: Number(pkg.priceKobo),
        email,
        // Ids only: no names, phone numbers or other profile data go to the provider.
        metadata: { payment_intent_id: intent.id, coins: pkg.coins },
      });
      return { ...(await this.view(intent)), checkout_url: checkoutUrl };
    } catch (error) {
      await this.prisma.paymentIntent.updateMany({
        where: { id: intent.id, status: 'PENDING' },
        data: { status: 'FAILED', failureReason: 'checkout_not_started' },
      });
      throw error;
    }
  }

  /**
   * GET /wallet/topups/:id: the app polls this while the member pays. A pending
   * top-up is re-checked with the provider (at most every few seconds), so coins
   * arrive even if the webhook is late.
   */
  async getTopup(userId: string, id: string) {
    let intent = await this.prisma.paymentIntent.findFirst({ where: { id, userId } });
    if (!intent) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Top-up not found.');
    if (intent.status === 'PENDING' || intent.status === 'ABANDONED') {
      const last = this.lastRefresh.get(intent.id) ?? 0;
      if (Date.now() - last >= REFRESH_MIN_MS) {
        this.lastRefresh.set(intent.id, Date.now());
        if (this.lastRefresh.size > 10_000) this.lastRefresh.clear();
        try {
          intent = await this.confirm(intent.reference);
        } catch (error) {
          // The provider being unreachable is not the member's problem: report the stored status.
          if (!(error instanceof ApiError)) throw error;
        }
      }
    }
    return this.view(intent!);
  }

  /**
   * Asks the provider about one reference and applies the answer once.
   * Safe to call any number of times, from any instance.
   */
  async confirm(reference: string): Promise<PaymentIntent | null> {
    const intent = await this.prisma.paymentIntent.findUnique({ where: { reference } });
    if (!intent) return null;
    if (intent.status === 'SUCCEEDED' || intent.status === 'FAILED') return intent;

    const v = await this.provider(providerName(intent.provider)).verify(reference);
    if (v.outcome === 'pending') return intent;
    if (v.outcome === 'failed') {
      return this.fail(intent, v.reason ? `declined: ${v.reason}`.slice(0, 64) : 'declined');
    }
    // Paid: but only for exactly what we asked. Anything else is held for staff.
    if (v.amountKobo !== Number(intent.amountKobo) || v.currency !== intent.currency) {
      this.logger.error(
        `Top-up ${intent.id}: provider reports ${v.amountKobo} ${v.currency}, expected ${intent.amountKobo} ${intent.currency}`,
      );
      return this.fail(intent, 'amount_mismatch');
    }
    return this.credit(intent, v);
  }

  private async fail(intent: PaymentIntent, reason: string): Promise<PaymentIntent> {
    await this.prisma.paymentIntent.updateMany({
      where: { id: intent.id, status: { in: ['PENDING', 'ABANDONED'] } },
      data: { status: 'FAILED', failureReason: reason },
    });
    return this.prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
  }

  private async credit(
    intent: PaymentIntent,
    v: { providerTransactionId: string | null; channel: string | null; paidAt: Date | null },
  ): Promise<PaymentIntent> {
    if (!intent.userId) {
      // Paid after the member erased their account: nobody to credit. Staff refund it.
      this.logger.error(`Top-up ${intent.id} was paid after its member was erased: refund it`);
      return this.fail(intent, 'member_erased_refund_due');
    }
    const userId = intent.userId;
    await this.prisma.$transaction(async (tx) => {
      // One top-up at a time per member, so the first-purchase bonus is given once.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`topup:${userId}`}, 0))`;
      const [locked] = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT status::text AS status FROM payment_intents WHERE id = ${intent.id}::uuid FOR UPDATE`;
      if (!locked || (locked.status !== 'PENDING' && locked.status !== 'ABANDONED')) return;

      const pkg = await tx.coinPackage.findUniqueOrThrow({ where: { id: intent.packageId } });
      const earlier = await tx.ledgerTransaction.count({ where: { userId, kind: 'TOPUP' } });
      const bonus = pkg.bonusCoins + (earlier === 0 ? pkg.firstPurchaseBonus : 0);
      const postings: Posting[] = [
        { ownerId: null, kind: 'GATEWAY_CLEARING', amount: -intent.coins },
        { ownerId: userId, kind: 'MEMBER_COINS_PAID', amount: intent.coins },
        ...(bonus > 0
          ? [
              { ownerId: null, kind: 'PLATFORM_PROMO' as const, amount: -bonus },
              { ownerId: userId, kind: 'MEMBER_COINS_PROMO' as const, amount: bonus },
            ]
          : []),
      ];
      const posted = await this.ledger.post(
        {
          kind: 'TOPUP',
          idempotencyKey: `topup:${providerName(intent.provider)}:${intent.reference}`,
          userId,
          metadata: {
            reason: 'top_up',
            payment_intent_id: intent.id,
            coins: intent.coins,
            bonus_coins: bonus,
            amount_kobo: Number(intent.amountKobo),
            provider: providerName(intent.provider),
          },
          postings,
        },
        tx,
      );
      await tx.paymentIntent.update({
        where: { id: intent.id },
        data: {
          status: 'SUCCEEDED',
          bonusCoins: bonus,
          ledgerTransactionId: posted.id,
          paidAt: v.paidAt ?? new Date(),
          providerTransactionId: v.providerTransactionId?.slice(0, 64) ?? null,
          channel: v.channel,
          failureReason: null,
        },
      });
    });
    return this.prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
  }

  /**
   * Reconciliation sweep: re-checks unfinished top-ups with the provider (lost or
   * late webhooks), and marks ones unpaid for a day as abandoned.
   */
  async reconcile(limit = 50): Promise<{ checked: number; succeeded: number; failed: number; abandoned: number }> {
    const now = Date.now();
    const due = await this.prisma.paymentIntent.findMany({
      where: {
        status: { in: ['PENDING', 'ABANDONED'] },
        createdAt: { lt: new Date(now - 2 * 60 * 1000), gt: new Date(now - RECONCILE_WINDOW_MS) },
      },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
    const result = { checked: 0, succeeded: 0, failed: 0, abandoned: 0 };
    for (const intent of due) {
      if (!this.available().includes(providerName(intent.provider))) continue;
      result.checked++;
      try {
        const after = await this.confirm(intent.reference);
        if (after?.status === 'SUCCEEDED') result.succeeded++;
        else if (after?.status === 'FAILED') result.failed++;
        else if (after && after.status === 'PENDING' && now - after.createdAt.getTime() > ABANDON_AFTER_MS) {
          await this.prisma.paymentIntent.updateMany({
            where: { id: after.id, status: 'PENDING' },
            data: { status: 'ABANDONED' },
          });
          result.abandoned++;
        } else {
          // Touch it so the sweep moves on to the next oldest.
          await this.prisma.paymentIntent.updateMany({ where: { id: intent.id }, data: { updatedAt: new Date() } });
        }
      } catch (error) {
        this.logger.warn(`Reconcile ${intent.id}: ${(error as Error).message}`);
      }
    }
    return result;
  }

  /** The member's view of a top-up, with their balance once it's credited. */
  private async view(intent: PaymentIntent) {
    const credited = intent.status === 'SUCCEEDED';
    return {
      id: intent.id,
      reference: intent.reference,
      provider: providerName(intent.provider),
      status: intent.status.toLowerCase(),
      coins: intent.coins,
      bonus_coins: credited ? intent.bonusCoins : null,
      total_coins: credited ? intent.coins + intent.bonusCoins : null,
      amount_kobo: Number(intent.amountKobo),
      price_ngn: Number(intent.amountKobo) / 100,
      paid_at: intent.paidAt?.toISOString() ?? null,
      created_at: intent.createdAt.toISOString(),
      balance: credited && intent.userId ? (await this.wallets.balances(intent.userId)).balance : null,
    };
  }
}
