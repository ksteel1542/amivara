import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';

import { ApiError } from '../../common/api-error';
import { DomainEvents } from '../../common/domain-events';
import { MessageCipher } from '../../common/message-cipher';
import { PrismaService } from '../../prisma/prisma.service';
import { detectContactSharing } from './contact-detector';
import { RealtimeRegistry } from './realtime.registry';

/** WebSocket close code for "not allowed" (API.md "Messaging"). */
export const CLOSE_FORBIDDEN = 4403;
/** WebSocket close code for 'sign in again'. */
export const CLOSE_UNAUTHENTICATED = 4401;

/** PRD §5.5: photos in chat unlock once both members have sent at least this many messages. */
export const PHOTO_UNLOCK_MESSAGES = 3;
export const MAX_MESSAGE_LENGTH = 2000;
/** Per member, across all chats: generous for humans, a wall for spam bots. */
export const MESSAGES_PER_MINUTE = 30;
/**
 * Progressive trust (Nov 2026): members who haven't passed Smile ID can match and
 * chat, but only this many messages per 24 hours across all chats, and photos never
 * unlock for them. Verifying lifts the cap.
 */
export const UNVERIFIED_DAILY_MESSAGES = 10;

/** Shown in-app when a message looks like it moves the conversation off AMIVARA. */
export type SafetyNotice = 'contact_sharing';

export interface MessageView {
  id: string;
  match_id: string;
  sender_id: string;
  type: 'text';
  body: string;
  created_at: string;
  read_at: string | null;
}

interface ActiveMatch {
  id: string;
  otherUserId: string;
  photosUnlocked: boolean;
  /** Smile ID status of each side: photos only unlock between two verified members. */
  meVerified: boolean;
  otherVerified: boolean;
}

@Injectable()
export class MessagingService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: MessageCipher,
    private readonly realtime: RealtimeRegistry,
    private readonly events: DomainEvents,
  ) {}

  onModuleInit(): void {
    // An unmatch closes the conversation on every open screen, for both members.
    this.events.on('match.unmatched', ({ matchId, byUserId, otherUserId }) => {
      for (const userId of [byUserId, otherUserId]) {
        this.realtime.send(userId, { event: 'match.removed', data: { match_id: matchId } });
      }
    });
    // Suspended and banned members lose their live connection at once.
    this.events.on('member.restricted', ({ userId }) => {
      this.realtime.disconnect(userId, CLOSE_FORBIDDEN, 'ACCOUNT_SUSPENDED');
    });
    this.events.on('member.deleted', ({ userId }) => {
      this.realtime.disconnect(userId, CLOSE_UNAUTHENTICATED, 'ACCOUNT_DELETED');
    });
    // A signed-out device loses its live connection too, not just its tokens.
    this.events.on('sessions.revoked', ({ userId, sessionIds }) => {
      this.realtime.disconnectSessions(userId, sessionIds, CLOSE_UNAUTHENTICATED, 'INVALID_TOKEN');
    });
  }

  /** History, newest first, paged with ?before=<message id>. */
  async history(userId: string, matchId: string, opts: { before?: string; limit: number }) {
    const match = await this.activeMatch(userId, matchId);
    let beforeAt: Date | undefined;
    if (opts.before) {
      const anchor = await this.prisma.message.findFirst({ where: { id: opts.before, matchId: match.id } });
      if (!anchor) throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Unknown message cursor.');
      beforeAt = anchor.createdAt;
    }
    const rows = await this.prisma.message.findMany({
      where: {
        matchId: match.id,
        deletedAt: null,
        ...(beforeAt && opts.before
          ? { OR: [{ createdAt: { lt: beforeAt } }, { createdAt: beforeAt, id: { lt: opts.before } }] }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: opts.limit + 1,
    });
    const page = rows.slice(0, opts.limit);
    return {
      messages: page.map((m) => this.view(m)),
      next_before: rows.length > opts.limit ? (page.at(-1)?.id ?? null) : null,
      photos: await this.unlockProgress(userId, match),
    };
  }

  async send(
    userId: string,
    matchId: string,
    rawBody: string,
  ): Promise<MessageView & { safety_notice?: SafetyNotice }> {
    const body = rawBody.trim();
    if (body.length === 0 || body.length > MAX_MESSAGE_LENGTH) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        `Messages must be 1–${MAX_MESSAGE_LENGTH} characters.`,
      );
    }
    const match = await this.activeMatch(userId, matchId);

    const lastMinute = await this.prisma.message.count({
      where: { senderId: userId, createdAt: { gte: new Date(Date.now() - 60_000) } },
    });
    if (lastMinute >= MESSAGES_PER_MINUTE) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'MESSAGE_RATE_LIMITED', "You're sending messages too quickly.", {
        retry_after: 60,
      });
    }
    if (!match.meVerified) {
      const today = await this.prisma.message.count({
        where: { senderId: userId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      });
      if (today >= UNVERIFIED_DAILY_MESSAGES) {
        throw new ApiError(
          HttpStatus.FORBIDDEN,
          'VERIFICATION_REQUIRED',
          `Verify your identity to keep chatting. Unverified members can send ${UNVERIFIED_DAILY_MESSAGES} messages a day.`,
          { reason: 'unverified_chat_limit', limit: UNVERIFIED_DAILY_MESSAGES },
        );
      }
    }

    const { message, unlockedNow } = await this.prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: { matchId: match.id, senderId: userId, type: 'TEXT', body: this.cipher.encrypt(body) },
      });
      let unlockedNow = false;
      if (!match.photosUnlocked && match.meVerified && match.otherVerified) {
        const counts = await tx.message.groupBy({
          by: ['senderId'],
          where: { matchId: match.id, type: 'TEXT', deletedAt: null },
          _count: { _all: true },
        });
        const sent = (id: string) => counts.find((c) => c.senderId === id)?._count._all ?? 0;
        if (sent(userId) >= PHOTO_UNLOCK_MESSAGES && sent(match.otherUserId) >= PHOTO_UNLOCK_MESSAGES) {
          const claimed = await tx.match.updateMany({
            where: { id: match.id, photosUnlocked: false },
            data: { photosUnlocked: true },
          });
          unlockedNow = claimed.count > 0;
        }
      }
      await tx.match.update({ where: { id: match.id }, data: { lastMessageAt: message.createdAt } });
      return { message, unlockedNow };
    });

    const view = this.view(message);
    for (const id of [userId, match.otherUserId]) this.realtime.send(id, { event: 'message.new', data: { ...view } });
    if (unlockedNow) {
      for (const id of [userId, match.otherUserId]) {
        this.realtime.send(id, { event: 'photos.unlocked', data: { match_id: match.id } });
      }
    }
    this.events.emit('message.created', {
      matchId: match.id,
      messageId: message.id,
      senderId: userId,
      recipientId: match.otherUserId,
      recipientOnline: this.realtime.isOnline(match.otherUserId),
    });

    // Off-platform contact sharing: delivered, but logged and both members get a gentle reminder.
    const signals = detectContactSharing(body);
    if (signals.length === 0) return view;
    await this.prisma.safetyEvent.create({
      data: { userId, kind: 'CONTACT_SHARING', signals, matchId: match.id, messageId: message.id },
    });
    this.realtime.send(userId, {
      event: 'safety.notice',
      data: { match_id: match.id, kind: 'contact_sharing', role: 'sender', message_id: message.id },
    });
    this.realtime.send(match.otherUserId, {
      event: 'safety.notice',
      data: { match_id: match.id, kind: 'contact_sharing', role: 'recipient', message_id: message.id },
    });
    return { ...view, safety_notice: 'contact_sharing' };
  }

  /** Read receipts: marks the other member's messages up to (and including) one as read. */
  async markRead(userId: string, matchId: string, upToMessageId: string): Promise<{ read: number }> {
    const match = await this.activeMatch(userId, matchId);
    const anchor = await this.prisma.message.findFirst({
      where: { id: upToMessageId, matchId: match.id },
      select: { createdAt: true },
    });
    if (!anchor) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Message not found.');

    const readAt = new Date();
    const result = await this.prisma.message.updateMany({
      where: { matchId: match.id, senderId: match.otherUserId, readAt: null, createdAt: { lte: anchor.createdAt } },
      data: { readAt },
    });
    if (result.count > 0) {
      this.realtime.send(match.otherUserId, {
        event: 'message.read',
        data: { match_id: match.id, up_to_message_id: upToMessageId, read_at: readAt.toISOString() },
      });
    }
    return { read: result.count };
  }

  /** Relays "typing…" to the other member (never stored). */
  async typing(userId: string, matchId: string): Promise<void> {
    const match = await this.activeMatch(userId, matchId);
    this.realtime.send(match.otherUserId, { event: 'typing', data: { match_id: match.id, user_id: userId } });
  }

  /**
   * The conversation exists only while the match is active and both members
   * are in good standing. Anything else is a 404: nothing to learn by probing.
   */
  private async activeMatch(userId: string, matchId: string): Promise<ActiveMatch> {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, unmatchedAt: null, OR: [{ userAId: userId }, { userBId: userId }] },
      include: {
        userA: { select: { status: true, ageVerified: true } },
        userB: { select: { status: true, ageVerified: true } },
      },
    });
    const usable = (s: string) => s === 'ACTIVE' || s === 'PAUSED';
    if (!match || !usable(match.userA.status) || !usable(match.userB.status)) {
      throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'This conversation is no longer available.');
    }
    return {
      id: match.id,
      otherUserId: match.userAId === userId ? match.userBId : match.userAId,
      photosUnlocked: match.photosUnlocked,
      meVerified: match.userAId === userId ? match.userA.ageVerified : match.userB.ageVerified,
      otherVerified: match.userAId === userId ? match.userB.ageVerified : match.userA.ageVerified,
    };
  }

  private async unlockProgress(userId: string, match: ActiveMatch) {
    const counts = await this.prisma.message.groupBy({
      by: ['senderId'],
      where: { matchId: match.id, type: 'TEXT', deletedAt: null },
      _count: { _all: true },
    });
    const sent = (id: string) =>
      Math.min(PHOTO_UNLOCK_MESSAGES, counts.find((c) => c.senderId === id)?._count._all ?? 0);
    return {
      unlocked: match.photosUnlocked,
      threshold: PHOTO_UNLOCK_MESSAGES,
      mine: sent(userId),
      theirs: sent(match.otherUserId),
    };
  }

  private view(m: {
    id: string;
    matchId: string;
    senderId: string;
    body: string | null;
    createdAt: Date;
    readAt: Date | null;
  }): MessageView {
    return {
      id: m.id,
      match_id: m.matchId,
      sender_id: m.senderId,
      type: 'text',
      body: m.body ? this.cipher.decrypt(m.body) : '',
      created_at: m.createdAt.toISOString(),
      read_at: m.readAt?.toISOString() ?? null,
    };
  }
}
