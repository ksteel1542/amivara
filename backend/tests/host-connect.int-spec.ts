import type { AddressInfo } from 'node:net';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import WebSocket from 'ws';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { OTP_SENDER } from '../src/modules/auth/otp-sender';
import { CALL_MEDIA, type CallMediaProvider, type MediaEvent } from '../src/modules/calls/call-media';
import { CallsService } from '../src/modules/calls/calls.service';
import { MEDIA_STORAGE } from '../src/modules/media/media-storage';
import { UNVERIFIED_DAILY_MESSAGES } from '../src/modules/messaging/messaging.service';
import { WalletService } from '../src/modules/wallet/wallet.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CapturingSender, createMember, FakeMediaStorage } from './support/members';

class FakeMedia implements CallMediaProvider {
  configured = true;
  async openRoom() {}
  async joinToken(input: { identity: string }) {
    return { url: 'wss://lk.test', token: `t-${input.identity}` };
  }
  async closeRoom() {}
  async setPublish() {}
  async removeParticipant() {}
  async parseWebhook(): Promise<MediaEvent> {
    throw new Error('unused');
  }
}

const settle = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Lower-friction connections (17 Nov 2026): unverified members chat and call
 * Verified Hosts (member-to-member calls still need NIN on both sides), open a
 * chat with a Host without a mutual like, get a 15-second free preview on
 * their first paid call (once per member and device), and online Hosts can
 * ring newcomers who accept invites (Quick Connect), the newcomer paying.
 */
describe('Host direct chat, free preview and Quick Connect (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let calls: CallsService;
  let wsUrl: string;
  const otp = new CapturingSender();
  const sockets: WebSocket[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OTP_SENDER)
      .useValue(otp)
      .overrideProvider(MEDIA_STORAGE)
      .useValue(new FakeMediaStorage())
      .overrideProvider(CALL_MEDIA)
      .useValue(new FakeMedia())
      .compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    calls = app.get(CallsService);
    const { port } = app.getHttpServer().address() as AddressInfo;
    wsUrl = `ws://127.0.0.1:${port}/ws/chat`;
  });

  beforeEach(async () => {
    Object.assign(calls, { previewSeconds: 15 });
    await prisma.$executeRaw`TRUNCATE users, otp_challenges, signup_blocks, audit_log, ledger_accounts, ledger_transactions, ledger_entries, promo_claims, host_profiles, host_earnings, call_sessions RESTART IDENTITY CASCADE`;
  });

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.close();
    await settle(80);
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
      data: { ageVerified: opts.verified ?? false, ...(opts.role ? { role: opts.role } : {}) },
    });
    return { id, token, auth };
  }

  async function host(): Promise<Member> {
    const h = await member({ verified: true });
    await http().post('/v1/me/host').set(h.auth).expect(200);
    return h;
  }

  /** Opens the chat socket: the member is "online". */
  async function online(m: Member): Promise<void> {
    const ws = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${m.token}` } });
    sockets.push(ws);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    await settle(150);
  }

  let adjustN = 0;
  async function credit(m: Member, coins: number) {
    const staff = await member({ role: 'MODERATOR', verified: true });
    await http()
      .post(`/v1/admin/users/${m.id}/coins`)
      .set(staff.auth)
      .send({ coins, wallet: 'paid', reason: 'Test credit', idempotency_key: `hc-adjust-${++adjustN}` })
      .expect(200);
  }

  const balance = (m: Member) => app.get(WalletService).balances(m.id);
  const later = (ms: number) => new Date(Date.now() + ms);
  const chatWith = async (m: Member, h: Member) =>
    (await http().post(`/v1/hosts/${h.id}/chat`).set(m.auth).expect(200)).body.match_id as string;

  it('registration needs the 18+ and Terms consent, and records when it was given', async () => {
    const m = await member();
    const me = await http().get('/v1/me').set(m.auth).expect(200);
    expect(me.body).toMatchObject({ terms_accepted: true, call_invites_enabled: true });
    expect(me.body.capabilities).toMatchObject({ host_chat: true, host_calls: true, voice_calls: false });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: m.id } });
    expect(row.acceptedTermsAt).toBeInstanceOf(Date);
  });

  it('members open a chat with an online Host directly; unverified members chat past the daily cap', async () => {
    const h = await host();
    const fan = await member(); // not NIN-verified
    await online(h);
    const list = await http().get('/v1/hosts/online').set(fan.auth).expect(200);
    expect(list.body.hosts).toEqual([
      expect.objectContaining({ user_id: h.id, online: true, voice_rate_per_minute: 30, video_rate_per_minute: 60 }),
    ]);

    const matchId = await chatWith(fan, h);
    expect(await chatWith(fan, h)).toBe(matchId); // the same conversation again
    const match = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(match.source).toBe('HOST_DIRECT');
    const matches = await http().get('/v1/matches').set(fan.auth).expect(200);
    expect(matches.body.matches[0]).toMatchObject({ match_id: matchId, direct: true, user: { user_id: h.id } });

    await credit(fan, 200);
    for (let i = 0; i < UNVERIFIED_DAILY_MESSAGES + 2; i++) {
      await http()
        .post(`/v1/matches/${matchId}/messages`)
        .set(fan.auth)
        .send({ body: `hello ${i}` })
        .expect(201);
    }

    // Only Hosts can be messaged without a match; blocks close it.
    const plain = await member();
    await http().post(`/v1/hosts/${plain.id}/chat`).set(fan.auth).expect(404);
    await http().post('/v1/safety/blocks').set(h.auth).send({ user_id: fan.id }).expect(204);
    await http().post(`/v1/hosts/${h.id}/chat`).set(fan.auth).expect(404);
    expect((await http().get('/v1/hosts/online').set(fan.auth)).body.hosts).toEqual([]);
  });

  it('unverified members call Hosts; member-to-member calls still need NIN on both sides', async () => {
    const h = await host();
    const fan = await member();
    const matchId = await chatWith(fan, h);
    const quote = await http().get(`/v1/matches/${matchId}/calls/quote`).set(fan.auth).expect(200);
    expect(quote.body).toMatchObject({ allowed: true, paid: true, you_pay: true, free_preview_seconds: 15 });
    await http().post(`/v1/matches/${matchId}/calls`).set(fan.auth).send({ type: 'voice' }).expect(201);

    const a = await member();
    const b = await member({ verified: true });
    await http().post('/v1/matching/likes').set(b.auth).send({ user_id: a.id }).expect(201);
    const ab = (await http().post('/v1/matching/likes').set(a.auth).send({ user_id: b.id }).expect(201)).body
      .match_id as string;
    expect((await http().get(`/v1/matches/${ab}/calls/quote`).set(a.auth)).body.allowed).toBe(false);
    const denied = await http().post(`/v1/matches/${ab}/calls`).set(a.auth).send({ type: 'voice' }).expect(403);
    expect(denied.body.error.code).toBe('VERIFICATION_REQUIRED');
  });

  it('first paid call: 15 free seconds even with 0 coins, then cut off with a top-up; once per member', async () => {
    const h = await host();
    const fan = await member();
    const matchId = await chatWith(fan, h);
    expect((await balance(fan)).balance).toBe(0);

    const started = await http().post(`/v1/matches/${matchId}/calls`).set(fan.auth).send({ type: 'video' }).expect(201);
    expect(started.body.call).toMatchObject({ you_pay: true, preview_seconds: 15, rate_per_minute: 60 });
    const accepted = await http().post(`/v1/calls/${started.body.call.id}/accept`).set(h.auth).expect(200);
    expect(accepted.body.call).toMatchObject({
      status: 'active',
      billed_minutes: 0,
      preview_seconds: 15,
      you_pay: false,
    });

    expect((await calls.tick(later(10_000))).cutOff).toBe(0); // still free
    expect((await calls.tick(later(16_000))).cutOff).toBe(1);
    const ended = await http().get(`/v1/calls/${started.body.call.id}`).set(fan.auth).expect(200);
    expect(ended.body.call).toMatchObject({ status: 'insufficient_coins', billed_minutes: 0, total_coins_billed: 0 });

    // The preview is used: the next call needs coins.
    const again = await http().post(`/v1/matches/${matchId}/calls`).set(fan.auth).send({ type: 'voice' }).expect(402);
    expect(again.body.error).toMatchObject({ code: 'INSUFFICIENT_COINS', details: { balance: 0, required: 30 } });
  });

  it('with coins, the first minute is charged when the preview ends; an unanswered call keeps the preview', async () => {
    const h = await host();
    const fan = await member();
    const matchId = await chatWith(fan, h);
    await credit(fan, 100);

    const declined = await http()
      .post(`/v1/matches/${matchId}/calls`)
      .set(fan.auth)
      .send({ type: 'voice' })
      .expect(201);
    expect(declined.body.call.preview_seconds).toBe(15);
    await http().post(`/v1/calls/${declined.body.call.id}/decline`).set(h.auth).expect(200);

    const call = await http().post(`/v1/matches/${matchId}/calls`).set(fan.auth).send({ type: 'voice' }).expect(201);
    expect(call.body.call.preview_seconds).toBe(15); // still theirs
    await http().post(`/v1/calls/${call.body.call.id}/accept`).set(h.auth).expect(200);
    expect((await balance(fan)).balance).toBe(100);
    expect((await calls.tick(later(16_000))).charged).toBe(1);
    expect((await balance(fan)).balance).toBe(70);
    expect((await calls.tick(later(16_000 + 61_000))).charged).toBe(1);
    expect((await balance(fan)).balance).toBe(40);
    expect((await http().get('/v1/me/host/earnings').set(h.auth)).body.pending_coins).toBe(30);
  });

  it('Quick Connect: Hosts see online newcomers who accept invites and ring them; the newcomer pays', async () => {
    const h = await host();
    const newcomer = await member();
    const shy = await member();
    await http().put('/v1/me/call-invites').set(shy.auth).send({ enabled: false }).expect(200);
    const veteran = await member();
    await prisma.user.update({ where: { id: veteran.id }, data: { createdAt: new Date(Date.now() - 30 * 864e5) } });
    for (const m of [h, newcomer, shy, veteran]) await online(m);

    await http().get('/v1/hosts/newcomers').set(newcomer.auth).expect(403); // Hosts only
    const list = await http().get('/v1/hosts/newcomers').set(h.auth).expect(200);
    expect(list.body.newcomers.map((n: { user_id: string }) => n.user_id)).toEqual([newcomer.id]);
    expect(list.body.newcomers[0]).toMatchObject({ invited_today: false });
    expect(
      (await http().post(`/v1/hosts/newcomers/${shy.id}/call`).set(h.auth).send({ type: 'voice' }).expect(403)).body
        .error.code,
    ).toBe('INVITES_OFF');

    const rung = await http()
      .post(`/v1/hosts/newcomers/${newcomer.id}/call`)
      .set(h.auth)
      .send({ type: 'video' })
      .expect(201);
    expect(rung.body.call).toMatchObject({ invite: true, you_pay: false, rate_per_minute: 60, preview_seconds: 0 });
    const asSeen = await http().get('/v1/calls/current').set(newcomer.auth).expect(200);
    expect(asSeen.body.call).toMatchObject({ role: 'callee', you_pay: true, invite: true });

    // The newcomer answers: their free preview starts, then they'd pay.
    const answered = await http().post(`/v1/calls/${rung.body.call.id}/accept`).set(newcomer.auth).expect(200);
    expect(answered.body.call).toMatchObject({ status: 'active', preview_seconds: 15, billed_minutes: 0 });
    await http().post(`/v1/calls/${rung.body.call.id}/end`).set(newcomer.auth).expect(200);

    const twice = await http()
      .post(`/v1/hosts/newcomers/${newcomer.id}/call`)
      .set(h.auth)
      .send({ type: 'voice' })
      .expect(429);
    expect(twice.body.error).toMatchObject({ code: 'INVITE_RATE_LIMITED', details: { reason: 'already_invited' } });
    expect((await http().get('/v1/hosts/newcomers').set(h.auth)).body.newcomers[0].invited_today).toBe(true);
  });

  it('a newcomer with no preview left and no coins is asked to top up when answering an invite', async () => {
    const h = await host();
    const newcomer = await member();
    await online(newcomer);
    await prisma.promoClaim.create({ data: { kind: 'call_preview', subject: 'used-elsewhere', userId: newcomer.id } });
    await prisma.callSession.create({
      data: {
        matchId: await chatWith(newcomer, h),
        callerId: newcomer.id,
        calleeId: h.id,
        type: 'VOICE',
        status: 'ENDED',
        ratePerMinute: 30,
        payerId: newcomer.id,
        previewSeconds: 15,
        ringExpiresAt: new Date(),
        startedAt: new Date(),
        endedAt: new Date(),
      },
    });
    const rung = await http()
      .post(`/v1/hosts/newcomers/${newcomer.id}/call`)
      .set(h.auth)
      .send({ type: 'voice' })
      .expect(201);
    const res = await http().post(`/v1/calls/${rung.body.call.id}/accept`).set(newcomer.auth).expect(402);
    expect(res.body.error).toMatchObject({ code: 'INSUFFICIENT_COINS', details: { balance: 0, required: 30 } });
  });
});
