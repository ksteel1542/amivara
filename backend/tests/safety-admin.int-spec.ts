import type { AddressInfo } from 'node:net';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import WebSocket from 'ws';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { OTP_SENDER } from '../src/modules/auth/otp-sender';
import { MEDIA_STORAGE } from '../src/modules/media/media-storage';
import { WARNING_NOTIFICATION } from '../src/modules/notifications/notifications.service';
import {
  PUSH_SENDER,
  type PushMessage,
  type PushSender,
  type SendResult,
} from '../src/modules/notifications/push-sender';
import { GeoRepository } from '../src/modules/profiles/geo.repository';
import { PrismaService } from '../src/prisma/prisma.service';
import { CapturingSender, createMemberDetailed, FakeMediaStorage } from './support/members';

class FakePushSender implements PushSender {
  readonly enabled = true;
  readonly sent: Array<{ token: string; message: PushMessage }> = [];
  async send(token: string, message: PushMessage): Promise<SendResult> {
    this.sent.push({ token, message });
    return 'sent';
  }
}

const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const LAGOS = { lat: 6.5244, lng: 3.3792 };

/**
 * Stage 5 integration tests: blocks (discovery/like exclusion, the match is
 * archived and open chats close), reports (immutable encrypted evidence,
 * auto-block, underage auto-suspension) and the admin moderation API
 * (queue, evidence, warn / suspend / ban / unban, audit log, staff-only).
 */
describe('Safety and moderation (integration, PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let wsUrl: string;
  const otp = new CapturingSender();
  const push = new FakePushSender();
  const sockets: WebSocket[] = [];

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
    await prisma.$executeRaw`TRUNCATE users, otp_challenges, signup_blocks, audit_log RESTART IDENTITY CASCADE`;
  });

  afterEach(async () => {
    for (const s of sockets.splice(0)) s.terminate();
    await settle(50);
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  interface Member {
    id: string;
    token: string;
    phone: string;
    device: string;
    auth: { Authorization: string };
  }

  async function member(opts: { verified?: boolean; role?: 'MODERATOR' } = {}): Promise<Member> {
    const { token, phone, device } = await createMemberDetailed(app, otp);
    const auth = { Authorization: `Bearer ${token}` };
    const me = await http().get('/v1/me').set(auth).expect(200);
    await prisma.user.update({
      where: { id: me.body.id },
      data: { ageVerified: opts.verified ?? true, role: opts.role ?? 'MEMBER' },
    });
    return { id: me.body.id, token, phone, device, auth };
  }

  async function makeMatch(a: Member, b: Member): Promise<string> {
    await http().post('/v1/matching/likes').set(b.auth).send({ user_id: a.id }).expect(201);
    const res = await http().post('/v1/matching/likes').set(a.auth).send({ user_id: b.id }).expect(201);
    return res.body.match_id;
  }

  async function chat(m: Member, matchId: string, body: string) {
    await http().post(`/v1/matches/${matchId}/messages`).set(m.auth).send({ body }).expect(201);
  }

  /** Opens a chat socket; resolves once the server has authenticated it. */
  async function socket(m: Member): Promise<{ ws: WebSocket; events: string[]; closed: Promise<number> }> {
    const ws = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${m.token}` } });
    sockets.push(ws);
    const events: string[] = [];
    ws.on('message', (raw) => events.push((JSON.parse(raw.toString()) as { event: string }).event));
    const closed = new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    await settle();
    return { ws, events, closed };
  }

  /** Both members in Lagos with a photo, so they'd normally see each other in discovery. */
  async function discoverable(m: Member, gender: 'MAN' | 'WOMAN', interestedIn: 'MAN' | 'WOMAN') {
    await prisma.profile.update({ where: { userId: m.id }, data: { gender } });
    await prisma.preference.update({ where: { userId: m.id }, data: { interestedIn: [interestedIn] } });
    await prisma.profilePhoto.create({
      data: {
        userId: m.id,
        storageKey: `photos/${m.id}/0.jpg`,
        contentType: 'image/jpeg',
        status: 'UPLOADED',
        position: 0,
      },
    });
    await app.get(GeoRepository).setLocation(m.id, LAGOS.lat, LAGOS.lng);
  }

  const feedIds = async (m: Member): Promise<string[]> =>
    (await http().get('/v1/discovery').set(m.auth).expect(200)).body.cards.map((c: { user_id: string }) => c.user_id);

  // ── Blocks ────────────────────────────────────────────────

  it('a block hides both members from each other in discovery and likes', async () => {
    const a = await member();
    const b = await member();
    await discoverable(a, 'WOMAN', 'MAN');
    await discoverable(b, 'MAN', 'WOMAN');
    expect(await feedIds(a)).toContain(b.id);
    expect(await feedIds(b)).toContain(a.id);

    await http().post('/v1/safety/blocks').set(a.auth).send({ user_id: b.id }).expect(204);
    expect(await feedIds(a)).not.toContain(b.id);
    expect(await feedIds(b)).not.toContain(a.id); // both directions
    await http().post('/v1/matching/likes').set(b.auth).send({ user_id: a.id }).expect(404);

    const list = await http().get('/v1/safety/blocks').set(a.auth).expect(200);
    expect(list.body.blocks).toEqual([expect.objectContaining({ user_id: b.id, first_name: 'Chidinma' })]);

    // Blocking twice is fine; unblocking restores discovery (not any match).
    await http().post('/v1/safety/blocks').set(a.auth).send({ user_id: b.id }).expect(204);
    await http().delete(`/v1/safety/blocks/${b.id}`).set(a.auth).expect(204);
    await http().delete(`/v1/safety/blocks/${b.id}`).set(a.auth).expect(404);
    expect(await feedIds(a)).toContain(b.id);
  });

  it('blocking archives the match and closes open chats on both sides', async () => {
    const a = await member();
    const b = await member();
    const matchId = await makeMatch(a, b);
    await chat(a, matchId, 'hello');
    const sa = await socket(a);
    const sb = await socket(b);

    await http().post('/v1/safety/blocks').set(a.auth).send({ user_id: b.id }).expect(204);
    await settle();
    expect(sa.events).toContain('match.removed');
    expect(sb.events).toContain('match.removed');

    const match = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(match.unmatchedAt).not.toBeNull();
    expect(match.unmatchedById).toBe(a.id);
    await http().post(`/v1/matches/${matchId}/messages`).set(b.auth).send({ body: 'hey?' }).expect(404);
    expect((await http().get('/v1/matches').set(b.auth).expect(200)).body.matches).toEqual([]);

    // Unblocking does not bring the match back.
    await http().delete(`/v1/safety/blocks/${b.id}`).set(a.auth).expect(204);
    await http().post(`/v1/matches/${matchId}/messages`).set(a.auth).send({ body: 'hi again' }).expect(404);
  });

  it('validates blocks', async () => {
    const a = await member({ verified: false }); // blocking is open to everyone
    await http().post('/v1/safety/blocks').set(a.auth).send({ user_id: a.id }).expect(400);
    await http()
      .post('/v1/safety/blocks')
      .set(a.auth)
      .send({ user_id: '00000000-0000-4000-8000-0000000000ff' })
      .expect(404);
    await http().post('/v1/safety/blocks').send({ user_id: a.id }).expect(401);
  });

  // ── Reports ───────────────────────────────────────────────

  it('files a report with an encrypted, immutable evidence snapshot and blocks', async () => {
    const reporter = await member();
    const reported = await member();
    const matchId = await makeMatch(reporter, reported);
    await chat(reporter, matchId, 'Hi!');
    await chat(reported, matchId, 'Send me ₦50,000 for transport');
    const pointed = await prisma.message.findFirstOrThrow({ where: { senderId: reported.id } });

    const res = await http()
      .post('/v1/safety/reports')
      .set(reporter.auth)
      .send({ user_id: reported.id, category: 'scam', details: 'Asked for money', message_id: pointed.id })
      .expect(201);
    expect(res.body.priority).toBe('high');

    const row = await prisma.report.findUniqueOrThrow({ where: { id: res.body.report_id } });
    expect(row).toMatchObject({ category: 'SCAM', status: 'OPEN', priority: 'HIGH', matchId, messageId: pointed.id });
    expect(row.evidence).toMatch(/^v1:/);
    expect(row.evidence).not.toContain('50,000');

    // The database refuses to change the evidence.
    await expect(prisma.report.update({ where: { id: row.id }, data: { evidence: 'v1:tampered' } })).rejects.toThrow(
      /immutable/,
    );

    // Reporting also blocked and archived the match.
    expect(await prisma.block.count({ where: { blockerId: reporter.id, blockedId: reported.id } })).toBe(1);
    expect((await prisma.match.findUniqueOrThrow({ where: { id: matchId } })).unmatchedAt).not.toBeNull();
    // The evidence survives the conversation being deleted later.
    await prisma.message.updateMany({ where: { matchId }, data: { deletedAt: new Date() } });

    const mod = await member({ role: 'MODERATOR' });
    const detail = await http().get(`/v1/admin/reports/${row.id}`).set(mod.auth).expect(200);
    expect(detail.body.evidence.messages.map((m: { from: string; body: string }) => [m.from, m.body])).toEqual([
      ['reporter', 'Hi!'],
      ['reported', 'Send me ₦50,000 for transport'],
    ]);
    expect(detail.body.evidence.profile).toMatchObject({ first_name: 'Chidinma', age: 27, verified: true });
    expect(detail.body).toMatchObject({ category: 'scam', details: 'Asked for money', message_id: pointed.id });
  });

  it('an underage report suspends the reported member at once and is critical', async () => {
    const reporter = await member();
    const reported = await member();
    const matchId = await makeMatch(reporter, reported);
    const sr = await socket(reported);

    const res = await http()
      .post('/v1/safety/reports')
      .set(reporter.auth)
      .send({ user_id: reported.id, category: 'underage', details: 'Said she is 16' })
      .expect(201);
    expect(res.body.priority).toBe('critical');
    expect(await sr.closed).toBe(4403);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: reported.id } });
    expect(user.status).toBe('SUSPENDED');
    expect(user.suspendedUntil).toBeNull(); // until reviewed
    const action = await prisma.enforcementAction.findFirstOrThrow({ where: { userId: reported.id } });
    expect(action).toMatchObject({ action: 'SUSPEND', actorId: null });

    // Suspended: can't like or chat; hidden from everyone.
    const like = await http().post('/v1/matching/likes').set(reported.auth).send({ user_id: reporter.id }).expect(403);
    expect(like.body.error.code).toBe('ACCOUNT_SUSPENDED');
    await http().get(`/v1/matches/${matchId}/messages`).set(reported.auth).expect(403);

    // Critical reports lead the queue.
    const other = await member();
    await http()
      .post('/v1/safety/reports')
      .set(other.auth)
      .send({ user_id: reporter.id, category: 'other' })
      .expect(201);
    const mod = await member({ role: 'MODERATOR' });
    const queue = await http().get('/v1/admin/reports').set(mod.auth).expect(200);
    expect(queue.body.reports.map((r: { priority: string }) => r.priority)).toEqual(['critical', 'normal']);
    expect(queue.body.counts).toEqual({ critical: 1, high: 0, normal: 1 });
    expect(queue.body.reports[0].reported).toMatchObject({
      user_id: reported.id,
      status: 'suspended',
      open_reports: 1,
    });
  });

  it('validates reports and limits report-bombing', async () => {
    const a = await member({ verified: false });
    const b = await member();
    await http().post('/v1/safety/reports').set(a.auth).send({ user_id: b.id, category: 'rude' }).expect(400);
    await http().post('/v1/safety/reports').set(a.auth).send({ user_id: a.id, category: 'other' }).expect(400);
    await http()
      .post('/v1/safety/reports')
      .set(a.auth)
      .send({ user_id: b.id, category: 'other', message_id: '00000000-0000-4000-8000-0000000000ff' })
      .expect(400);
    await http()
      .post('/v1/safety/reports')
      .set(a.auth)
      .send({ user_id: b.id, category: 'other', details: 'x'.repeat(1001) })
      .expect(400);

    for (let i = 0; i < 20; i++) {
      await http().post('/v1/safety/reports').set(a.auth).send({ user_id: b.id, category: 'other' }).expect(201);
    }
    const res = await http()
      .post('/v1/safety/reports')
      .set(a.auth)
      .send({ user_id: b.id, category: 'other' })
      .expect(429);
    expect(res.body.error.code).toBe('REPORT_RATE_LIMITED');
  });

  // ── Admin moderation ──────────────────────────────────────

  it('the admin API is invisible to members', async () => {
    const a = await member();
    await http().get('/v1/admin/reports').set(a.auth).expect(404);
    await http().post(`/v1/admin/users/${a.id}/ban`).set(a.auth).send({ reason: 'nope' }).expect(404);
    await http().get('/v1/admin/reports').expect(401);
    const mod = await member({ role: 'MODERATOR' });
    expect((await http().get('/v1/admin/me').set(mod.auth).expect(200)).body).toMatchObject({ role: 'moderator' });
  });

  it('dismisses and warns, resolving the report and writing the audit log', async () => {
    const reporter = await member();
    const reported = await member();
    const mod = await member({ role: 'MODERATOR' });
    await http()
      .post('/v1/notifications/tokens')
      .set(reported.auth)
      .send({ token: `fcm-token-reported-${'x'.repeat(30)}`, platform: 'android' })
      .expect(204);
    const r1 = (
      await http()
        .post('/v1/safety/reports')
        .set(reporter.auth)
        .send({ user_id: reported.id, category: 'other' })
        .expect(201)
    ).body.report_id;
    const r2 = (
      await http()
        .post('/v1/safety/reports')
        .set(reporter.auth)
        .send({ user_id: reported.id, category: 'harassment' })
        .expect(201)
    ).body.report_id;

    await http().post(`/v1/admin/reports/${r1}/dismiss`).set(mod.auth).send({ note: 'Not a violation' }).expect(204);
    await http().post(`/v1/admin/reports/${r1}/dismiss`).set(mod.auth).send({}).expect(409);

    push.sent.length = 0;
    await http()
      .post(`/v1/admin/users/${reported.id}/warn`)
      .set(mod.auth)
      .send({ reason: 'Rude messages', report_id: r2 })
      .expect(204);
    await settle();
    expect(push.sent.map((p) => p.message.notification)).toEqual([WARNING_NOTIFICATION]);

    const reports = await prisma.report.findMany({ orderBy: { createdAt: 'asc' } });
    expect(reports.map((r) => [r.status, r.resolvedById])).toEqual([
      ['DISMISSED', mod.id],
      ['ACTIONED', mod.id],
    ]);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: reported.id } })).status).toBe('ACTIVE');

    await http().get(`/v1/admin/reports/${r2}`).set(mod.auth).expect(200);
    const audit = await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
    expect(audit.map((e) => e.action)).toEqual(['report.dismiss', 'user.warn', 'report.view']);
    expect(audit.every((e) => e.actorId === mod.id)).toBe(true);
    await expect(prisma.auditLog.deleteMany()).rejects.toThrow(/append-only/);

    const resolved = await http().get('/v1/admin/reports?status=actioned').set(mod.auth).expect(200);
    expect(resolved.body.reports.map((r: { id: string }) => r.id)).toEqual([r2]);
  });

  it('a temporary suspension blocks gated actions and lifts itself', async () => {
    const a = await member();
    const b = await member();
    const mod = await member({ role: 'MODERATOR' });
    await http()
      .post(`/v1/admin/users/${a.id}/suspend`)
      .set(mod.auth)
      .send({ reason: 'Cooling off', days: 3 })
      .expect(204);
    await http().post(`/v1/admin/users/${a.id}/suspend`).set(mod.auth).send({ reason: 'x', days: 91 }).expect(400);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: a.id } });
    expect(user.status).toBe('SUSPENDED');
    expect(user.suspendedUntil!.getTime()).toBeGreaterThan(Date.now() + 2.9 * 86_400_000);
    await http().post('/v1/matching/likes').set(a.auth).send({ user_id: b.id }).expect(403);

    // Time passes: the next request finds the suspension over.
    await prisma.user.update({ where: { id: a.id }, data: { suspendedUntil: new Date(Date.now() - 1000) } });
    await http().post('/v1/matching/likes').set(a.auth).send({ user_id: b.id }).expect(201);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('ACTIVE');
  });

  it('a ban revokes sessions, closes sockets and blacklists the phone and device; unban restores', async () => {
    const bad = await member();
    const reporter = await member();
    const mod = await member({ role: 'MODERATOR' });
    const report = (
      await http().post('/v1/safety/reports').set(reporter.auth).send({ user_id: bad.id, category: 'scam' }).expect(201)
    ).body.report_id;
    const sb = await socket(bad);

    await http()
      .post(`/v1/admin/users/${bad.id}/ban`)
      .set(mod.auth)
      .send({ reason: 'Romance scam', report_id: report })
      .expect(204);
    expect(await sb.closed).toBe(4403);

    // Every session is gone.
    const me = await http().get('/v1/me').set(bad.auth);
    expect([401, 403]).toContain(me.status);
    expect(await prisma.deviceSession.count({ where: { userId: bad.id, revokedAt: null } })).toBe(0);
    expect((await prisma.report.findUniqueOrThrow({ where: { id: report } })).status).toBe('ACTIONED');

    // Signing in again with the banned phone is refused.
    await prisma.otpChallenge.deleteMany(); // skip the resend cooldown from signup
    const again = await http()
      .post('/v1/auth/otp/request')
      .set('X-Device-Id', bad.device)
      .send({ phone: bad.phone })
      .expect(202);
    const signIn = await http()
      .post('/v1/auth/otp/verify')
      .set('X-Device-Id', bad.device)
      .send({ challenge_id: again.body.challenge_id, code: otp.lastCode() })
      .expect(403);
    expect(signIn.body.error.code).toBe('ACCOUNT_SUSPENDED');

    // A new number on the same phone can't sign up either.
    const fresh = await http()
      .post('/v1/auth/otp/request')
      .set('X-Device-Id', bad.device)
      .send({ phone: '08039999999' })
      .expect(202);
    const signup = await http()
      .post('/v1/auth/otp/verify')
      .set('X-Device-Id', bad.device)
      .send({ challenge_id: fresh.body.challenge_id, code: otp.lastCode() })
      .expect(403);
    expect(signup.body.error.code).toBe('SIGNUP_BLOCKED');
    expect(await prisma.signupBlock.count({ where: { reason: 'BANNED' } })).toBe(2); // phone + device

    // Unban: active again, blacklist lifted.
    await http().post(`/v1/admin/users/${bad.id}/unban`).set(mod.auth).send({ reason: 'Appeal upheld' }).expect(204);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: bad.id } })).status).toBe('ACTIVE');
    expect(await prisma.signupBlock.count({ where: { reason: 'BANNED' } })).toBe(0);
    await http().post(`/v1/admin/users/${bad.id}/unban`).set(mod.auth).send({ reason: 'again' }).expect(409);

    const history = await prisma.enforcementAction.findMany({
      where: { userId: bad.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(history.map((h) => h.action)).toEqual(['BAN', 'UNBAN']);
  });

  it('staff accounts and self-actions are refused', async () => {
    const mod = await member({ role: 'MODERATOR' });
    const other = await member({ role: 'MODERATOR' });
    await http().post(`/v1/admin/users/${mod.id}/ban`).set(mod.auth).send({ reason: 'test' }).expect(403);
    await http().post(`/v1/admin/users/${other.id}/ban`).set(mod.auth).send({ reason: 'test' }).expect(403);
    await http()
      .post('/v1/admin/users/00000000-0000-4000-8000-0000000000ff/ban')
      .set(mod.auth)
      .send({ reason: 'test' })
      .expect(404);
  });
});
