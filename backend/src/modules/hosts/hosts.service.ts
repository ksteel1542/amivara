import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ApiError } from '../../common/api-error';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../wallet/ledger.service';
import type { SpendEarner } from '../wallet/wallet.service';

type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

/**
 * Opt-in "Verified Host" mode (MONETIZATION_PLAN.md 2a): open to any member who
 * has passed NIN verification, with no gender rule. Active Hosts are paid
 * coins for messages after a free allowance and earn a share of the bought
 * part, held for HOST_EARNINGS_HOLD_DAYS before it can be withdrawn (M7).
 */
@Injectable()
export class HostsService {
  private readonly logger = new Logger(HostsService.name);
  private readonly defaultShareBps: number;
  private readonly holdDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    config: ConfigService<Env, true>,
  ) {
    this.defaultShareBps = config.get('HOST_REVENUE_SHARE_BPS', { infer: true });
    this.holdDays = config.get('HOST_EARNINGS_HOLD_DAYS', { infer: true });
  }

  /** The earner for a spend paid to this member, or undefined when they aren't an active Host. */
  async activeEarner(userId: string, tx?: Tx): Promise<SpendEarner | undefined> {
    const db = tx ?? this.prisma;
    const host = await db.hostProfile.findUnique({
      where: { userId },
      select: { status: true, revenueShareBps: true, user: { select: { status: true, ageVerified: true } } },
    });
    if (!host || host.status !== 'ACTIVE' || host.user.status !== 'ACTIVE' || !host.user.ageVerified) return undefined;
    return { userId, shareBps: host.revenueShareBps, holdDays: this.holdDays };
  }

  async view(userId: string) {
    const host = await this.prisma.hostProfile.findUnique({ where: { userId } });
    return host
      ? {
          status: host.status.toLowerCase(),
          revenue_share_bps: host.revenueShareBps,
          earning_since: host.earningSince.toISOString(),
          hold_days: this.holdDays,
        }
      : null;
  }

  /** POST /me/host: become (or resume being) a Verified Host. */
  async optIn(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { ageVerified: true, status: true, guidelinesAcceptedAt: true },
    });
    if (!user.ageVerified) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'VERIFICATION_REQUIRED', 'Verify your identity to become a Host.', {
        reason: 'host_requires_verification',
      });
    }
    if (user.status !== 'ACTIVE' || !user.guidelinesAcceptedAt) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Your account can’t host right now.');
    }
    // Resuming keeps the share agreed when they first opted in.
    await this.prisma.hostProfile.upsert({
      where: { userId },
      create: { userId, revenueShareBps: this.defaultShareBps },
      update: { status: 'ACTIVE', pausedAt: null },
    });
    return (await this.view(userId))!;
  }

  /** POST /me/host/pause: messages to them become free; held earnings stay theirs. */
  async pause(userId: string) {
    await this.prisma.hostProfile.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'PAUSED', pausedAt: new Date() },
    });
    return this.view(userId);
  }

  /** GET /me/host/earnings: held and withdrawable coins, and the latest credits. */
  async earnings(userId: string, limit = 20) {
    const [pending, available, recent] = await Promise.all([
      this.ledger.balance(userId, 'MEMBER_EARNINGS_PENDING'),
      this.ledger.balance(userId, 'MEMBER_EARNINGS_AVAILABLE'),
      this.prisma.hostEarning.findMany({ where: { hostId: userId }, orderBy: { createdAt: 'desc' }, take: limit }),
    ]);
    return {
      pending_coins: pending,
      available_coins: available,
      hold_days: this.holdDays,
      recent: recent.map((e) => ({
        id: e.id,
        coins: e.coins,
        created_at: e.createdAt.toISOString(),
        available_at: e.availableAt.toISOString(),
        released: e.releaseTransactionId !== null,
      })),
    };
  }

  /**
   * Moves earnings past their hold from pending to available, one ledger
   * transaction per Host per run. Rows are locked (SKIP LOCKED), so several
   * instances can run it at once without releasing anything twice.
   */
  async releaseDue(now = new Date(), batch = 500): Promise<{ hosts: number; coins: number }> {
    const due = await this.prisma.hostEarning.groupBy({
      by: ['hostId'],
      where: { releaseTransactionId: null, availableAt: { lte: now }, hostId: { not: null } },
      _count: { _all: true },
    });
    const result = { hosts: 0, coins: 0 };
    for (const { hostId } of due) {
      if (!hostId) continue;
      const released = await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string; coins: number }>>`
          SELECT id, coins FROM host_earnings
           WHERE host_id = ${hostId}::uuid AND release_transaction_id IS NULL AND available_at <= ${now}
           ORDER BY available_at
           LIMIT ${batch}::int
           FOR UPDATE SKIP LOCKED`;
        if (rows.length === 0) return 0;
        const coins = rows.reduce((sum, r) => sum + r.coins, 0);
        const ids = rows.map((r) => r.id).sort();
        const posted = await this.ledger.post(
          {
            kind: 'EARNINGS_RELEASE',
            idempotencyKey: `release:${hostId}:${ids[0]}:${ids.length}`,
            userId: hostId,
            metadata: { reason: 'earnings_released', earnings: ids.length },
            postings: [
              { ownerId: hostId, kind: 'MEMBER_EARNINGS_PENDING', amount: -coins },
              { ownerId: hostId, kind: 'MEMBER_EARNINGS_AVAILABLE', amount: coins },
            ],
          },
          tx,
        );
        await tx.hostEarning.updateMany({ where: { id: { in: ids } }, data: { releaseTransactionId: posted.id } });
        return coins;
      });
      if (released > 0) {
        result.hosts++;
        result.coins += released;
      }
    }
    if (result.hosts) this.logger.log(`Released ${result.coins} coins of earnings to ${result.hosts} Hosts`);
    return result;
  }
}
