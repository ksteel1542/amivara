import { EventEmitter } from 'node:events';

import { Global, Injectable, Logger, Module } from '@nestjs/common';

/** Domain events (in-process). Moves to a queue when the BullMQ worker exists. */
export interface DomainEventMap {
  /** A mutual like created a match. */
  'match.created': { matchId: string; userIds: [string, string] };
  /** One member unmatched; both lose the match and the conversation. */
  'match.unmatched': { matchId: string; byUserId: string; otherUserId: string };
  /** A member was suspended or banned: open sockets close (the WebSocket checks status only on connect). */
  'member.restricted': { userId: string; action: 'SUSPEND' | 'BAN' };
  /** A member deleted their account: every socket closes. */
  'member.deleted': { userId: string };
  /** Device sessions were signed out (logout, "sign out other devices"): their sockets close. */
  'sessions.revoked': { userId: string; sessionIds: string[] };
  /** A moderator warned a member: a generic push asks them to review the guidelines. */
  'member.warned': { userId: string };
  /** A chat message was stored. Never carries the body. */
  'message.created': {
    matchId: string;
    messageId: string;
    senderId: string;
    recipientId: string;
    /** The recipient had the chat socket open when it was sent: no push needed. */
    recipientOnline: boolean;
  };
}

export type DomainEventName = keyof DomainEventMap;

/**
 * A tiny typed event bus. Listeners run after the emitting request's work is
 * committed (emit is called after the transaction), and a failing listener
 * never fails the request: errors are logged.
 */
@Injectable()
export class DomainEvents {
  private readonly logger = new Logger(DomainEvents.name);
  private readonly emitter = new EventEmitter();

  on<E extends DomainEventName>(event: E, listener: (payload: DomainEventMap[E]) => Promise<void> | void): void {
    this.emitter.on(event, (payload: DomainEventMap[E]) => {
      Promise.resolve()
        .then(() => listener(payload))
        .catch((error: unknown) => this.logger.error(`Listener for ${event} failed: ${(error as Error).message}`));
    });
  }

  emit<E extends DomainEventName>(event: E, payload: DomainEventMap[E]): void {
    this.emitter.emit(event, payload);
  }
}

@Global()
@Module({ providers: [DomainEvents], exports: [DomainEvents] })
export class DomainEventsModule {}
