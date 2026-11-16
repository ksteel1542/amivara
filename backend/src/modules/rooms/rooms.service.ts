import { HttpStatus, Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import type { ChatRoom, RoomAudience, RoomMode } from '../../../generated/prisma';
import { ApiError } from '../../common/api-error';
import { DomainEvents } from '../../common/domain-events';
import { MessageCipher } from '../../common/message-cipher';
import { PrismaService } from '../../prisma/prisma.service';
import { CALL_MEDIA, type CallMediaProvider } from '../calls/call-media';
import { CallsService } from '../calls/calls.service';
import { HostsService } from '../hosts/hosts.service';
import { detectContactSharing } from '../messaging/contact-detector';
import { RealtimeRegistry } from '../messaging/realtime.registry';
import { WalletService } from '../wallet/wallet.service';
import { GIFTS_PER_MINUTE } from '../gifts/gifts.service';

type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

export const MAX_ROOM_SEATS = 8;
/** LiveKit's cap per Chat House (host + seats + audience). */
export const MAX_ROOM_PARTICIPANTS = 500;
export const MAX_ROOM_MESSAGE_LENGTH = 500;
export const ROOM_MESSAGES_PER_MINUTE = 10;
/** A member whose app lost its connection has this long to come back before leaving the room. */
export const ROOM_OFFLINE_GRACE_MS = 30_000;

export const houseRoomName = (roomId: string) => `house_${roomId}`;
const roomIdFromName = (name: string) => /^house_([0-9a-f-]{36})$/.exec(name)?.[1];

const LIVE_ONLY = { status: 'LIVE' as const };

/**
 * Live "Chat House" rooms (MONETIZATION_PLAN.md 3b). A Verified Host opens a
 * room (audio, or audio and video, open or followers-only); everyone else
 * listens. Listeners ask for one of up to 8 speaker seats and the Host
 * accepts; speakers must be NIN-verified. The Host can mute, unseat or ban.
 * Seats are LiveKit publish permissions, set by the API. Rooms are live only:
 * nothing is recorded. Room chat is encrypted at rest, and messages that
 * share contact details are held back. A room closes when its Host ends it,
 * leaves, goes offline or is suspended.
 */
@Injectable()
export class RoomsService implements OnModuleInit {
  private readonly logger = new Logger(RoomsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hosts: HostsService,
    private readonly realtime: RealtimeRegistry,
    private readonly events: DomainEvents,
    private readonly cipher: MessageCipher,
    private readonly wallets: WalletService,
    private readonly calls: CallsService,
    @Inject(CALL_MEDIA) private readonly media: CallMediaProvider,
  ) {}

  onModuleInit(): void {
    const leaveAll = async (userId: string, reason: string) => {
      const present = await this.prisma.roomParticipant.findMany({
        where: { userId, leftAt: null, room: LIVE_ONLY },
        select: { roomId: true },
      });
      for (const { roomId } of present) await this.leave(userId, roomId, reason);
    };
    this.calls.onOtherMediaEvent(async (e) => {
      if (e.kind !== 'other') await this.onMediaLeft(e.room, e.identity, e.kind);
    });
    this.events.on('member.restricted', ({ userId }) => leaveAll(userId, 'host_restricted'));
    this.events.on('member.deleted', ({ userId }) => leaveAll(userId, 'host_left'));
    this.realtime.onOffline((userId) => {
      const timer = setTimeout(() => {
        if (this.realtime.isOnline(userId)) return;
        void leaveAll(userId, 'host_left').catch((error: Error) =>
          this.logger.error(`Leaving rooms of an offline member failed: ${error.message}`),
        );
      }, ROOM_OFFLINE_GRACE_MS);
      timer.unref();
    });
  }

  // ── Follows ──

  async follow(followerId: string, hostId: string): Promise<{ following: true }> {
    if (followerId === hostId)
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', "You can't follow yourself.");
    const host = await this.prisma.hostProfile.findUnique({ where: { userId: hostId }, select: { userId: true } });
    const blocked = await this.blockedBetween(followerId, hostId);
    if (!host || blocked) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Host not found.');
    await this.prisma.hostFollow.upsert({
      where: { followerId_hostId: { followerId, hostId } },
      create: { followerId, hostId },
      update: {},
    });
    return { following: true };
  }

  async unfollow(followerId: string, hostId: string): Promise<{ following: false }> {
    await this.prisma.hostFollow.deleteMany({ where: { followerId, hostId } });
    return { following: false };
  }

  // ── Rooms ──

  /** GET /rooms: live rooms this member may join (open ones, and followers-only rooms of Hosts they follow). */
  async list(userId: string) {
    const [follows, blocks] = await Promise.all([
      this.prisma.hostFollow.findMany({ where: { followerId: userId }, select: { hostId: true } }),
      this.prisma.block.findMany({
        where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
        select: { blockerId: true, blockedId: true },
      }),
    ]);
    const followed = follows.map((f) => f.hostId);
    const hidden = blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId));
    const rooms = await this.prisma.chatRoom.findMany({
      where: {
        status: 'LIVE',
        hostId: { notIn: hidden },
        bans: { none: { userId } },
        OR: [{ audience: 'OPEN' }, { hostId: { in: followed } }, { hostId: userId }],
      },
      orderBy: { startedAt: 'desc' },
      take: 50,
      include: {
        host: { select: { profile: { select: { firstName: true } } } },
        _count: { select: { participants: { where: { leftAt: null } } } },
      },
    });
    return {
      rooms: rooms.map((r) => ({
        id: r.id,
        title: r.title,
        mode: r.mode.toLowerCase(),
        audience: r.audience.toLowerCase(),
        host: { id: r.hostId, first_name: r.host.profile?.firstName ?? '' },
        following: followed.includes(r.hostId),
        listeners: r._count.participants,
        started_at: r.startedAt.toISOString(),
      })),
    };
  }

  /** POST /rooms: an active Verified Host goes live. Returns the room and the Host's join token. */
  async open(hostId: string, input: { title: string; mode: RoomMode; audience: RoomAudience; seats?: number }) {
    if (!(await this.hosts.activeEarner(hostId))) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'HOST_ONLY', 'Only active Verified Hosts can open a Chat House.');
    }
    this.requireMedia();
    const title = input.title.trim();
    if (title.length === 0 || title.length > 80) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Titles must be 1–80 characters.');
    }
    const live = await this.prisma.chatRoom.findFirst({ where: { hostId, status: 'LIVE' } });
    if (live) {
      throw new ApiError(HttpStatus.CONFLICT, 'ROOM_ALREADY_LIVE', 'You already have a live room.', {
        room_id: live.id,
      });
    }
    const room = await this.prisma.chatRoom.create({
      data: {
        hostId,
        title,
        mode: input.mode,
        audience: input.audience,
        maxSeats: Math.min(MAX_ROOM_SEATS, Math.max(0, input.seats ?? MAX_ROOM_SEATS)),
        participants: { create: { userId: hostId, role: 'HOST' } },
      },
    });
    try {
      await this.media.openRoom(houseRoomName(room.id), { maxParticipants: MAX_ROOM_PARTICIPANTS });
    } catch (error) {
      await this.prisma.chatRoom.update({
        where: { id: room.id },
        data: { status: 'ENDED', endedAt: new Date(), endReason: 'media_unavailable' },
      });
      this.logger.warn(`Opening a Chat House failed: ${(error as Error).message}`);
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'CALLS_UNAVAILABLE',
        "Your room couldn't start. Please try again.",
      );
    }
    return { room: await this.view(room.id, hostId), media: await this.token(room, hostId, true) };
  }

  /** POST /rooms/:id/join: as a listener (or back on your seat after a reconnect). */
  async join(userId: string, roomId: string) {
    this.requireMedia();
    const room = await this.liveRoom(roomId);
    if (room.hostId !== userId) {
      const [banned, blocked, follows] = await Promise.all([
        this.prisma.roomBan.count({ where: { roomId, userId } }),
        this.blockedBetween(userId, room.hostId),
        room.audience === 'FOLLOWERS'
          ? this.prisma.hostFollow.count({ where: { followerId: userId, hostId: room.hostId } })
          : Promise.resolve(1),
      ]);
      if (banned || blocked) throw this.notFound();
      if (!follows) {
        throw new ApiError(
          HttpStatus.FORBIDDEN,
          'FOLLOWERS_ONLY',
          'This room is for followers. Follow the Host to join.',
        );
      }
    }
    const existing = await this.prisma.roomParticipant.findUnique({ where: { roomId_userId: { roomId, userId } } });
    const participant = await this.prisma.roomParticipant.upsert({
      where: { roomId_userId: { roomId, userId } },
      create: { roomId, userId, role: room.hostId === userId ? 'HOST' : 'LISTENER' },
      // Coming back after leaving: back in the audience (seats aren't kept).
      update: existing?.leftAt ? { leftAt: null, role: 'LISTENER', seatRequestedAt: null, joinedAt: new Date() } : {},
    });
    const canPublish = participant.role !== 'LISTENER' && !participant.mutedByHost;
    if (!existing || existing.leftAt) await this.broadcastUpdate(roomId);
    return { room: await this.view(roomId, userId), media: await this.token(room, userId, canPublish) };
  }

  async get(userId: string, roomId: string) {
    const room = await this.prisma.chatRoom.findUnique({ where: { id: roomId } });
    if (!room) throw this.notFound();
    const me = await this.prisma.roomParticipant.findUnique({ where: { roomId_userId: { roomId, userId } } });
    if (room.hostId !== userId && (!me || me.leftAt) && room.status === 'LIVE') {
      // Not in the room: only what the list shows.
      const banned = await this.prisma.roomBan.count({ where: { roomId, userId } });
      if (banned || (await this.blockedBetween(userId, room.hostId))) throw this.notFound();
    }
    return { room: await this.view(roomId, userId) };
  }

  /** POST /rooms/:id/leave. The Host leaving ends the room. */
  async leave(userId: string, roomId: string, reason = 'host_left'): Promise<void> {
    const room = await this.prisma.chatRoom.findUnique({ where: { id: roomId } });
    if (!room || room.status !== 'LIVE') return;
    if (room.hostId === userId) {
      await this.end(userId, roomId, reason);
      return;
    }
    const left = await this.prisma.roomParticipant.updateMany({
      where: { roomId, userId, leftAt: null },
      data: { leftAt: new Date(), role: 'LISTENER', seatRequestedAt: null },
    });
    if (left.count > 0) await this.broadcastUpdate(roomId);
  }

  /** POST /rooms/:id/end (Host). Everyone is told and disconnected. */
  async end(userId: string, roomId: string, reason = 'host_ended'): Promise<void> {
    const room = await this.prisma.chatRoom.findUnique({ where: { id: roomId } });
    if (!room || room.hostId !== userId) throw this.notFound();
    const now = new Date();
    const ended = await this.prisma.chatRoom.updateMany({
      where: { id: roomId, status: 'LIVE' },
      data: { status: 'ENDED', endedAt: now, endReason: reason },
    });
    if (ended.count === 0) return;
    const present = await this.prisma.roomParticipant.findMany({
      where: { roomId, leftAt: null },
      select: { userId: true },
    });
    await this.prisma.roomParticipant.updateMany({ where: { roomId, leftAt: null }, data: { leftAt: now } });
    for (const p of present) this.realtime.send(p.userId, { event: 'room:ended', data: { room_id: roomId, reason } });
    await this.media.closeRoom(houseRoomName(roomId));
  }

  // ── Seats ──

  /** POST /rooms/:id/seat-request: a verified listener asks to speak. */
  async requestSeat(userId: string, roomId: string): Promise<void> {
    const room = await this.liveRoom(roomId);
    const me = await this.present(roomId, userId);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { ageVerified: true } });
    if (!user.ageVerified) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'VERIFICATION_REQUIRED', 'Verify your identity to speak in rooms.', {
        reason: 'speakers_require_verification',
      });
    }
    if (me.role !== 'LISTENER' || me.seatRequestedAt) return;
    await this.prisma.roomParticipant.update({
      where: { roomId_userId: { roomId, userId } },
      data: { seatRequestedAt: new Date() },
    });
    const profile = await this.prisma.profile.findUnique({ where: { userId }, select: { firstName: true } });
    this.realtime.send(room.hostId, {
      event: 'room:seat_request',
      data: { room_id: roomId, user: { id: userId, first_name: profile?.firstName ?? '' } },
    });
    await this.broadcastUpdate(roomId);
  }

  async cancelSeatRequest(userId: string, roomId: string): Promise<void> {
    await this.prisma.roomParticipant.updateMany({ where: { roomId, userId }, data: { seatRequestedAt: null } });
    await this.broadcastUpdate(roomId);
  }

  /** POST /rooms/:id/speakers/:userId (Host): seats a listener who asked. */
  async seat(hostId: string, roomId: string, userId: string): Promise<void> {
    const room = await this.hostRoom(hostId, roomId);
    await this.prisma.$transaction(async (tx) => {
      await this.lockRoom(tx, roomId);
      const target = await tx.roomParticipant.findUnique({ where: { roomId_userId: { roomId, userId } } });
      if (!target || target.leftAt || target.role !== 'LISTENER' || !target.seatRequestedAt) {
        throw new ApiError(HttpStatus.CONFLICT, 'NO_SEAT_REQUEST', 'They haven’t asked for a seat.');
      }
      const seated = await tx.roomParticipant.count({ where: { roomId, role: 'SPEAKER', leftAt: null } });
      if (seated >= room.maxSeats) {
        throw new ApiError(HttpStatus.CONFLICT, 'ROOM_SEATS_FULL', 'All speaker seats are taken.', {
          seats: room.maxSeats,
        });
      }
      await tx.roomParticipant.update({
        where: { roomId_userId: { roomId, userId } },
        data: { role: 'SPEAKER', seatRequestedAt: null, mutedByHost: false },
      });
    });
    await this.media.setPublish(houseRoomName(roomId), userId, { canPublish: true, video: room.mode === 'VIDEO' });
    await this.broadcastUpdate(roomId);
  }

  /** POST /rooms/:id/speakers/:userId/remove: the Host moves a speaker back to the audience, or a speaker steps down. */
  async unseat(actorId: string, roomId: string, userId: string): Promise<void> {
    const room = await this.liveRoom(roomId);
    if (actorId !== room.hostId && actorId !== userId) throw this.notFound();
    if (userId === room.hostId)
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'The Host keeps their seat.');
    const moved = await this.prisma.roomParticipant.updateMany({
      where: { roomId, userId, role: 'SPEAKER' },
      data: { role: 'LISTENER', mutedByHost: false },
    });
    if (moved.count === 0) return;
    await this.media.setPublish(houseRoomName(roomId), userId, { canPublish: false, video: room.mode === 'VIDEO' });
    await this.broadcastUpdate(roomId);
  }

  /** POST /rooms/:id/mute/:userId and /unmute/:userId (Host). */
  async setMuted(hostId: string, roomId: string, userId: string, muted: boolean): Promise<void> {
    const room = await this.hostRoom(hostId, roomId);
    const changed = await this.prisma.roomParticipant.updateMany({
      where: { roomId, userId, role: 'SPEAKER', leftAt: null },
      data: { mutedByHost: muted },
    });
    if (changed.count === 0) throw this.notFound();
    await this.media.setPublish(houseRoomName(roomId), userId, { canPublish: !muted, video: room.mode === 'VIDEO' });
    await this.broadcastUpdate(roomId);
  }

  /** POST /rooms/:id/ban/:userId (Host): removed now, and can't come back to this room. */
  async ban(hostId: string, roomId: string, userId: string): Promise<void> {
    await this.hostRoom(hostId, roomId);
    if (userId === hostId)
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', "You can't remove yourself.");
    await this.prisma.$transaction([
      this.prisma.roomBan.upsert({
        where: { roomId_userId: { roomId, userId } },
        create: { roomId, userId },
        update: {},
      }),
      this.prisma.roomParticipant.updateMany({
        where: { roomId, userId },
        data: { leftAt: new Date(), role: 'LISTENER', seatRequestedAt: null },
      }),
    ]);
    this.realtime.send(userId, { event: 'room:removed', data: { room_id: roomId } });
    await this.media.removeParticipant(houseRoomName(roomId), userId);
    await this.broadcastUpdate(roomId);
  }

  // ── Room chat ──

  async messages(userId: string, roomId: string) {
    await this.present(roomId, userId);
    const rows = await this.prisma.roomMessage.findMany({
      where: { roomId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { sender: { select: { profile: { select: { firstName: true } } } } },
    });
    return { messages: rows.map((m) => this.messageView(m, m.sender.profile?.firstName ?? '')) };
  }

  /**
   * POST /rooms/:id/messages. A message that shares contact details (phone,
   * WhatsApp, handles…) is held back: rooms are semi-public, so it's never
   * shown. The attempt is logged for Safety and the sender gets a notice.
   */
  async sendMessage(userId: string, roomId: string, rawBody: string) {
    await this.liveRoom(roomId);
    await this.present(roomId, userId);
    const body = rawBody.trim();
    if (body.length === 0 || body.length > MAX_ROOM_MESSAGE_LENGTH) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        `Messages must be 1–${MAX_ROOM_MESSAGE_LENGTH} characters.`,
      );
    }
    const lastMinute = await this.prisma.roomMessage.count({
      where: { senderId: userId, createdAt: { gte: new Date(Date.now() - 60_000) } },
    });
    if (lastMinute >= ROOM_MESSAGES_PER_MINUTE) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'MESSAGE_RATE_LIMITED', "You're sending messages too quickly.", {
        retry_after: 60,
      });
    }
    const signals = detectContactSharing(body);
    if (signals.length > 0) {
      await this.prisma.safetyEvent.create({ data: { userId, kind: 'ROOM_CONTACT_SHARING', signals } });
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'CONTACT_SHARING_BLOCKED',
        "For everyone's safety, phone numbers and contact details can't be shared in rooms.",
      );
    }
    const message = await this.prisma.roomMessage.create({
      data: { roomId, senderId: userId, body: this.cipher.encrypt(body) },
    });
    const profile = await this.prisma.profile.findUnique({ where: { userId }, select: { firstName: true } });
    const view = this.messageView(message, profile?.firstName ?? '');
    await this.broadcast(roomId, { event: 'room:message', data: { room_id: roomId, message: view } });
    return { message: view };
  }

  // ── Gifts ──

  /**
   * POST /rooms/:id/gifts: to the Host (default) or a seated speaker who is
   * also an active Verified Host. Everyone in the room sees it; the
   * recipient earns their share of the bought-coin part, held.
   */
  async sendGift(
    senderId: string,
    roomId: string,
    input: { giftId: string; recipientId?: string; idempotencyKey: string },
  ) {
    const room = await this.liveRoom(roomId);
    await this.present(roomId, senderId);
    const recipientId = input.recipientId ?? room.hostId;
    if (recipientId === senderId)
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', "You can't gift yourself.");
    if (recipientId !== room.hostId) {
      const seat = await this.prisma.roomParticipant.findUnique({
        where: { roomId_userId: { roomId, userId: recipientId } },
      });
      if (!seat || seat.leftAt || seat.role !== 'SPEAKER') throw this.notFound();
    }
    const earner = await this.hosts.activeEarner(recipientId);
    if (!earner) throw new ApiError(HttpStatus.FORBIDDEN, 'HOST_ONLY', 'Gifts can only be sent to Verified Hosts.');
    const gift = await this.prisma.gift.findFirst({ where: { id: input.giftId, active: true } });
    if (!gift) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Gift not found.');

    const ledgerKey = `gift:${senderId}:${input.idempotencyKey}`;
    const replay = await this.prisma.ledgerTransaction.findUnique({
      where: { idempotencyKey: ledgerKey },
      select: { id: true },
    });
    if (replay) {
      return { coins_charged: 0, balance: (await this.wallets.balances(senderId)).balance };
    }
    const lastMinute = await this.prisma.giftSend.count({
      where: { senderId, createdAt: { gte: new Date(Date.now() - 60_000) } },
    });
    if (lastMinute >= GIFTS_PER_MINUTE) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'GIFT_RATE_LIMITED', "You're sending gifts too quickly.", {
        retry_after: 60,
      });
    }
    await this.prisma.$transaction(async (tx) => {
      const spent = await this.wallets.spendIn(tx, {
        userId: senderId,
        coins: gift.priceCoins,
        idempotencyKey: ledgerKey,
        metadata: { reason: 'gift', gift: gift.slug, room_id: roomId },
        earner,
      });
      await tx.giftSend.create({
        data: {
          giftId: gift.id,
          senderId,
          recipientId,
          roomId,
          coins: gift.priceCoins,
          hostEarned: spent.hostEarned,
          ledgerTransactionId: spent.transactionId,
        },
      });
    });
    const names = await this.prisma.profile.findMany({
      where: { userId: { in: [senderId, recipientId] } },
      select: { userId: true, firstName: true },
    });
    const nameOf = (id: string) => names.find((n) => n.userId === id)?.firstName ?? '';
    await this.broadcast(roomId, {
      event: 'room:gift',
      data: {
        room_id: roomId,
        gift: { slug: gift.slug, name: gift.name, emoji: gift.emoji },
        from: { id: senderId, first_name: nameOf(senderId) },
        to: { id: recipientId, first_name: nameOf(recipientId) },
      },
    });
    return { coins_charged: gift.priceCoins, balance: (await this.wallets.balances(senderId)).balance };
  }

  // ── LiveKit webhooks ──

  /** A participant left the LiveKit room: if it's the Host, the room ends. Returns whether this was a room event. */
  async onMediaLeft(roomName: string, identity: string | undefined, kind: 'participant_left' | 'room_finished') {
    const roomId = roomIdFromName(roomName);
    if (!roomId) return false;
    const room = await this.prisma.chatRoom.findUnique({ where: { id: roomId } });
    if (room?.status !== 'LIVE') return true;
    if (kind === 'room_finished' || identity === room.hostId) await this.end(room.hostId, roomId, 'host_left');
    else if (identity) await this.leave(identity, roomId);
    return true;
  }

  // ── internals ──

  /** Everyone currently in the room gets the event. */
  async broadcast(roomId: string, event: Parameters<RealtimeRegistry['send']>[1], except?: string): Promise<void> {
    const present = await this.prisma.roomParticipant.findMany({
      where: { roomId, leftAt: null },
      select: { userId: true },
    });
    for (const p of present) if (p.userId !== except) this.realtime.send(p.userId, event);
  }

  private async broadcastUpdate(roomId: string): Promise<void> {
    const present = await this.prisma.roomParticipant.findMany({
      where: { roomId, leftAt: null },
      select: { userId: true },
    });
    for (const p of present) {
      this.realtime.send(p.userId, { event: 'room:updated', data: { room: await this.view(roomId, p.userId) } });
    }
  }

  /** The room as one member sees it: speakers, audience size, their own role; seat requests for the Host. */
  async view(roomId: string, viewerId: string) {
    const room = await this.prisma.chatRoom.findUniqueOrThrow({
      where: { id: roomId },
      include: {
        host: { select: { profile: { select: { firstName: true } } } },
        participants: {
          where: { leftAt: null },
          include: { user: { select: { profile: { select: { firstName: true } } } } },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });
    const me = room.participants.find((p) => p.userId === viewerId);
    const isHost = room.hostId === viewerId;
    const name = (p: (typeof room.participants)[number]) => p.user.profile?.firstName ?? '';
    const following =
      !isHost && (await this.prisma.hostFollow.count({ where: { followerId: viewerId, hostId: room.hostId } })) > 0;
    return {
      id: room.id,
      title: room.title,
      mode: room.mode.toLowerCase(),
      audience: room.audience.toLowerCase(),
      status: room.status.toLowerCase(),
      max_seats: room.maxSeats,
      host: { id: room.hostId, first_name: room.host.profile?.firstName ?? '' },
      speakers: room.participants
        .filter((p) => p.role !== 'LISTENER')
        .map((p) => ({ id: p.userId, first_name: name(p), role: p.role.toLowerCase(), muted_by_host: p.mutedByHost })),
      listeners: room.participants.filter((p) => p.role === 'LISTENER').length,
      // Only the Host sees who's asking for a seat.
      ...(isHost
        ? {
            seat_requests: room.participants
              .filter((p) => p.seatRequestedAt)
              .map((p) => ({ id: p.userId, first_name: name(p), requested_at: p.seatRequestedAt!.toISOString() })),
          }
        : {}),
      me: {
        role: me ? me.role.toLowerCase() : null,
        seat_requested: Boolean(me?.seatRequestedAt),
        muted_by_host: me?.mutedByHost ?? false,
        following,
      },
      started_at: room.startedAt.toISOString(),
      ended_at: room.endedAt?.toISOString() ?? null,
    };
  }

  private messageView(m: { id: string; senderId: string; body: string; createdAt: Date }, firstName: string) {
    return {
      id: m.id,
      sender: { id: m.senderId, first_name: firstName },
      body: this.cipher.decrypt(m.body),
      created_at: m.createdAt.toISOString(),
    };
  }

  private async token(room: ChatRoom, userId: string, canPublish: boolean) {
    return this.media.joinToken({
      room: houseRoomName(room.id),
      identity: userId,
      video: room.mode === 'VIDEO',
      canPublish,
    });
  }

  private requireMedia(): void {
    if (!this.media.configured) {
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'CALLS_UNAVAILABLE',
        'Chat House rooms are not available right now.',
      );
    }
  }

  private async liveRoom(roomId: string): Promise<ChatRoom> {
    const room = await this.prisma.chatRoom.findUnique({ where: { id: roomId } });
    if (!room) throw this.notFound();
    if (room.status !== 'LIVE') throw new ApiError(HttpStatus.GONE, 'ROOM_ENDED', 'This room has ended.');
    return room;
  }

  private async hostRoom(hostId: string, roomId: string): Promise<ChatRoom> {
    const room = await this.liveRoom(roomId);
    if (room.hostId !== hostId) throw this.notFound();
    return room;
  }

  private async present(roomId: string, userId: string) {
    const me = await this.prisma.roomParticipant.findUnique({ where: { roomId_userId: { roomId, userId } } });
    if (!me || me.leftAt) throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Join the room first.');
    return me;
  }

  private async lockRoom(tx: Tx, roomId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM chat_rooms WHERE id = ${roomId}::uuid FOR UPDATE`;
  }

  private async blockedBetween(a: string, b: string): Promise<boolean> {
    return (
      (await this.prisma.block.count({
        where: {
          OR: [
            { blockerId: a, blockedId: b },
            { blockerId: b, blockedId: a },
          ],
        },
      })) > 0
    );
  }

  private notFound(): ApiError {
    return new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Room not found.');
  }
}
