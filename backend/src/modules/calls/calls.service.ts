import { HttpStatus, Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { CallSession, CallStatus, CallType } from '../../../generated/prisma';
import { ApiError } from '../../common/api-error';
import { DomainEvents } from '../../common/domain-events';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { HostsService } from '../hosts/hosts.service';
import { RealtimeRegistry } from '../messaging/realtime.registry';
import { WalletService } from '../wallet/wallet.service';
import { CALL_MEDIA, type CallMediaProvider } from './call-media';

type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

export const MINUTE_MS = 60_000;
/** Call attempts per caller per 10 minutes: enough for redials, a wall against ring spam. */
export const CALL_ATTEMPTS_PER_10_MIN = 10;
/** A member whose app lost its connection mid-call has this long to come back before the call ends. */
export const OFFLINE_GRACE_MS = 30_000;

const LIVE: CallStatus[] = ['RINGING', 'ACTIVE'];

export type CallRole = 'caller' | 'callee';

export interface CallView {
  id: string;
  match_id: string;
  type: 'voice' | 'video';
  status: string;
  role: CallRole;
  other_user_id: string;
  /** Coins per started minute, paid by the caller. 0 = free. */
  rate_per_minute: number;
  paid: boolean;
  ring_expires_at: string;
  started_at: string | null;
  ended_at: string | null;
  billed_minutes: number;
  /** Only the caller sees what the call cost them. */
  total_coins_billed?: number;
  end_reason: string | null;
}

export const roomName = (callId: string) => `call_${callId}`;
const callIdFromRoom = (room: string) => /^call_([0-9a-f-]{36})$/.exec(room)?.[1];

/**
 * 1-on-1 voice and video calls (MONETIZATION_PLAN.md M4/M5).
 *
 * The API owns the call: ringing and answering go through here, signalling is
 * pushed over /ws/chat (call:ring, call:accept, call:decline, call:end,
 * call:low_balance, call:billed), and the media server only carries audio and
 * video. Calling an active Verified Host costs the caller a rate per started
 * minute: the first when the Host answers, then one every 60 seconds, charged
 * by the server's ticker (never the phone). When the next minute can't be
 * paid, the call ends with INSUFFICIENT_COINS. The Host earns their share of
 * the bought-coin part, held like message earnings. Calls between members
 * who aren't Hosts are free.
 */
@Injectable()
export class CallsService implements OnModuleInit {
  private readonly logger = new Logger(CallsService.name);
  readonly voiceRate: number;
  readonly videoRate: number;
  private readonly ringMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletService,
    private readonly hosts: HostsService,
    private readonly realtime: RealtimeRegistry,
    private readonly events: DomainEvents,
    @Inject(CALL_MEDIA) private readonly media: CallMediaProvider,
    config: ConfigService<Env, true>,
  ) {
    this.voiceRate = config.get('CALL_VOICE_RATE_COINS', { infer: true });
    this.videoRate = config.get('CALL_VIDEO_RATE_COINS', { infer: true });
    this.ringMs = config.get('CALL_RING_TIMEOUT_SECONDS', { infer: true }) * 1000;
  }

  onModuleInit(): void {
    // Unmatching or blocking ends any call between the two at once.
    this.events.on('match.unmatched', async ({ matchId }) => {
      const live = await this.prisma.callSession.findMany({ where: { matchId, status: { in: LIVE } } });
      for (const call of live) await this.finish(call.id, 'unmatched');
    });
    // Suspended, banned or deleted members drop out of their calls too.
    const endFor = async (userId: string, reason: string, onlyMine = false) => {
      const live = await this.prisma.callSession.findMany({
        where: onlyMine
          ? // Their answered calls, and calls they're ringing; a ring to them waits for their push.
            {
              OR: [
                { status: 'ACTIVE', OR: [{ callerId: userId }, { calleeId: userId }] },
                { status: 'RINGING', callerId: userId },
              ],
            }
          : { status: { in: LIVE }, OR: [{ callerId: userId }, { calleeId: userId }] },
      });
      for (const call of live) await this.finish(call.id, reason);
    };
    this.events.on('member.restricted', ({ userId }) => endFor(userId, 'account_restricted'));
    this.events.on('member.deleted', ({ userId }) => endFor(userId, 'account_deleted'));
    // Backstop to LiveKit's webhooks: an app that vanished (killed, out of data) stops paying.
    this.realtime.onOffline((userId) => {
      const timer = setTimeout(() => {
        if (this.realtime.isOnline(userId)) return;
        void endFor(userId, 'disconnected', true).catch((error: Error) =>
          this.logger.error(`Ending calls of an offline member failed: ${error.message}`),
        );
      }, OFFLINE_GRACE_MS);
      timer.unref();
    });
  }

  private rateFor(type: CallType): number {
    return type === 'VIDEO' ? this.videoRate : this.voiceRate;
  }

  /** GET /matches/:id/calls/quote: whether the chat header shows call buttons, and their price. */
  async quote(userId: string, matchId: string) {
    const { me, otherId, otherVerified } = await this.activeMatch(userId, matchId);
    const earner = await this.hosts.activeEarner(otherId);
    return {
      available: this.media.configured,
      /** Both members passed NIN verification (capabilities.voice_calls / video_calls). */
      allowed: me.ageVerified && otherVerified,
      paid: earner !== undefined,
      voice_rate_per_minute: earner ? this.voiceRate : 0,
      video_rate_per_minute: earner ? this.videoRate : 0,
    };
  }

  /** POST /matches/:id/calls: rings the other member. */
  async start(callerId: string, matchId: string, type: CallType): Promise<CallView> {
    const { me, otherId: calleeId, otherVerified } = await this.activeMatch(callerId, matchId);
    if (!me.ageVerified) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'VERIFICATION_REQUIRED', 'Verify your identity to make calls.', {
        reason: 'calls_require_verification',
      });
    }
    if (!otherVerified) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', "This member can't take calls yet.", {
        reason: 'callee_unverified',
      });
    }
    if (!this.media.configured) {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'CALLS_UNAVAILABLE', 'Calls are not available right now.');
    }
    const recent = await this.prisma.callSession.count({
      where: { callerId, createdAt: { gte: new Date(Date.now() - 10 * MINUTE_MS) } },
    });
    if (recent >= CALL_ATTEMPTS_PER_10_MIN) {
      throw new ApiError(
        HttpStatus.TOO_MANY_REQUESTS,
        'CALL_RATE_LIMITED',
        "You're calling too often. Try again soon.",
        {
          retry_after: 600,
        },
      );
    }

    // Calling an active Host costs coins: the caller must be able to pay the first minute.
    const earner = await this.hosts.activeEarner(calleeId);
    const rate = earner ? this.rateFor(type) : 0;
    if (rate > 0) {
      const { balance } = await this.wallets.balances(callerId);
      if (balance < rate) {
        throw new ApiError(
          HttpStatus.PAYMENT_REQUIRED,
          'INSUFFICIENT_COINS',
          `You need ${rate} coins for the first minute.`,
          {
            balance,
            required: rate,
          },
        );
      }
    }

    const now = new Date();
    const { call, expired } = await this.prisma.$transaction(async (tx) => {
      await this.lockMembers(tx, [callerId, calleeId]);
      // Rings nobody answered in time, and the caller's own unanswered call, make way.
      const both = [callerId, calleeId];
      const stale = await tx.callSession.findMany({
        where: {
          status: 'RINGING',
          OR: [
            { ringExpiresAt: { lte: now }, OR: [{ callerId: { in: both } }, { calleeId: { in: both } }] },
            { callerId },
          ],
        },
        select: { id: true, ringExpiresAt: true },
      });
      const expired: string[] = [];
      for (const s of stale) {
        const reason = s.ringExpiresAt <= now ? 'no_answer' : 'superseded';
        if (await this.close(tx, s.id, reason, now)) expired.push(s.id);
      }
      const busy = await tx.callSession.findFirst({
        where: {
          status: { in: LIVE },
          OR: [{ callerId: { in: both } }, { calleeId: { in: both } }],
        },
      });
      if (busy) {
        const mine = busy.callerId === callerId || busy.calleeId === callerId;
        throw new ApiError(
          HttpStatus.CONFLICT,
          'CALLEE_BUSY',
          mine ? "You're already in a call." : 'They’re on another call. Try again later.',
          { reason: mine ? 'you_are_in_a_call' : 'callee_busy' },
        );
      }
      const call = await tx.callSession.create({
        data: {
          matchId,
          callerId,
          calleeId,
          type,
          ratePerMinute: rate,
          ringExpiresAt: new Date(now.getTime() + this.ringMs),
        },
      });
      return { call, expired };
    });
    for (const id of expired) await this.announceEnd(id);

    const caller = await this.prisma.profile.findUnique({ where: { userId: callerId }, select: { firstName: true } });
    const online = this.realtime.send(calleeId, {
      event: 'call:ring',
      data: { call: this.view(call, calleeId), caller: { id: callerId, first_name: caller?.firstName ?? '' } },
    });
    this.events.emit('call.ringing', {
      callId: call.id,
      matchId,
      calleeId,
      type: type === 'VIDEO' ? 'video' : 'voice',
      calleeOnline: online > 0,
    });
    return this.view(call, callerId);
  }

  /**
   * POST /calls/:id/accept (callee). Charges the first minute of a paid call
   * right away; if the caller can no longer pay it, the call ends with
   * INSUFFICIENT_COINS and the caller is offered a top-up.
   */
  async accept(userId: string, callId: string) {
    const ringing = await this.mine(userId, callId);
    if (ringing.calleeId !== userId) throw this.notFound();
    if (ringing.status !== 'RINGING' || ringing.ringExpiresAt <= new Date()) throw this.notRinging();

    try {
      await this.media.openRoom(roomName(callId));
    } catch (error) {
      this.logger.warn(`Opening the call room failed: ${(error as Error).message}`);
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'CALLS_UNAVAILABLE',
        "The call couldn't connect. Please try again.",
      );
    }

    const now = new Date();
    const outcome = await this.prisma.$transaction(async (tx) => {
      const call = await this.lockCall(tx, callId);
      if (call.status !== 'RINGING' || call.ringExpiresAt <= now) throw this.notRinging();
      if (call.ratePerMinute > 0) {
        try {
          await this.chargeMinute(tx, call, 1);
        } catch (error) {
          if (!(error instanceof ApiError) || error.code !== 'INSUFFICIENT_COINS') throw error;
          await this.close(tx, call.id, 'insufficient_coins', now, 'INSUFFICIENT_COINS');
          return { ended: true as const };
        }
      }
      const updated = await tx.callSession.update({
        where: { id: callId },
        data: {
          status: 'ACTIVE',
          startedAt: now,
          billedMinutes: call.ratePerMinute > 0 ? 1 : 0,
          totalCoinsBilled: call.ratePerMinute,
          nextBillAt: call.ratePerMinute > 0 ? new Date(now.getTime() + MINUTE_MS) : null,
        },
      });
      return { ended: false as const, call: updated };
    });

    if (outcome.ended) {
      await this.announceEnd(callId);
      throw new ApiError(
        HttpStatus.CONFLICT,
        'CALL_NOT_RINGING',
        'The caller ran out of coins before the call started.',
        {
          reason: 'insufficient_coins',
        },
      );
    }
    const call = outcome.call;
    // Both members' screens (and the callee's other devices, which stop ringing).
    for (const id of [call.callerId, call.calleeId]) {
      this.realtime.send(id, { event: 'call:accept', data: { call: this.view(call, id) } });
    }
    if (call.ratePerMinute > 0) await this.afterCharge(call);
    return { call: this.view(call, userId), media: await this.grant(call, userId) };
  }

  /** POST /calls/:id/join: a fresh join token for either member of an active call (caller after call:accept, reconnects). */
  async join(userId: string, callId: string) {
    const call = await this.mine(userId, callId);
    if (call.status !== 'ACTIVE') throw this.notRinging('This call is not active.');
    const view = this.view(call, userId);
    const balance =
      call.callerId === userId && call.ratePerMinute > 0 ? (await this.wallets.balances(userId)).balance : null;
    return { call: view, media: await this.grant(call, userId), balance };
  }

  /** POST /calls/:id/decline (callee, while ringing). */
  async decline(userId: string, callId: string): Promise<CallView> {
    const call = await this.mine(userId, callId);
    if (call.calleeId !== userId) throw this.notFound();
    if (call.status === 'RINGING') await this.finish(callId, 'declined');
    return this.view(await this.prisma.callSession.findUniqueOrThrow({ where: { id: callId } }), userId);
  }

  /** POST /calls/:id/end: hangs up (either member). Idempotent. */
  async end(userId: string, callId: string): Promise<CallView> {
    const call = await this.mine(userId, callId);
    const reason = call.callerId === userId ? 'caller_hangup' : 'callee_hangup';
    await this.finish(callId, reason);
    return this.view(await this.prisma.callSession.findUniqueOrThrow({ where: { id: callId } }), userId);
  }

  async get(userId: string, callId: string): Promise<CallView> {
    return this.view(await this.mine(userId, callId), userId);
  }

  /** GET /calls/current: the member's live call, e.g. to show the incoming-call screen after a push. */
  async current(userId: string) {
    const call = await this.prisma.callSession.findFirst({
      where: {
        OR: [
          { status: 'ACTIVE', OR: [{ callerId: userId }, { calleeId: userId }] },
          { status: 'RINGING', ringExpiresAt: { gt: new Date() }, OR: [{ callerId: userId }, { calleeId: userId }] },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!call) return { call: null };
    const otherId = call.callerId === userId ? call.calleeId : call.callerId;
    const other = await this.prisma.profile.findUnique({ where: { userId: otherId }, select: { firstName: true } });
    return { call: this.view(call, userId), other: { id: otherId, first_name: other?.firstName ?? '' } };
  }

  /**
   * One pass of the call ticker (CallTicker, every CALL_TICK_MS): misses rings
   * past their timeout and charges every due minute. Rows are locked with
   * SKIP LOCKED, so several API instances can run it at once.
   */
  async tick(now = new Date()): Promise<{ missed: number; charged: number; cutOff: number }> {
    const result = { missed: 0, charged: 0, cutOff: 0 };
    const expired = await this.prisma.callSession.findMany({
      where: { status: 'RINGING', ringExpiresAt: { lte: now } },
      select: { id: true },
      take: 200,
    });
    for (const { id } of expired) {
      if (await this.finish(id, 'no_answer', now)) result.missed++;
    }

    const due = await this.prisma.callSession.findMany({
      where: { status: 'ACTIVE', nextBillAt: { lte: now } },
      select: { id: true },
      take: 200,
    });
    for (const { id } of due) {
      const outcome = await this.prisma.$transaction(async (tx) => {
        const [call] = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM call_sessions
           WHERE id = ${id}::uuid AND status = 'ACTIVE' AND next_bill_at <= ${now}
           FOR UPDATE SKIP LOCKED`;
        if (!call) return 'skipped' as const;
        const row = await tx.callSession.findUniqueOrThrow({ where: { id } });
        const minute = row.billedMinutes + 1;
        try {
          await this.chargeMinute(tx, row, minute);
        } catch (error) {
          if (!(error instanceof ApiError) || error.code !== 'INSUFFICIENT_COINS') throw error;
          await this.close(tx, id, 'insufficient_coins', now, 'INSUFFICIENT_COINS');
          return 'cut_off' as const;
        }
        return tx.callSession.update({
          where: { id },
          data: {
            billedMinutes: minute,
            totalCoinsBilled: minute * row.ratePerMinute,
            nextBillAt: new Date(row.nextBillAt!.getTime() + MINUTE_MS),
          },
        });
      });
      if (outcome === 'skipped') continue;
      if (outcome === 'cut_off') {
        result.cutOff++;
        await this.announceEnd(id);
        continue;
      }
      result.charged++;
      await this.afterCharge(outcome);
    }
    return result;
  }

  /** LiveKit webhook: a member left the room (app killed, network gone) ends the call and its billing. */
  async onMediaEvent(rawBody: string, authorization: string | undefined): Promise<void> {
    let event;
    try {
      event = await this.media.parseWebhook(rawBody, authorization);
    } catch {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'INVALID_SIGNATURE', 'Invalid webhook signature.');
    }
    if (event.kind === 'other') return;
    const callId = callIdFromRoom(event.room);
    if (!callId) return;
    const call = await this.prisma.callSession.findUnique({ where: { id: callId } });
    if (call?.status !== 'ACTIVE') return;
    await this.finish(callId, 'disconnected');
  }

  // ── internals ──

  /** Charges minute `minute` of a paid call: idempotent per call and minute. */
  private async chargeMinute(tx: Tx, call: CallSession, minute: number): Promise<void> {
    const earner = await this.hosts.activeEarner(call.calleeId, tx);
    await this.wallets.spendIn(tx, {
      userId: call.callerId,
      coins: call.ratePerMinute,
      idempotencyKey: `call:${call.id}:minute:${minute}`,
      metadata: { reason: 'call_minute', call_id: call.id, minute, call_type: call.type.toLowerCase() },
      earner,
    });
  }

  /** After a minute is charged: the caller's coin indicator, and a warning when the next minute can't be paid. */
  private async afterCharge(call: CallSession): Promise<void> {
    const { balance } = await this.wallets.balances(call.callerId);
    this.realtime.send(call.callerId, {
      event: 'call:billed',
      data: {
        call_id: call.id,
        billed_minutes: call.billedMinutes,
        total_coins_billed: call.totalCoinsBilled,
        rate_per_minute: call.ratePerMinute,
        balance,
      },
    });
    if (balance < call.ratePerMinute) {
      const secondsLeft = call.nextBillAt
        ? Math.max(0, Math.round((call.nextBillAt.getTime() - Date.now()) / 1000))
        : 0;
      this.realtime.send(call.callerId, {
        event: 'call:low_balance',
        data: { call_id: call.id, balance, required: call.ratePerMinute, seconds_left: secondsLeft },
      });
    }
  }

  /**
   * Ends a live call once (whoever gets there first wins), then tells both
   * members and closes the media room. Returns whether this call ended it.
   */
  private async finish(callId: string, reason: string, now = new Date()): Promise<boolean> {
    const ended = await this.prisma.$transaction((tx) => this.close(tx, callId, reason, now));
    if (ended) await this.announceEnd(callId);
    return ended;
  }

  /** Moves a live call to its final state inside a transaction. */
  private async close(tx: Tx, callId: string, reason: string, now: Date, forced?: CallStatus): Promise<boolean> {
    const call = await tx.callSession.findUnique({ where: { id: callId } });
    if (!call || !LIVE.includes(call.status)) return false;
    const status: CallStatus =
      forced ??
      (call.status === 'ACTIVE'
        ? 'ENDED'
        : reason === 'declined'
          ? 'DECLINED'
          : reason === 'no_answer'
            ? 'MISSED'
            : 'CANCELLED');
    const updated = await tx.callSession.updateMany({
      where: { id: callId, status: call.status },
      data: { status, endedAt: now, endReason: reason, nextBillAt: null },
    });
    return updated.count > 0;
  }

  /** call:decline or call:end to both members, and the room closes. */
  private async announceEnd(callId: string): Promise<void> {
    const call = await this.prisma.callSession.findUniqueOrThrow({ where: { id: callId } });
    const event = call.status === 'DECLINED' ? 'call:decline' : 'call:end';
    for (const id of [call.callerId, call.calleeId]) {
      const data: Record<string, unknown> = { call: this.view(call, id) };
      if (call.status === 'INSUFFICIENT_COINS' && id === call.callerId) {
        // The caller's app opens the top-up sheet.
        data.top_up = { balance: (await this.wallets.balances(id)).balance, required: call.ratePerMinute };
      }
      this.realtime.send(id, { event, data });
    }
    if (call.status === 'MISSED') {
      this.events.emit('call.missed', { callId: call.id, matchId: call.matchId, calleeId: call.calleeId });
    }
    if (call.startedAt) await this.media.closeRoom(roomName(call.id));
  }

  private async grant(call: CallSession, userId: string) {
    return this.media.joinToken({ room: roomName(call.id), identity: userId, video: call.type === 'VIDEO' });
  }

  /** Serialises call set-up for these members (in a stable order, so two calls can't deadlock). */
  private async lockMembers(tx: Tx, ids: string[]): Promise<void> {
    for (const id of [...ids].sort()) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`call:${id}`}, 0))`;
    }
  }

  private async lockCall(tx: Tx, callId: string): Promise<CallSession> {
    await tx.$queryRaw`SELECT id FROM call_sessions WHERE id = ${callId}::uuid FOR UPDATE`;
    return tx.callSession.findUniqueOrThrow({ where: { id: callId } });
  }

  /** A call this member is part of; anyone else gets a 404. */
  private async mine(userId: string, callId: string): Promise<CallSession> {
    const call = await this.prisma.callSession.findUnique({ where: { id: callId } });
    if (!call || (call.callerId !== userId && call.calleeId !== userId)) throw this.notFound();
    return call;
  }

  private async activeMatch(userId: string, matchId: string) {
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
    const meIsA = match.userAId === userId;
    return {
      me: meIsA ? match.userA : match.userB,
      otherId: meIsA ? match.userBId : match.userAId,
      otherVerified: meIsA ? match.userB.ageVerified : match.userA.ageVerified,
    };
  }

  private view(call: CallSession, viewerId: string): CallView {
    const role: CallRole = call.callerId === viewerId ? 'caller' : 'callee';
    return {
      id: call.id,
      match_id: call.matchId,
      type: call.type === 'VIDEO' ? 'video' : 'voice',
      status: call.status.toLowerCase(),
      role,
      other_user_id: role === 'caller' ? call.calleeId : call.callerId,
      rate_per_minute: call.ratePerMinute,
      paid: call.ratePerMinute > 0,
      ring_expires_at: call.ringExpiresAt.toISOString(),
      started_at: call.startedAt?.toISOString() ?? null,
      ended_at: call.endedAt?.toISOString() ?? null,
      billed_minutes: call.billedMinutes,
      ...(role === 'caller' ? { total_coins_billed: call.totalCoinsBilled } : {}),
      end_reason: call.endReason,
    };
  }

  private notFound(): ApiError {
    return new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Call not found.');
  }

  private notRinging(message = 'This call is no longer ringing.'): ApiError {
    return new ApiError(HttpStatus.CONFLICT, 'CALL_NOT_RINGING', message);
  }
}
