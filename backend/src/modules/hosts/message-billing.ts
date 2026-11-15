import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import type { SpendEarner } from '../wallet/wallet.service';
import { HostsService } from './hosts.service';

type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

/** Lagos is UTC+1 all year (no daylight saving). */
const LAGOS_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight in Lagos at the start of the day containing `now`. */
export function startOfLagosDay(now: Date): Date {
  const local = now.getTime() + LAGOS_OFFSET_MS;
  return new Date(Math.floor(local / DAY_MS) * DAY_MS - LAGOS_OFFSET_MS);
}

export interface MessageQuote {
  /** The recipient is an active Verified Host: messages beyond the allowance cost coins. */
  paid: boolean;
  priceCoins: number;
  freePerDay: number;
  /** Free messages left today in this conversation (before this one is sent). */
  freeRemaining: number;
  /** Coins this message costs: 0 or priceCoins. */
  charge: number;
  earner?: SpendEarner;
}

/**
 * Paid messages (MONETIZATION_PLAN.md M3). Messaging an active Verified Host
 * is free for FREE_HOST_MESSAGES_PER_DAY messages per conversation per Lagos
 * day, then costs MESSAGE_PRICE_COINS each. The Host's own messages are free.
 * Conversations between two members who aren't Hosts are never billed.
 */
@Injectable()
export class MessageBilling {
  readonly priceCoins: number;
  readonly freePerDay: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hosts: HostsService,
    config: ConfigService<Env, true>,
  ) {
    this.priceCoins = config.get('MESSAGE_PRICE_COINS', { infer: true });
    this.freePerDay = config.get('FREE_HOST_MESSAGES_PER_DAY', { infer: true });
  }

  /**
   * What the next message from sender to recipient costs. Inside a transaction,
   * pass `tx`: the sender's sends in this conversation are serialised, so two
   * messages sent at once can't both use the last free one.
   */
  async quote(senderId: string, recipientId: string, matchId: string, tx?: Tx): Promise<MessageQuote> {
    const db = tx ?? this.prisma;
    const earner = await this.hosts.activeEarner(recipientId, tx);
    if (!earner) {
      return { paid: false, priceCoins: this.priceCoins, freePerDay: this.freePerDay, freeRemaining: 0, charge: 0 };
    }
    if (tx) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`msg:${senderId}:${matchId}`}, 0))`;
    const sentToday = await db.message.count({
      where: { matchId, senderId, createdAt: { gte: startOfLagosDay(new Date()) } },
    });
    const freeRemaining = Math.max(0, this.freePerDay - sentToday);
    return {
      paid: true,
      priceCoins: this.priceCoins,
      freePerDay: this.freePerDay,
      freeRemaining,
      charge: freeRemaining > 0 ? 0 : this.priceCoins,
      earner,
    };
  }
}
