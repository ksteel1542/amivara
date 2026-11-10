import type { AddressInfo } from 'node:net';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import WebSocket from 'ws';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { OTP_SENDER } from '../src/modules/auth/otp-sender';
import { MEDIA_STORAGE } from '../src/modules/media/media-storage';
import { CLOSE_FORBIDDEN, CLOSE_UNAUTHENTICATED } from '../src/modules/messaging/chat.gateway';
import { MESSAGE_NOTIFICATION } from '../src/modules/notifications/notifications.service';
import {
  PUSH_SENDER,
  type PushMessage,
  type PushSender,
  type SendResult,
} from '../src/modules/notifications/push-sender';
import { PrismaService } from '../src/prisma/prisma.service';
import { CapturingSender, createMember, FakeMediaStorage } from './support/members';

class FakePushSender implements PushSender {
  readonly enabled = true;
  readonly sent: Array<{ token: string; message: PushMessage }> = [];
  async send(token: string, message: PushMessage): Promise<SendResult> {
    this.sent.push({ token, message });
    return 'sent';
  }
}

const settle = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

interface Frame {
  event: string;
  data: Record<string, unknown>;
}

/** A connected chat client that records every server event. */
class ChatClient {
  readonly frames: Frame[] = [];
  private constructor(readonly ws: WebSocket) {
    ws.on('message', (raw) => this.frames.push(JSON.parse(raw.toString()) as Frame));
  }

  static async open(url: string, token: string): Promise<ChatClient> {
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } });
    const client = new ChatClient(ws);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    await settle(150); // the server authenticates after the upgrade
    return client;
  }

  emit(event: string, data: Record<string, unknown>): void {
    this.ws.send(JSON.stringify({ event, data }));
  }

  async next(event: string, timeoutMs = 3000): Promise<Frame> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const i = this.frames.findIndex((f) => f.event === event);
      if (i >= 0) return this.frames.splice(i, 1)[0]!;
      await settle(20);
    }
    throw new Error(`No ${event} event within ${timeoutMs} ms (got ${JSON.stringify(this.frames)})`);
  }

  close(): void {
    this.ws.close();
  }
}

/** Resolves with the close code the server sent. */
function closeCode(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    ws.once('close', (code) => resolve(code));
    ws.once('error', reject);
  });
}

/**
 * Sprint 6 integration tests: chat history and sending over REST, the
 * /ws/chat socket (auth, delivery, typing, read receipts), encryption at rest
 * and progressive photo unlocking, against real PostgreSQL.
 */
describe('Messaging (integration, PostgreSQL + WebSocket)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let wsUrl: string;
  const otp = new CapturingSender();
  const push = new FakePushSender();
  const clients: ChatClient[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OTP_SENDER)
      .useValue(otp)
      .overrideProvider(MEDIA_STORAGE)
      .useValue(new FakeMediaStorage())
      .overrideProvider(PUSH_SENDER)
      .useValue(push)
      .compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    const { port } = app.getHttpServer().address() as AddressInfo;
    wsUrl = `ws://127.0.0.1:${port}/ws/chat`;
  });

  beforeEach(async () => {
    push.sent.length = 0;
    await prisma.$executeRaw`TRUNCATE users, otp_challenges, signup_blocks RESTART IDENTITY CASCADE`;
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
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

  async function member(verified = true): Promise<Member> {
    const token = await createMember(app, otp);
    const auth = { Authorization: `Bearer ${token}` };
    const me = await http().get('/v1/me').set(auth).expect(200);
    if (verified) await prisma.user.update({ where: { id: me.body.id }, data: { ageVerified: true } });
    return { id: me.body.id, token, auth };
  }

  async function makeMatch(a: Member, b: Member): Promise<string> {
    await http().post('/v1/matching/likes').set(b.auth).send({ user_id: a.id }).expect(201);
    const res = await http().post('/v1/matching/likes').set(a.auth).send({ user_id: b.id }).expect(201);
    return res.body.match_id;
  }

  const send = (m: Member, matchId: string, body: string) =>
    http().post(`/v1/matches/${matchId}/messages`).set(m.auth).send({ body });

  async function connect(m: Member): Promise<ChatClient> {
    const client = await ChatClient.open(wsUrl, m.token);
    clients.push(client);
    return client;
  }

  // ── REST ──────────────────────────────────────────────────

  it('sends and pages history newest first', async () => {
    const a = await member();
    const b = await member();
    const matchId = await makeMatch(a, b);

    for (let i = 1; i <= 5; i++) await send(i % 2 ? a : b, matchId, `message ${i}`).expect(201);

    const first = await http().get(`/v1/matches/${matchId}/messages?limit=3`).set(a.auth).expect(200);
    expect(first.body.messages.map((m: { body: string }) => m.body)).toEqual(['message 5', 'message 4', 'message 3']);
    expect(first.body.messages[0]).toMatchObject({ match_id: matchId, sender_id: a.id, type: 'text', read_at: null });
    expect(first.body.next_before).toBe(first.body.messages[2].id);

    const second = await http()
      .get(`/v1/matches/${matchId}/messages?limit=3&before=${first.body.next_before}`)
      .set(b.auth)
      .expect(200);
    expect(second.body.messages.map((m: { body: string }) => m.body)).toEqual(['message 2', 'message 1']);
    expect(second.body.next_before).toBeNull();

    const match = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(match.lastMessageAt).not.toBeNull();
  });

  it('encrypts message bodies at rest', async () => {
    const a = await member();
    const b = await member();
    const matchId = await makeMatch(a, b);
    await send(a, matchId, '  My number is 0803 000 0000  ').expect(201);

    const row = await prisma.message.findFirstOrThrow({ where: { matchId } });
    expect(row.body).toMatch(/^v1:/);
    expect(row.body).not.toContain('0803');
    const history = await http().get(`/v1/matches/${matchId}/messages`).set(b.auth).expect(200);
    expect(history.body.messages[0].body).toBe('My number is 0803 000 0000'); // trimmed
  });

  it('validates message bodies', async () => {
    const a = await member();
    const b = await member();
    const matchId = await makeMatch(a, b);
    await send(a, matchId, '   ').expect(400);
    await send(a, matchId, 'x'.repeat(2001)).expect(400);
    await http().post(`/v1/matches/${matchId}/messages`).set(a.auth).send({ body: 'hi', extra: 1 }).expect(400);
    await http().get('/v1/matches/not-a-uuid/messages').set(a.auth).expect(400);
  });

  it('requires verification', async () => {
    const a = await member();
    const b = await member();
    const matchId = await makeMatch(a, b);
    await prisma.user.update({ where: { id: a.id }, data: { ageVerified: false } });
    const res = await send(a, matchId, 'hello').expect(403);
    expect(res.body.error.code).toBe('VERIFICATION_REQUIRED');
    await http().get(`/v1/matches/${matchId}/messages`).set(a.auth).expect(403);
  });

  it('is a 404 for outsiders, unmatched pairs and banned members', async () => {
    const a = await member();
    const b = await member();
    const outsider = await member();
    const matchId = await makeMatch(a, b);
    await send(a, matchId, 'hello').expect(201);

    await send(outsider, matchId, 'let me in').expect(404);
    await http().get(`/v1/matches/${matchId}/messages`).set(outsider.auth).expect(404);

    await prisma.user.update({ where: { id: b.id }, data: { status: 'BANNED' } });
    await send(a, matchId, 'still there?').expect(404);
    await prisma.user.update({ where: { id: b.id }, data: { status: 'ACTIVE' } });

    await http().delete(`/v1/matches/${matchId}`).set(b.auth).expect(204);
    await send(a, matchId, 'hello?').expect(404);
    await http().get(`/v1/matches/${matchId}/messages`).set(a.auth).expect(404);
  });

  it('rate-limits senders', async () => {
    const a = await member();
    const b = await member();
    const matchId = await makeMatch(a, b);
    for (let i = 0; i < 30; i++) await send(a, matchId, `spam ${i}`).expect(201);
    const res = await send(a, matchId, 'one more').expect(429);
    expect(res.body.error.code).toBe('MESSAGE_RATE_LIMITED');
  });

  it('marks the other member’s messages as read', async () => {
    const a = await member();
    const b = await member();
    const matchId = await makeMatch(a, b);
    await send(a, matchId, 'one').expect(201);
    const two = await send(a, matchId, 'two').expect(201);
    await send(b, matchId, 'reply').expect(201);

    const res = await http()
      .post(`/v1/matches/${matchId}/read`)
      .set(b.auth)
      .send({ up_to_message_id: two.body.id })
      .expect(200);
    expect(res.body.read).toBe(2);
    const rows = await prisma.message.findMany({ where: { matchId }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => r.readAt !== null)).toEqual([true, true, false]); // B's own reply untouched

    const list = await http().get('/v1/matches').set(b.auth).expect(200);
    expect(list.body.matches[0].unread_count).toBe(0);
  });

  // ── Photo unlocking ───────────────────────────────────────

  it('unlocks photos once both members have sent 3 messages', async () => {
    const a = await member();
    const b = await member();
    const matchId = await makeMatch(a, b);
    const progress = async (m: Member) =>
      (await http().get(`/v1/matches/${matchId}/messages`).set(m.auth).expect(200)).body.photos;

    for (let i = 0; i < 5; i++) await send(a, matchId, `a${i}`).expect(201);
    await send(b, matchId, 'b0').expect(201);
    await send(b, matchId, 'b1').expect(201);
    expect(await progress(a)).toEqual({ unlocked: false, threshold: 3, mine: 3, theirs: 2 });
    expect((await prisma.match.findUniqueOrThrow({ where: { id: matchId } })).photosUnlocked).toBe(false);

    const socketA = await connect(a);
    await send(b, matchId, 'b2').expect(201);
    expect((await socketA.next('photos.unlocked')).data).toEqual({ match_id: matchId });
    expect(await progress(b)).toEqual({ unlocked: true, threshold: 3, mine: 3, theirs: 3 });

    const list = await http().get('/v1/matches').set(a.auth).expect(200);
    expect(list.body.matches[0].photos_unlocked).toBe(true);

    // Only announced once.
    await send(a, matchId, 'yay').expect(201);
    await settle();
    expect(socketA.frames.filter((f) => f.event === 'photos.unlocked')).toHaveLength(0);
  });

  // ── WebSocket ─────────────────────────────────────────────

  it('rejects sockets without a valid session or verification', async () => {
    expect(await closeCode(wsUrl, {})).toBe(CLOSE_UNAUTHENTICATED);
    expect(await closeCode(wsUrl, { Authorization: 'Bearer not-a-jwt' })).toBe(CLOSE_UNAUTHENTICATED);

    const unverified = await member(false);
    expect(await closeCode(wsUrl, { Authorization: `Bearer ${unverified.token}` })).toBe(CLOSE_FORBIDDEN);

    const loggedOut = await member();
    await http().post('/v1/auth/logout').set(loggedOut.auth).expect(204);
    expect(await closeCode(wsUrl, { Authorization: `Bearer ${loggedOut.token}` })).toBe(CLOSE_UNAUTHENTICATED);
  });

  it('delivers messages live to both members, and pushes only when offline', async () => {
    const a = await member();
    const b = await member();
    const matchId = await makeMatch(a, b);
    await http()
      .post('/v1/notifications/tokens')
      .set(b.auth)
      .send({ token: `fcm-token-b-${'x'.repeat(40)}`, platform: 'android' })
      .expect(204);
    await settle();
    push.sent.length = 0;

    // B offline: a generic push, with nothing from the message.
    await send(a, matchId, 'Are you free Saturday?').expect(201);
    await settle();
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]!.message.notification).toEqual(MESSAGE_NOTIFICATION);
    expect(JSON.stringify(push.sent[0]!.message)).not.toContain('Saturday');

    // Both online: sent over the socket, received live, no push.
    const socketA = await connect(a);
    const socketB = await connect(b);
    push.sent.length = 0;
    socketA.emit('message.send', { match_id: matchId, body: 'Lunch at 1?' });
    const incoming = await socketB.next('message.new');
    expect(incoming.data).toMatchObject({ match_id: matchId, sender_id: a.id, body: 'Lunch at 1?' });
    const echo = await socketA.next('message.new');
    expect(echo.data.id).toBe(incoming.data.id);
    await settle();
    expect(push.sent).toHaveLength(0);

    // REST sends are delivered live too.
    await send(b, matchId, 'Perfect').expect(201);
    expect((await socketA.next('message.new')).data).toMatchObject({ body: 'Perfect', sender_id: b.id });
  });

  it('relays typing and read receipts', async () => {
    const a = await member();
    const b = await member();
    const matchId = await makeMatch(a, b);
    const socketA = await connect(a);
    const socketB = await connect(b);

    socketB.emit('typing', { match_id: matchId });
    expect((await socketA.next('typing')).data).toEqual({ match_id: matchId, user_id: b.id });
    expect(socketB.frames.find((f) => f.event === 'typing')).toBeUndefined();

    const sent = await send(a, matchId, 'Read me').expect(201);
    await socketB.next('message.new');
    socketB.emit('message.read', { match_id: matchId, up_to_message_id: sent.body.id });
    const receipt = await socketA.next('message.read');
    expect(receipt.data).toMatchObject({ match_id: matchId, up_to_message_id: sent.body.id });
    expect(typeof receipt.data.read_at).toBe('string');
  });

  it('answers bad events with an error event and keeps the socket open', async () => {
    const a = await member();
    const b = await member();
    const outsider = await member();
    const matchId = await makeMatch(a, b);
    const socket = await connect(outsider);

    socket.ws.send('not json');
    expect((await socket.next('error')).data.code).toBe('VALIDATION_FAILED');
    socket.emit('message.send', { match_id: matchId, body: 'hi' });
    expect((await socket.next('error')).data.code).toBe('NOT_FOUND');
    socket.emit('typing', { match_id: matchId });
    expect((await socket.next('error')).data.code).toBe('NOT_FOUND');
    expect(socket.ws.readyState).toBe(WebSocket.OPEN);
    expect(await prisma.message.count()).toBe(0);
  });

  it('tells both open chats when the match is removed', async () => {
    const a = await member();
    const b = await member();
    const matchId = await makeMatch(a, b);
    const socketA = await connect(a);
    const socketB = await connect(b);

    await http().delete(`/v1/matches/${matchId}`).set(a.auth).expect(204);
    expect((await socketA.next('match.removed')).data).toEqual({ match_id: matchId });
    expect((await socketB.next('match.removed')).data).toEqual({ match_id: matchId });
    socketB.emit('message.send', { match_id: matchId, body: 'wait' });
    expect((await socketB.next('error')).data.code).toBe('NOT_FOUND');
  });
});
