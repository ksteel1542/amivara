import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { DomainEvents } from '../../common/domain-events';
import { PrismaService } from '../../prisma/prisma.service';
import { PUSH_SENDER, type PushMessage, type PushSender } from './push-sender';

/** The generic, lock-screen-safe text for a new match: no names (PushMessage privacy rules). */
export const MATCH_NOTIFICATION = {
  title: "It's a match ✦",
  body: 'You have a new match on AMIVARA. Open the app to see who.',
};

/** After a moderator's warning: generic, nothing about the report or the reporter. */
export const WARNING_NOTIFICATION = {
  title: 'A note from AMIVARA Safety',
  body: 'Please take a moment to review our community guidelines.',
};

/** New message push: never the sender's name or any of the message (lock screens are public). */
export const MESSAGE_NOTIFICATION = {
  title: 'AMIVARA',
  body: 'You have a new message.',
};

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
    @Inject(PUSH_SENDER) private readonly sender: PushSender,
  ) {}

  onModuleInit(): void {
    this.events.on('match.created', async ({ matchId, userIds }) => {
      await Promise.all(
        userIds.map((userId) =>
          this.sendToUser(userId, {
            notification: MATCH_NOTIFICATION,
            data: { type: 'match.created', match_id: matchId },
          }),
        ),
      );
    });
    this.events.on('member.warned', async ({ userId }) => {
      await this.sendToUser(userId, { notification: WARNING_NOTIFICATION, data: { type: 'account.warning' } });
    });
    // Only when the recipient isn't already in the app: an open socket shows it live.
    this.events.on('message.created', async ({ matchId, recipientId, recipientOnline }) => {
      if (recipientOnline) return;
      await this.sendToUser(recipientId, {
        notification: MESSAGE_NOTIFICATION,
        data: { type: 'message.new', match_id: matchId },
      });
    });
    // Silent: the other member's list refreshes, with no "X unmatched you" notification.
    this.events.on('match.unmatched', async ({ matchId, otherUserId }) => {
      await this.sendToUser(otherUserId, { data: { type: 'match.removed', match_id: matchId } });
    });
  }

  /** Registers (or moves) a token to this member's current device session. */
  async register(userId: string, sessionId: string, token: string, platform: string): Promise<void> {
    await this.prisma.pushToken.upsert({
      where: { token },
      create: { token, userId, sessionId, platform },
      // A phone that changes account must never keep receiving the old account's pushes.
      update: { userId, sessionId, platform, lastSeenAt: new Date() },
    });
  }

  async unregister(userId: string, token: string): Promise<void> {
    await this.prisma.pushToken.deleteMany({ where: { token, userId } });
  }

  /** Sends to every token of the member whose session is still active. Dead tokens are removed. */
  async sendToUser(userId: string, message: PushMessage): Promise<number> {
    const tokens = await this.prisma.pushToken.findMany({
      where: { userId, session: { revokedAt: null, expiresAt: { gt: new Date() } } },
      select: { id: true, token: true },
    });
    let sent = 0;
    for (const t of tokens) {
      try {
        const result = await this.sender.send(t.token, message);
        if (result === 'sent') sent++;
        if (result === 'unregistered')
          await this.prisma.pushToken.delete({ where: { id: t.id } }).catch(() => undefined);
      } catch (error) {
        this.logger.warn(`Push to token ${t.id} failed: ${(error as Error).message}`);
      }
    }
    return sent;
  }
}
