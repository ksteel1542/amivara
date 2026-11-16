import { HttpStatus, Injectable } from '@nestjs/common';

import { ApiError } from '../../common/api-error';
import { DomainEvents } from '../../common/domain-events';
import { PrismaService } from '../../prisma/prisma.service';
import { HostsService } from '../hosts/hosts.service';
import { MessagingService } from '../messaging/messaging.service';
import { RealtimeRegistry } from '../messaging/realtime.registry';
import { WalletService } from '../wallet/wallet.service';

/** Gifts per sender per minute: plenty for people, a wall for scripted spending. */
export const GIFTS_PER_MINUTE = 20;

/**
 * Virtual gifts (MONETIZATION_PLAN.md 3b). Sent to active Verified Hosts only,
 * paid from the sender's coins (promo first); the Host earns their share of
 * the bought-coin part, held like other earnings. In a chat a gift is also a
 * GIFT message, so both members see it in the conversation.
 */
@Injectable()
export class GiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletService,
    private readonly hosts: HostsService,
    private readonly messaging: MessagingService,
    private readonly realtime: RealtimeRegistry,
    private readonly events: DomainEvents,
  ) {}

  /** GET /gifts: the active catalogue, cheapest first. */
  async catalogue() {
    const gifts = await this.prisma.gift.findMany({
      where: { active: true },
      orderBy: [{ sort: 'asc' }, { priceCoins: 'asc' }],
    });
    return {
      gifts: gifts.map((g) => ({ id: g.id, slug: g.slug, name: g.name, emoji: g.emoji, price_coins: g.priceCoins })),
    };
  }

  /**
   * POST /matches/:id/gifts. `idempotencyKey` comes from the app, so a retried
   * tap never charges twice.
   */
  async sendInChat(senderId: string, matchId: string, giftId: string, idempotencyKey: string) {
    const ledgerKey = `gift:${senderId}:${idempotencyKey}`;
    // A retried tap: answer with the gift already sent.
    const existing = await this.prisma.ledgerTransaction.findUnique({
      where: { idempotencyKey: ledgerKey },
      select: { id: true },
    });
    if (existing) {
      const send = await this.prisma.giftSend.findUnique({
        where: { ledgerTransactionId: existing.id },
        include: { message: { include: { gift: { select: { gift: true } } } } },
      });
      if (send?.message) return this.result(send.message, 0, (await this.wallets.balances(senderId)).balance);
    }

    const match = await this.prisma.match.findFirst({
      where: { id: matchId, unmatchedAt: null, OR: [{ userAId: senderId }, { userBId: senderId }] },
      include: { userA: { select: { status: true } }, userB: { select: { status: true } } },
    });
    const usable = (s: string) => s === 'ACTIVE' || s === 'PAUSED';
    if (!match || !usable(match.userA.status) || !usable(match.userB.status)) {
      throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'This conversation is no longer available.');
    }
    const recipientId = match.userAId === senderId ? match.userBId : match.userAId;
    const gift = await this.prisma.gift.findFirst({ where: { id: giftId, active: true } });
    if (!gift) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Gift not found.');
    const earner = await this.hosts.activeEarner(recipientId);
    if (!earner) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'HOST_ONLY', 'Gifts can only be sent to Verified Hosts.');
    }
    const lastMinute = await this.prisma.giftSend.count({
      where: { senderId, createdAt: { gte: new Date(Date.now() - 60_000) } },
    });
    if (lastMinute >= GIFTS_PER_MINUTE) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'GIFT_RATE_LIMITED', "You're sending gifts too quickly.", {
        retry_after: 60,
      });
    }

    const message = await this.prisma.$transaction(async (tx) => {
      const message = await tx.message.create({ data: { matchId, senderId, type: 'GIFT' } });
      // A 402 INSUFFICIENT_COINS here rolls the message back too.
      const spent = await this.wallets.spendIn(tx, {
        userId: senderId,
        coins: gift.priceCoins,
        idempotencyKey: ledgerKey,
        metadata: { reason: 'gift', gift: gift.slug, match_id: matchId, message_id: message.id },
        earner,
      });
      await tx.giftSend.create({
        data: {
          giftId: gift.id,
          senderId,
          recipientId,
          matchId,
          messageId: message.id,
          coins: gift.priceCoins,
          hostEarned: spent.hostEarned,
          ledgerTransactionId: spent.transactionId,
        },
      });
      await tx.match.update({ where: { id: matchId }, data: { lastMessageAt: message.createdAt } });
      return message;
    });

    const balance = (await this.wallets.balances(senderId)).balance;
    const full = await this.prisma.message.findUniqueOrThrow({
      where: { id: message.id },
      include: { gift: { select: { gift: true } } },
    });
    const view = this.messaging.view(full);
    for (const id of [senderId, recipientId]) this.realtime.send(id, { event: 'message.new', data: { ...view } });
    this.realtime.send(senderId, {
      event: 'wallet.updated',
      data: { match_id: matchId, coins_charged: gift.priceCoins, balance, free_remaining_today: null },
    });
    this.events.emit('message.created', {
      matchId,
      messageId: message.id,
      senderId,
      recipientId,
      recipientOnline: this.realtime.isOnline(recipientId),
    });
    return this.result(full, gift.priceCoins, balance);
  }

  private result(message: Parameters<MessagingService['view']>[0], coinsCharged: number, balance: number) {
    return { message: this.messaging.view(message), coins_charged: coinsCharged, balance };
  }
}
