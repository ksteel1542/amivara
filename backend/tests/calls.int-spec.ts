import type { AddressInfo } from 'node:net';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import WebSocket from 'ws';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { OTP_SENDER } from '../src/modules/auth/otp-sender';
import { CALL_MEDIA, type CallMediaProvider, type MediaEvent } from '../src/modules/calls/call-media';
import { CallsService, MINUTE_MS, roomName } from '../src/modules/calls/calls.service';
import { MEDIA_STORAGE } from '../src/modules/media/media-storage';
import { CALL_NOTIFICATION, MISSED_CALL_NOTIFICATION } from '../src/modules/notifications/notifications.service';
import {
  PUSH_SENDER,
  type PushMessage,
  type PushSender,
  type SendResult,
} from '../src/modules/notifications/push-sender';
import { WalletService } from '../src/modules/wallet/wallet.service';
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

/** Stands in for LiveKit: records rooms and tokens, and "verifies" webhooks signed 'good'. */
class FakeMedia implements CallMediaProvider {
  configured = true;
  readonly opened: string[] = [];
  readonly closed: string[] = [];
  readonly tokens: Array<{ room: string; identity: string; video: boolean }> = [];
  async openRoom(room: string): Promise<void> {
    this.opened.push(room);
  }
  async joinToken(input: { room: string; identity: string; video: boolean }) {
    this.tokens.push(input);
    return { url: 'wss://livekit.example.test', token: `token-for-${input.identity}` };
  }
  async closeRoom(room: string): Promise<void> {
    this.closed.push(room);
  }
  async setPublish(): Promise<void> {}
  async removeParticipant(): Promise<void> {}
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
    await settle(150);
    return client;
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

  has(event: string): boolean {
    return this.frames.some((f) => f.event === event);
  }

  close(): void {
    this.ws.close();
  }
}

/**
 * Milestone 4/5 (docs/MONETIZATION_PLAN.md): 1-on-1 voice and video calls.
 * Ringing over /ws/chat, a 45-second ring timeout, LiveKit (faked here) for
 * media, and per-minute billing for calls to Verified Hosts: 30 coins a
 * minute for voice, 60 for video, the first minute on answer, then one every
 * 60 seconds, cut off when the caller can't pay; the Host earns half of the
 * bought-coin part, held 7 days.
 */
describe('Calls (integration, PostgreSQL + WebSocket)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let calls: CallsService;
  let wsUrl: string;
  const otp = new CapturingSender();
  const push = new FakePushSender();
  const media = new FakeMedia();
  const clients: ChatClient[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OTP_SENDER)
      .useValue(otp)
      .overrideProvider(MEDIA_STORAGE)
      .useValue(new FakeMediaStorage())
      .overrideProvider(PUSH_SENDER)
      .useValue(push)
      .overrideProvider(CALL_MEDIA)
      .useValue(media)
      .compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    calls = app.get(CallsService);
    const { port } = app.getHttpServer().address() as AddressInfo;
    wsUrl = `ws://127.0.0.1:${port}/ws/chat`;
  });

  beforeEach(async () => {
    push.sent.length = 0;
    media.configured = true;
    media.opened.length = 0;
    media.closed.length = 0;
    media.tokens.length = 0;
    await prisma.$executeRaw`TRUNCATE users, otp_challenges, signup_blocks, audit_log, ledger_accounts, ledger_transactions, ledger_entries, promo_claims, host_profiles, host_earnings, call_sessions RESTART IDENTITY CASCADE`;
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

  async function makeMatch(a: Member, b: Member): Promise<string> {
    await http().post('/v1/matching/likes').set(b.auth).send({ user_id: a.id }).expect(201);
    return (await http().post('/v1/matching/likes').set(a.auth).send({ user_id: b.id }).expect(201)).body
      .match_id as string;
  }

  let adjustN = 0;
  async function credit(m: Member, coins: number, wallet: 'paid' | 'promo' = 'paid') {
    const staff = await member({ role: 'MODERATOR' });
    await http()
      .post(`/v1/admin/users/${m.id}/coins`)
      .set(staff.auth)
      .send({ coins, wallet, reason: 'Test credit', idempotency_key: `call-adjust-${++adjustN}` })
      .expect(200);
  }

  async function connect(m: Member): Promise<ChatClient> {
    const client = await ChatClient.open(wsUrl, m.token);
    clients.push(client);
    return client;
  }

  const balance = (m: Member) => app.get(WalletService).balances(m.id);
  const ring = (m: Member, matchId: string, type: 'voice' | 'video') =>
    http().post(`/v1/matches/${matchId}/calls`).set(m.auth).send({ type });
  const later = (ms: number) => new Date(Date.now() + ms);

  async function expectLedgerBalanced() {
    const unbalanced = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT transaction_id AS id FROM ledger_entries GROUP BY transaction_id HAVING SUM(amount) <> 0`;
    expect(unbalanced).toEqual([]);
  }

  it('calls need NIN verification on both sides and a configured media server', async () => {
    const verified = await member();
    const unverified = await member({ verified: false });
    const matchId = await makeMatch(verified, unverified);

    const me = await http().get('/v1/me').set(unverified.auth).expect(200);
    expect(me.body.capabilities).toMatchObject({ voice_calls: false, video_calls: false });
    const denied = await ring(unverified, matchId, 'voice').expect(403);
    expect(denied.body.error).toMatchObject({
      code: 'VERIFICATION_REQUIRED',
      details: { reason: 'calls_require_verification' },
    });
    const calleeDenied = await ring(verified, matchId, 'video').expect(403);
    expect(calleeDenied.body.error.details.reason).toBe('callee_unverified');
    expect((await http().get(`/v1/matches/${matchId}/calls/quote`).set(verified.auth)).body.allowed).toBe(false);

    const a = await member();
    const b = await member();
    const ab = await makeMatch(a, b);
    media.configured = false;
    expect((await ring(a, ab, 'voice').expect(503)).body.error.code).toBe('CALLS_UNAVAILABLE');
    expect((await http().get(`/v1/matches/${ab}/calls/quote`).set(a.auth)).body).toEqual({
      available: false,
      allowed: true,
      paid: false,
      voice_rate_per_minute: 0,
      video_rate_per_minute: 0,
    });
    const stranger = await member();
    await ring(stranger, ab, 'voice').expect(404);
  });

  it('a free call between members who aren’t Hosts: ring, answer, hang up', async () => {
    const a = await member();
    const b = await member();
    const matchId = await makeMatch(a, b);
    const bSocket = await connect(b);
    const aSocket = await connect(a);

    const started = await ring(a, matchId, 'voice').expect(201);
    expect(started.body.call).toMatchObject({
      status: 'ringing',
      role: 'caller',
      type: 'voice',
      paid: false,
      rate_per_minute: 0,
    });
    const rang = await bSocket.next('call:ring');
    expect(rang.data).toMatchObject({ call: { id: started.body.call.id, role: 'callee' }, caller: { id: a.id } });
    expect(push.sent).toHaveLength(0); // b's app is open: no push

    const accepted = await http().post(`/v1/calls/${started.body.call.id}/accept`).set(b.auth).expect(200);
    expect(accepted.body).toMatchObject({
      call: { status: 'active', billed_minutes: 0 },
      media: { url: 'wss://livekit.example.test', token: `token-for-${b.id}` },
    });
    expect(accepted.body.call).not.toHaveProperty('total_coins_billed'); // only the caller sees the cost
    expect(media.opened).toEqual([roomName(started.body.call.id)]);
    expect((await aSocket.next('call:accept')).data).toMatchObject({ call: { status: 'active', role: 'caller' } });
    const joined = await http().post(`/v1/calls/${started.body.call.id}/join`).set(a.auth).expect(200);
    expect(joined.body.media.token).toBe(`token-for-${a.id}`);
    expect(media.tokens.every((t) => !t.video)).toBe(true); // voice: microphone only

    // Free calls are never billed by the ticker.
    expect((await calls.tick(later(5 * MINUTE_MS))).charged).toBe(0);
    const ended = await http().post(`/v1/calls/${started.body.call.id}/end`).set(a.auth).expect(200);
    expect(ended.body.call).toMatchObject({ status: 'ended', end_reason: 'caller_hangup', total_coins_billed: 0 });
    expect((await bSocket.next('call:end')).data).toMatchObject({ call: { status: 'ended' } });
    expect(media.closed).toEqual([roomName(started.body.call.id)]);
    await http().post(`/v1/calls/${started.body.call.id}/end`).set(b.auth).expect(200); // idempotent
  });

  it('calling a Host: 402 without a minute of coins, which opens the top-up sheet', async () => {
    const h = await host();
    const fan = await member();
    const matchId = await makeMatch(fan, h);
    await credit(fan, 59);
    const quote = await http().get(`/v1/matches/${matchId}/calls/quote`).set(fan.auth).expect(200);
    expect(quote.body).toMatchObject({ paid: true, voice_rate_per_minute: 30, video_rate_per_minute: 60 });
    const broke = await ring(fan, matchId, 'video').expect(402);
    expect(broke.body.error).toMatchObject({ code: 'INSUFFICIENT_COINS', details: { balance: 59, required: 60 } });
    await ring(fan, matchId, 'voice').expect(201); // 59 covers a voice minute
  });

  it('per-minute billing: first minute on answer, then every 60 s, with the Host earning half of bought coins', async () => {
    const h = await host();
    const fan = await member();
    const matchId = await makeMatch(fan, h);
    await credit(fan, 100);
    const fanSocket = await connect(fan);
    await connect(h);

    const { body } = await ring(fan, matchId, 'voice').expect(201);
    const callId = body.call.id as string;
    await http().post(`/v1/calls/${callId}/accept`).set(h.auth).expect(200);
    expect((await balance(fan)).balance).toBe(70);
    const billed1 = await fanSocket.next('call:billed');
    expect(billed1.data).toMatchObject({ call_id: callId, billed_minutes: 1, total_coins_billed: 30, balance: 70 });

    // Not due yet: nothing happens.
    expect((await calls.tick(later(30_000))).charged).toBe(0);
    expect((await calls.tick(later(MINUTE_MS + 1000))).charged).toBe(1);
    expect((await balance(fan)).balance).toBe(40);
    expect((await fanSocket.next('call:billed')).data).toMatchObject({ billed_minutes: 2, balance: 40 });
    expect(fanSocket.has('call:low_balance')).toBe(false);

    const ended = await http().post(`/v1/calls/${callId}/end`).set(h.auth).expect(200);
    expect(ended.body.call).toMatchObject({ status: 'ended', end_reason: 'callee_hangup', billed_minutes: 2 });
    const caller = await http().get(`/v1/calls/${callId}`).set(fan.auth).expect(200);
    expect(caller.body.call.total_coins_billed).toBe(60);

    // Half of the 60 bought coins, held for 7 days.
    const earnings = await http().get('/v1/me/host/earnings').set(h.auth).expect(200);
    expect(earnings.body).toMatchObject({ pending_coins: 30, available_coins: 0 });
    expect(await prisma.hostEarning.count({ where: { hostId: h.id } })).toBe(2);
    // An ended call is never billed again.
    expect((await calls.tick(later(10 * MINUTE_MS))).charged).toBe(0);
    await expectLedgerBalanced();
  });

  it('low balance warning, then the call is cut off when the next minute can’t be paid', async () => {
    const h = await host();
    const fan = await member();
    const matchId = await makeMatch(fan, h);
    await credit(fan, 70);
    const fanSocket = await connect(fan);
    const hostSocket = await connect(h);

    const { body } = await ring(fan, matchId, 'video').expect(201);
    const callId = body.call.id as string;
    const accepted = await http().post(`/v1/calls/${callId}/accept`).set(h.auth).expect(200);
    expect(media.tokens.at(-1)).toMatchObject({ identity: h.id, video: true });
    expect(accepted.body.call.rate_per_minute).toBe(60);
    const low = await fanSocket.next('call:low_balance');
    expect(low.data).toMatchObject({ call_id: callId, balance: 10, required: 60 });
    expect(hostSocket.has('call:low_balance')).toBe(false); // the Host never sees the member's coins

    const run = await calls.tick(later(MINUTE_MS + 1000));
    expect(run).toMatchObject({ charged: 0, cutOff: 1 });
    const end = await fanSocket.next('call:end');
    expect(end.data).toMatchObject({
      call: { status: 'insufficient_coins', end_reason: 'insufficient_coins', billed_minutes: 1 },
      top_up: { balance: 10, required: 60 },
    });
    const hostEnd = await hostSocket.next('call:end');
    expect(hostEnd.data).not.toHaveProperty('top_up');
    expect(media.closed).toContain(roomName(callId));
    expect((await balance(fan)).balance).toBe(10);
    await expectLedgerBalanced();
  });

  it('promo coins pay for minutes but never become Host earnings', async () => {
    const h = await host();
    const fan = await member();
    const matchId = await makeMatch(fan, h);
    await credit(fan, 30, 'promo');
    const { body } = await ring(fan, matchId, 'voice').expect(201);
    await http().post(`/v1/calls/${body.call.id}/accept`).set(h.auth).expect(200);
    expect((await balance(fan)).balance).toBe(0);
    expect((await http().get('/v1/me/host/earnings').set(h.auth)).body.pending_coins).toBe(0);
  });

  it('a caller who ran out before the answer: the call ends with INSUFFICIENT_COINS', async () => {
    const h = await host();
    const fan = await member();
    const matchId = await makeMatch(fan, h);
    await credit(fan, 30);
    const { body } = await ring(fan, matchId, 'voice').expect(201);
    // Spent elsewhere while it rang.
    await app.get(WalletService).spend({ userId: fan.id, coins: 20, idempotencyKey: 'elsewhere' });
    const res = await http().post(`/v1/calls/${body.call.id}/accept`).set(h.auth).expect(409);
    expect(res.body.error).toMatchObject({ code: 'CALL_NOT_RINGING', details: { reason: 'insufficient_coins' } });
    expect((await http().get(`/v1/calls/${body.call.id}`).set(fan.auth)).body.call.status).toBe('insufficient_coins');
    expect((await balance(fan)).balance).toBe(10);
  });

  it('an unanswered call is missed after 45 seconds; offline callees get generic pushes', async () => {
    const a = await member();
    const b = await member();
    const matchId = await makeMatch(a, b);
    await http()
      .post('/v1/notifications/tokens')
      .set(b.auth)
      .send({ token: `fcm-token-b-${'x'.repeat(40)}`, platform: 'android' })
      .expect(204);
    const aSocket = await connect(a);

    const { body } = await ring(a, matchId, 'video').expect(201);
    await settle(100);
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]!.message).toEqual({
      notification: CALL_NOTIFICATION,
      data: { type: 'call.ring', call_id: body.call.id, match_id: matchId, call_type: 'video' },
    });

    expect((await calls.tick(later(30_000))).missed).toBe(0);
    expect((await calls.tick(later(46_000))).missed).toBe(1);
    expect((await aSocket.next('call:end')).data).toMatchObject({
      call: { status: 'missed', end_reason: 'no_answer' },
    });
    await settle(100);
    expect(push.sent.at(-1)!.message.notification).toEqual(MISSED_CALL_NOTIFICATION);
    // Nothing in a push names the caller.
    expect(JSON.stringify(push.sent)).not.toContain(a.id);
    await http().post(`/v1/calls/${body.call.id}/accept`).set(b.auth).expect(409);
  });

  it('decline, busy, redial, and only the two members can touch a call', async () => {
    const a = await member();
    const b = await member();
    const c = await member();
    const ab = await makeMatch(a, b);
    const cb = await makeMatch(c, b);
    const aSocket = await connect(a);

    const first = (await ring(a, ab, 'voice').expect(201)).body.call.id as string;
    await http().post(`/v1/calls/${first}/accept`).set(a.auth).expect(404); // the caller can't answer
    await http().post(`/v1/calls/${first}/accept`).set(c.auth).expect(404);
    await http().get(`/v1/calls/${first}`).set(c.auth).expect(404);

    // b is being rung by a: c gets busy.
    const busy = await ring(c, cb, 'voice').expect(409);
    expect(busy.body.error).toMatchObject({ code: 'CALLEE_BUSY', details: { reason: 'callee_busy' } });

    // a redials: the first ring is replaced, not stacked.
    const second = (await ring(a, ab, 'voice').expect(201)).body.call.id as string;
    expect((await http().get(`/v1/calls/${first}`).set(a.auth)).body.call).toMatchObject({
      status: 'cancelled',
      end_reason: 'superseded',
    });
    expect((await http().get('/v1/calls/current').set(b.auth)).body.call.id).toBe(second);

    const declined = await http().post(`/v1/calls/${second}/decline`).set(b.auth).expect(200);
    expect(declined.body.call).toMatchObject({ status: 'declined', end_reason: 'declined' });
    expect((await aSocket.next('call:decline')).data).toMatchObject({ call: { id: second, status: 'declined' } });
    expect((await http().get('/v1/calls/current').set(b.auth)).body.call).toBeNull();
    await ring(c, cb, 'voice').expect(201); // b is free again
  });

  it('unmatching or a block ends a live call at once', async () => {
    const h = await host();
    const fan = await member();
    const matchId = await makeMatch(fan, h);
    await credit(fan, 300);
    const fanSocket = await connect(fan);
    const { body } = await ring(fan, matchId, 'video').expect(201);
    await http().post(`/v1/calls/${body.call.id}/accept`).set(h.auth).expect(200);

    await http().post('/v1/safety/blocks').set(h.auth).send({ user_id: fan.id }).expect(204);
    const end = await fanSocket.next('call:end');
    expect(end.data).toMatchObject({ call: { status: 'ended', end_reason: 'unmatched' } });
    expect((await calls.tick(later(5 * MINUTE_MS))).charged).toBe(0);
    expect((await balance(fan)).balance).toBe(240); // one minute only
  });

  it('LiveKit webhooks: a signed "participant left" ends the call; bad signatures are refused', async () => {
    const a = await member();
    const b = await member();
    const matchId = await makeMatch(a, b);
    const { body } = await ring(a, matchId, 'voice').expect(201);
    await http().post(`/v1/calls/${body.call.id}/accept`).set(b.auth).expect(200);

    const event = JSON.stringify({ kind: 'participant_left', room: roomName(body.call.id), identity: b.id });
    await http()
      .post('/v1/calls/livekit/webhook')
      .set('Content-Type', 'application/webhook+json')
      .set('Authorization', 'forged')
      .send(event)
      .expect(401);
    expect((await http().get(`/v1/calls/${body.call.id}`).set(a.auth)).body.call.status).toBe('active');
    await http()
      .post('/v1/calls/livekit/webhook')
      .set('Content-Type', 'application/webhook+json')
      .set('Authorization', 'good')
      .send(event)
      .expect(200);
    expect((await http().get(`/v1/calls/${body.call.id}`).set(a.auth)).body.call).toMatchObject({
      status: 'ended',
      end_reason: 'disconnected',
    });
  });
});
