import type { AddressInfo } from 'node:net';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import WebSocket from 'ws';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MessageCipher } from '../src/common/message-cipher';
import { OTP_SENDER } from '../src/modules/auth/otp-sender';
import { CALL_MEDIA, type CallMediaProvider, type MediaEvent } from '../src/modules/calls/call-media';
import { MEDIA_STORAGE } from '../src/modules/media/media-storage';
import { houseRoomName } from '../src/modules/rooms/rooms.service';
import { SafetyService } from '../src/modules/safety/safety.service';
import { WalletService } from '../src/modules/wallet/wallet.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CapturingSender, createMember, FakeMediaStorage } from './support/members';

class FakeMedia implements CallMediaProvider {
  configured = true;
  readonly log: string[] = [];
  readonly tokens: Array<{ room: string; identity: string; video: boolean; canPublish?: boolean }> = [];
  async openRoom(room: string, opts?: { maxParticipants?: number }) {
    this.log.push(`open:${room}:${opts?.maxParticipants ?? 2}`);
  }
  async joinToken(input: { room: string; identity: string; video: boolean; canPublish?: boolean }) {
    this.tokens.push(input);
    return { url: 'wss://lk.test', token: `t-${input.identity}` };
  }
  async closeRoom(room: string) {
    this.log.push(`close:${room}`);
  }
  async setPublish(room: string, identity: string, opts: { canPublish: boolean; video: boolean }) {
    this.log.push(`publish:${identity}:${opts.canPublish}`);
  }
  async removeParticipant(room: string, identity: string) {
    this.log.push(`remove:${identity}`);
  }
  async parseWebhook(rawBody: string, authorization: string | undefined): Promise<MediaEvent> {
    if (authorization !== 'good') throw new Error('bad signature');
    return JSON.parse(rawBody) as MediaEvent;
  }
}

const settle = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

interface Frame {
  event: string;
  data: Record<string, unknown>;
}

class Socket {
  readonly frames: Frame[] = [];
  constructor(readonly ws: WebSocket) {
    ws.on('message', (raw) => this.frames.push(JSON.parse(raw.toString()) as Frame));
  }
  async next(event: string, timeoutMs = 3000): Promise<Frame> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const i = this.frames.findIndex((f) => f.event === event);
      if (i >= 0) return this.frames.splice(i, 1)[0]!;
      await settle(20);
    }
    throw new Error(`No ${event} within ${timeoutMs} ms (got ${JSON.stringify(this.frames.map((f) => f.event))})`);
  }
}

/**
 * Chat House rooms (MONETIZATION_PLAN.md 3b): Verified Hosts go live, members
 * listen, verified listeners ask for one of up to 8 seats, the Host seats,
 * mutes and bans, room chat holds back contact details, gifts go to Hosts,
 * and a room ends when its Host leaves.
 */
describe('Chat House rooms (integration, PostgreSQL + WebSocket)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let wsUrl: string;
  const otp = new CapturingSender();
  const media = new FakeMedia();
  const sockets: WebSocket[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OTP_SENDER)
      .useValue(otp)
      .overrideProvider(MEDIA_STORAGE)
      .useValue(new FakeMediaStorage())
      .overrideProvider(CALL_MEDIA)
      .useValue(media)
      .compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    const { port } = app.getHttpServer().address() as AddressInfo;
    wsUrl = `ws://127.0.0.1:${port}/ws/chat`;
  });

  beforeEach(async () => {
    media.log.length = 0;
    media.tokens.length = 0;
    media.configured = true;
    await prisma.$executeRaw`TRUNCATE users, otp_challenges, signup_blocks, audit_log, ledger_accounts, ledger_transactions, ledger_entries, promo_claims, host_profiles, host_earnings, gift_sends, chat_rooms, host_follows, reports RESTART IDENTITY CASCADE`;
  });

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.close();
    await settle(50);
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  interface Member {
    id: string;
    token: string;
    auth: { Authorization: string };
  }

  async function member(opts: { verified?: boolean; role?: 'MODERATOR' } = {}): Promise<Member> {
    const token = await createMember(app, otp);
    const auth = { Authorization: `Bearer ${token}` };
    const id = (await http().get('/v1/me').set(auth).expect(200)).body.id as string;
    await http().post('/v1/me/guidelines/accept').set(auth).expect(204);
    await prisma.user.update({
      where: { id },
      data: { ageVerified: opts.verified ?? true, ...(opts.role ? { role: opts.role } : {}) },
    });
    return { id, token, auth };
  }

  async function host(): Promise<Member> {
    const h = await member();
    await http().post('/v1/me/host').set(h.auth).expect(200);
    return h;
  }

  async function connect(m: Member): Promise<Socket> {
    const ws = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${m.token}` } });
    sockets.push(ws);
    const socket = new Socket(ws);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    await settle(150);
    return socket;
  }

  let adjustN = 0;
  async function credit(m: Member, coins: number) {
    const staff = await member({ role: 'MODERATOR' });
    await http()
      .post(`/v1/admin/users/${m.id}/coins`)
      .set(staff.auth)
      .send({ coins, wallet: 'paid', reason: 'Test credit', idempotency_key: `room-adjust-${++adjustN}` })
      .expect(200);
  }

  const openRoom = (h: Member, body: Record<string, unknown> = {}) =>
    http()
      .post('/v1/rooms')
      .set(h.auth)
      .send({ title: 'Friday vibes', mode: 'audio', ...body });

  it('only active Hosts go live, once at a time; members list, follow and join', async () => {
    const plain = await member();
    expect((await openRoom(plain).expect(403)).body.error.code).toBe('HOST_ONLY');

    const h = await host();
    const opened = await openRoom(h, { audience: 'followers', seats: 2 }).expect(201);
    expect(opened.body.room).toMatchObject({
      title: 'Friday vibes',
      mode: 'audio',
      audience: 'followers',
      max_seats: 2,
    });
    expect(opened.body.room.me.role).toBe('host');
    expect(media.log).toContain(`open:${houseRoomName(opened.body.room.id)}:500`);
    expect(media.tokens.at(-1)).toMatchObject({ identity: h.id, canPublish: true });
    expect((await openRoom(h).expect(409)).body.error.code).toBe('ROOM_ALREADY_LIVE');

    // Followers-only: hidden and closed until you follow.
    const fan = await member({ verified: false });
    expect((await http().get('/v1/rooms').set(fan.auth)).body.rooms).toHaveLength(0);
    const roomId = opened.body.room.id as string;
    expect((await http().post(`/v1/rooms/${roomId}/join`).set(fan.auth).expect(403)).body.error.code).toBe(
      'FOLLOWERS_ONLY',
    );
    await http().post(`/v1/hosts/${h.id}/follow`).set(fan.auth).expect(200);
    const listed = await http().get('/v1/rooms').set(fan.auth).expect(200);
    expect(listed.body.rooms[0]).toMatchObject({ id: roomId, following: true, host: { id: h.id } });

    // Unverified members can listen, never publish.
    const joined = await http().post(`/v1/rooms/${roomId}/join`).set(fan.auth).expect(200);
    expect(joined.body.room.me).toMatchObject({ role: 'listener', following: true });
    expect(media.tokens.at(-1)).toMatchObject({ identity: fan.id, canPublish: false });
    expect((await http().get(`/v1/rooms/${roomId}`).set(h.auth)).body.room.listeners).toBe(1);

    media.configured = false;
    await http().post(`/v1/rooms/${roomId}/join`).set(fan.auth).expect(503);
  });

  it('seats: verified listeners ask, the Host seats up to the limit, mutes and unseats', async () => {
    const h = await host();
    const roomId = (await openRoom(h, { seats: 1 }).expect(201)).body.room.id as string;
    const hostSocket = await connect(h);
    const a = await member();
    const b = await member();
    const unverified = await member({ verified: false });
    for (const m of [a, b, unverified]) await http().post(`/v1/rooms/${roomId}/join`).set(m.auth).expect(200);

    const denied = await http().post(`/v1/rooms/${roomId}/seat-request`).set(unverified.auth).expect(403);
    expect(denied.body.error.code).toBe('VERIFICATION_REQUIRED');
    await http().post(`/v1/rooms/${roomId}/speakers/${a.id}`).set(h.auth).expect(409); // hasn't asked

    await http().post(`/v1/rooms/${roomId}/seat-request`).set(a.auth).expect(204);
    expect((await hostSocket.next('room:seat_request')).data).toMatchObject({ user: { id: a.id } });
    const hostView = await http().get(`/v1/rooms/${roomId}`).set(h.auth).expect(200);
    expect(hostView.body.room.seat_requests).toEqual([expect.objectContaining({ id: a.id })]);
    const listenerView = await http().get(`/v1/rooms/${roomId}`).set(b.auth).expect(200);
    expect(listenerView.body.room).not.toHaveProperty('seat_requests'); // only the Host sees requests

    await http().post(`/v1/rooms/${roomId}/speakers/${a.id}`).set(b.auth).expect(404); // not the Host
    await http().post(`/v1/rooms/${roomId}/speakers/${a.id}`).set(h.auth).expect(204);
    expect(media.log).toContain(`publish:${a.id}:true`);
    await http().post(`/v1/rooms/${roomId}/seat-request`).set(b.auth).expect(204);
    const full = await http().post(`/v1/rooms/${roomId}/speakers/${b.id}`).set(h.auth).expect(409);
    expect(full.body.error.code).toBe('ROOM_SEATS_FULL');

    await http().post(`/v1/rooms/${roomId}/mute/${a.id}`).set(h.auth).expect(204);
    expect(media.log.at(-1)).toBe(`publish:${a.id}:false`);
    expect((await http().get(`/v1/rooms/${roomId}`).set(a.auth)).body.room.me).toMatchObject({
      role: 'speaker',
      muted_by_host: true,
    });
    // A reconnect while muted doesn't get publish rights back.
    await http().post(`/v1/rooms/${roomId}/join`).set(a.auth).expect(200);
    expect(media.tokens.at(-1)).toMatchObject({ identity: a.id, canPublish: false });
    await http().post(`/v1/rooms/${roomId}/unmute/${a.id}`).set(h.auth).expect(204);

    // A speaker can step down; the seat frees up.
    await http().post(`/v1/rooms/${roomId}/speakers/${a.id}/remove`).set(a.auth).expect(204);
    expect(media.log.at(-1)).toBe(`publish:${a.id}:false`);
    await http().post(`/v1/rooms/${roomId}/speakers/${b.id}`).set(h.auth).expect(204);
    const speakers = (await http().get(`/v1/rooms/${roomId}`).set(h.auth)).body.room.speakers as Array<{ id: string }>;
    expect(speakers.map((s) => s.id).sort()).toEqual([h.id, b.id].sort());
  });

  it('room chat is live and encrypted; contact details are held back', async () => {
    const h = await host();
    const roomId = (await openRoom(h).expect(201)).body.room.id as string;
    const fan = await member();
    await http().post(`/v1/rooms/${roomId}/messages`).set(fan.auth).send({ body: 'hi' }).expect(403); // not joined
    await http().post(`/v1/rooms/${roomId}/join`).set(fan.auth).expect(200);
    const hostSocket = await connect(h);

    const sent = await http()
      .post(`/v1/rooms/${roomId}/messages`)
      .set(fan.auth)
      .send({ body: 'Hello everyone!' })
      .expect(201);
    expect((await hostSocket.next('room:message')).data).toMatchObject({
      message: { id: sent.body.message.id, body: 'Hello everyone!', sender: { id: fan.id } },
    });
    const stored = await prisma.roomMessage.findUniqueOrThrow({ where: { id: sent.body.message.id } });
    expect(stored.body).not.toContain('Hello');
    expect(app.get(MessageCipher).decrypt(stored.body)).toBe('Hello everyone!');

    const held = await http()
      .post(`/v1/rooms/${roomId}/messages`)
      .set(fan.auth)
      .send({ body: 'Call me on 08031234567' })
      .expect(422);
    expect(held.body.error.code).toBe('CONTACT_SHARING_BLOCKED');
    expect(await prisma.roomMessage.count({ where: { roomId } })).toBe(1);
    expect(await prisma.safetyEvent.count({ where: { userId: fan.id, kind: 'ROOM_CONTACT_SHARING' } })).toBe(1);
    const history = await http().get(`/v1/rooms/${roomId}/messages`).set(h.auth).expect(200);
    expect(history.body.messages).toHaveLength(1);
  });

  it('gifts in a room: to the Host or a seated Host; everyone sees them; earnings held', async () => {
    const h = await host();
    const roomId = (await openRoom(h).expect(201)).body.room.id as string;
    const fan = await member();
    const guest = await member(); // seated, but not a Host
    await credit(fan, 200);
    for (const m of [fan, guest]) await http().post(`/v1/rooms/${roomId}/join`).set(m.auth).expect(200);
    await http().post(`/v1/rooms/${roomId}/seat-request`).set(guest.auth).expect(204);
    await http().post(`/v1/rooms/${roomId}/speakers/${guest.id}`).set(h.auth).expect(204);
    const guestSocket = await connect(guest);
    const gifts = (await http().get('/v1/gifts').set(fan.auth)).body.gifts as Array<{ id: string; slug: string }>;
    const rose = gifts.find((g) => g.slug === 'rose')!.id;

    const sent = await http()
      .post(`/v1/rooms/${roomId}/gifts`)
      .set(fan.auth)
      .send({ gift_id: rose, idempotency_key: 'room-tap-1' })
      .expect(201);
    expect(sent.body).toMatchObject({ coins_charged: 20, balance: 180 });
    expect((await guestSocket.next('room:gift')).data).toMatchObject({
      gift: { slug: 'rose' },
      from: { id: fan.id },
      to: { id: h.id },
    });
    await http()
      .post(`/v1/rooms/${roomId}/gifts`)
      .set(fan.auth)
      .send({ gift_id: rose, idempotency_key: 'room-tap-1' })
      .expect(201); // retried tap: not charged twice
    expect((await app.get(WalletService).balances(fan.id)).balance).toBe(180);
    expect((await http().get('/v1/me/host/earnings').set(h.auth)).body.pending_coins).toBe(10);

    const notHost = await http()
      .post(`/v1/rooms/${roomId}/gifts`)
      .set(fan.auth)
      .send({ gift_id: rose, recipient_id: guest.id, idempotency_key: 'room-tap-2' })
      .expect(403);
    expect(notHost.body.error.code).toBe('HOST_ONLY');
    expect(await prisma.giftSend.count({ where: { roomId } })).toBe(1);
  });

  it('bans remove a member for good; the Host leaving ends the room for everyone', async () => {
    const h = await host();
    const roomId = (await openRoom(h).expect(201)).body.room.id as string;
    const troll = await member();
    const fan = await member();
    for (const m of [troll, fan]) await http().post(`/v1/rooms/${roomId}/join`).set(m.auth).expect(200);
    const trollSocket = await connect(troll);
    const fanSocket = await connect(fan);

    await http().post(`/v1/rooms/${roomId}/ban/${troll.id}`).set(h.auth).expect(204);
    expect((await trollSocket.next('room:removed')).data).toMatchObject({ room_id: roomId });
    expect(media.log).toContain(`remove:${troll.id}`);
    await http().post(`/v1/rooms/${roomId}/join`).set(troll.auth).expect(404);
    expect((await http().get('/v1/rooms').set(troll.auth)).body.rooms).toHaveLength(0);

    await http().post(`/v1/rooms/${roomId}/leave`).set(h.auth).expect(204);
    expect((await fanSocket.next('room:ended')).data).toMatchObject({ room_id: roomId, reason: 'host_left' });
    expect(media.log).toContain(`close:${houseRoomName(roomId)}`);
    expect((await http().post(`/v1/rooms/${roomId}/join`).set(fan.auth).expect(410)).body.error.code).toBe(
      'ROOM_ENDED',
    );
    await openRoom(h).expect(201); // can go live again
  });

  it('LiveKit: the Host dropping out of the media room ends it', async () => {
    const h = await host();
    const roomId = (await openRoom(h).expect(201)).body.room.id as string;
    await http()
      .post('/v1/calls/livekit/webhook')
      .set('Content-Type', 'application/webhook+json')
      .set('Authorization', 'good')
      .send(JSON.stringify({ kind: 'participant_left', room: houseRoomName(roomId), identity: h.id }))
      .expect(200);
    const room = await prisma.chatRoom.findUniqueOrThrow({ where: { id: roomId } });
    expect(room).toMatchObject({ status: 'ENDED', endReason: 'host_left' });
  });

  it('the report button reports the Host with the room as evidence; blocked members never see each other’s rooms', async () => {
    const h = await host();
    const roomId = (await openRoom(h).expect(201)).body.room.id as string;
    await http().post(`/v1/rooms/${roomId}/messages`).set(h.auth).send({ body: 'Send me gifts or leave' }).expect(201);
    const fan = await member();
    await http().post(`/v1/rooms/${roomId}/join`).set(fan.auth).expect(200);

    const res = await http()
      .post(`/v1/rooms/${roomId}/report`)
      .set(fan.auth)
      .send({ category: 'scam', details: 'Pressuring for gifts' })
      .expect(201);
    const report = await prisma.report.findUniqueOrThrow({ where: { id: res.body.report_id } });
    expect(report).toMatchObject({ reportedId: h.id, roomId });
    const evidence = app.get(SafetyService).decryptEvidence(report.evidence);
    expect(evidence.room).toMatchObject({ id: roomId, title: 'Friday vibes' });
    expect(evidence.room!.messages.map((m) => m.body)).toEqual(['Send me gifts or leave']);

    // Reporting blocks: the reporter is out, and the Host's rooms are hidden from them.
    expect((await http().get(`/v1/rooms/${roomId}`).set(fan.auth)).status).toBe(404);
    expect((await http().get('/v1/rooms').set(fan.auth)).body.rooms).toHaveLength(0);
  });
});
