import type { AddressInfo } from 'node:net';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import WebSocket from 'ws';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { OTP_SENDER } from '../src/modules/auth/otp-sender';
import { MEDIA_STORAGE } from '../src/modules/media/media-storage';
import { GeoRepository } from '../src/modules/profiles/geo.repository';
import { AccountService } from '../src/modules/users/account.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CapturingSender, createMemberDetailed, FakeMediaStorage } from './support/members';

const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const LAGOS = { lat: 6.5244, lng: 3.3792 };
const DAY = 24 * 60 * 60 * 1000;

/**
 * Sprint 8 integration tests: pause and incognito (discovery exclusions),
 * device sessions (list, revoke one, sign out the others, sockets close),
 * the NDPA data export, and account deletion (immediate effects, restore by
 * signing back in, the 30-day purge and its cascades).
 */
describe('Account controls, export and deletion (integration, PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let wsUrl: string;
  const otp = new CapturingSender();
  const storage = new FakeMediaStorage();
  const sockets: WebSocket[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OTP_SENDER)
      .useValue(otp)
      .overrideProvider(MEDIA_STORAGE)
      .useValue(storage)
      .compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    const { port } = app.getHttpServer().address() as AddressInfo;
    wsUrl = `ws://127.0.0.1:${port}/ws/chat`;
  });

  beforeEach(async () => {
    storage.deleted.length = 0;
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

  async function member(verified = true): Promise<Member> {
    const { token, phone, device } = await createMemberDetailed(app, otp);
    const auth = { Authorization: `Bearer ${token}` };
    const me = await http().get('/v1/me').set(auth).expect(200);
    if (verified) await prisma.user.update({ where: { id: me.body.id }, data: { ageVerified: true } });
    return { id: me.body.id, token, phone, device, auth };
  }

  /** Signs the same member in on another phone. Returns that device's access token. */
  async function signInElsewhere(m: Member, device: string): Promise<string> {
    await prisma.otpChallenge.deleteMany(); // skip the resend cooldown
    const ch = await http()
      .post('/v1/auth/otp/request')
      .set('X-Device-Id', device)
      .send({ phone: m.phone })
      .expect(202);
    const res = await http()
      .post('/v1/auth/otp/verify')
      .set('X-Device-Id', device)
      .send({ challenge_id: ch.body.challenge_id, code: otp.lastCode() })
      .expect(200);
    expect(res.body.status).toBe('signed_in');
    return res.body.access_token;
  }

  /** Both in Lagos with a photo, so they'd normally see each other in discovery. */
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

  async function makeMatch(a: Member, b: Member): Promise<string> {
    await http().post('/v1/matching/likes').set(b.auth).send({ user_id: a.id }).expect(201);
    const res = await http().post('/v1/matching/likes').set(a.auth).send({ user_id: b.id }).expect(201);
    return res.body.match_id;
  }

  function socket(token: string): Promise<{ ws: WebSocket; events: string[]; closed: Promise<number> }> {
    const ws = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${token}` } });
    sockets.push(ws);
    const events: string[] = [];
    ws.on('message', (raw) => events.push((JSON.parse(raw.toString()) as { event: string }).event));
    const closed = new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));
    return new Promise((resolve, reject) => {
      ws.once('open', () => void settle().then(() => resolve({ ws, events, closed })));
      ws.once('error', reject);
    });
  }

  // ── Pause & incognito ─────────────────────────────────────

  it('pausing hides the member from discovery but keeps matches and chat working', async () => {
    const a = await member();
    const b = await member();
    const c = await member();
    await discoverable(a, 'WOMAN', 'MAN');
    await discoverable(b, 'MAN', 'WOMAN');
    await discoverable(c, 'MAN', 'WOMAN');
    const matchId = await makeMatch(a, c);

    expect(await http().get('/v1/users/me/settings').set(a.auth).expect(200)).toHaveProperty('body', {
      paused: false,
      incognito: false,
    });
    expect(await feedIds(b)).toContain(a.id);

    const paused = await http().patch('/v1/users/me/settings').set(a.auth).send({ paused: true }).expect(200);
    expect(paused.body).toEqual({ paused: true, incognito: false });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('PAUSED');
    expect(await feedIds(b)).not.toContain(a.id);
    // Can't be liked while paused.
    await http().post('/v1/matching/likes').set(b.auth).send({ user_id: a.id }).expect(404);

    // The existing match and chat carry on, both ways.
    await http().post(`/v1/matches/${matchId}/messages`).set(a.auth).send({ body: 'Still here' }).expect(201);
    await http().post(`/v1/matches/${matchId}/messages`).set(c.auth).send({ body: 'Great' }).expect(201);
    expect((await http().get('/v1/matches').set(c.auth).expect(200)).body.matches).toHaveLength(1);

    await http().patch('/v1/users/me/settings').set(a.auth).send({ paused: false }).expect(200);
    expect(await feedIds(b)).toContain(a.id);
  });

  it('validates settings, and a suspended member cannot unpause themselves', async () => {
    const a = await member();
    await http().patch('/v1/users/me/settings').set(a.auth).send({}).expect(400);
    await http().patch('/v1/users/me/settings').set(a.auth).send({ paused: 'yes' }).expect(400);
    await http().patch('/v1/users/me/settings').set(a.auth).send({ hidden: true }).expect(400);

    await prisma.user.update({ where: { id: a.id }, data: { status: 'SUSPENDED' } });
    const res = await http().patch('/v1/users/me/settings').set(a.auth).send({ paused: false }).expect(403);
    expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('SUSPENDED');
  });

  it('incognito: visible only to people you have liked', async () => {
    const a = await member();
    const b = await member();
    const c = await member();
    await discoverable(a, 'WOMAN', 'MAN');
    await discoverable(b, 'MAN', 'WOMAN');
    await discoverable(c, 'MAN', 'WOMAN');

    await http().patch('/v1/users/me/settings').set(a.auth).send({ incognito: true }).expect(200);
    expect(await feedIds(b)).not.toContain(a.id);
    expect(await feedIds(c)).not.toContain(a.id);

    await http().post('/v1/matching/likes').set(a.auth).send({ user_id: b.id }).expect(201);
    expect(await feedIds(b)).toContain(a.id); // liked: B can see A
    expect(await feedIds(c)).not.toContain(a.id);

    const unverified = await member(false);
    const res = await http().patch('/v1/users/me/settings').set(unverified.auth).send({ incognito: true }).expect(403);
    expect(res.body.error.code).toBe('VERIFICATION_REQUIRED');
  });

  // ── Sessions ──────────────────────────────────────────────

  it('lists device sessions and revokes one; its socket closes', async () => {
    const a = await member();
    const other = await signInElsewhere(a, 'second-phone-0001');
    const otherSocket = await socket(other);
    const mySocket = await socket(a.token);

    const list = await http().get('/v1/auth/sessions').set(a.auth).expect(200);
    expect(list.body.sessions).toHaveLength(2);
    const current = list.body.sessions.find((s: { current: boolean }) => s.current);
    const remote = list.body.sessions.find((s: { current: boolean }) => !s.current);
    expect(current).toBeDefined();

    await http().delete(`/v1/auth/sessions/${remote.id}`).set(a.auth).expect(204);
    expect(await otherSocket.closed).toBe(4401);
    await http()
      .get('/v1/me')
      .set({ Authorization: `Bearer ${other}` })
      .expect(401);
    await http().get('/v1/me').set(a.auth).expect(200);
    expect(mySocket.ws.readyState).toBe(WebSocket.OPEN);
    await http().delete(`/v1/auth/sessions/${remote.id}`).set(a.auth).expect(404);
  });

  it('signs out every other device at once', async () => {
    const a = await member();
    const t2 = await signInElsewhere(a, 'second-phone-0002');
    const t3 = await signInElsewhere(a, 'third-phone-0003');
    const res = await http().delete('/v1/auth/sessions').set(a.auth).expect(200);
    expect(res.body).toEqual({ revoked: 2 });
    await http()
      .get('/v1/me')
      .set({ Authorization: `Bearer ${t2}` })
      .expect(401);
    await http()
      .get('/v1/me')
      .set({ Authorization: `Bearer ${t3}` })
      .expect(401);
    await http().get('/v1/me').set(a.auth).expect(200);
    expect((await http().get('/v1/auth/sessions').set(a.auth).expect(200)).body.sessions).toHaveLength(1);
  });

  // ── Export ────────────────────────────────────────────────

  it('exports the member’s data as a JSON download, with only their own messages', async () => {
    const a = await member();
    const b = await member();
    await discoverable(a, 'WOMAN', 'MAN');
    const matchId = await makeMatch(a, b);
    await http().post(`/v1/matches/${matchId}/messages`).set(a.auth).send({ body: 'Ẹ kú àárọ̀' }).expect(201);
    await http().post(`/v1/matches/${matchId}/messages`).set(b.auth).send({ body: 'Private reply from B' }).expect(201);
    await prisma.verification.create({
      data: { userId: a.id, type: 'BIOMETRIC_KYC', status: 'PASSED', idType: 'NIN', completedAt: new Date() },
    });

    const res = await http().get('/v1/users/me/export').set(a.auth).expect(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="amivara-data-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(res.headers['cache-control']).toBe('no-store');
    const data = res.body;
    expect(data.format).toBe('amivara-export/1');
    expect(data.account).toMatchObject({ id: a.id, phone: expect.stringMatching(/^\+234/), age_verified: true });
    expect(data.profile).toMatchObject({ first_name: 'Chidinma', gender: 'woman' });
    expect(data.profile.location).toEqual({ latitude: 6.524, longitude: 3.379 }); // the rounded point on file
    expect(data.profile.photos).toHaveLength(1);
    expect(data.verifications).toEqual([
      expect.objectContaining({
        type: 'biometric_kyc',
        status: 'passed',
        id_type: 'NIN',
        completed_at: expect.any(String),
      }),
    ]);
    expect(data.likes_sent).toEqual([expect.objectContaining({ user_id: b.id })]);
    expect(data.matches).toHaveLength(1);
    expect(data.matches[0]).toMatchObject({ match_id: matchId, with: { user_id: b.id, first_name: 'Chidinma' } });
    expect(data.matches[0].messages_sent.map((m: { body: string }) => m.body)).toEqual(['Ẹ kú àárọ̀']);
    expect(JSON.stringify(data)).not.toContain('Private reply from B');
    expect(data.devices).toHaveLength(1);
    await http().get('/v1/users/me/export').expect(401);
  });

  // ── Deletion ──────────────────────────────────────────────

  it('deleting signs out everywhere, scrubs location, archives matches and leaves discovery', async () => {
    const a = await member();
    const b = await member();
    const c = await member();
    await discoverable(a, 'WOMAN', 'MAN');
    await discoverable(b, 'MAN', 'WOMAN');
    await discoverable(c, 'MAN', 'WOMAN');
    const matchId = await makeMatch(a, b);
    const mine = await socket(a.token);
    const theirs = await socket(b.token);
    expect(await feedIds(c)).toContain(a.id);

    const res = await http().delete('/v1/users/me').set(a.auth).expect(202);
    expect(new Date(res.body.purge_after).getTime()).toBeGreaterThan(Date.now() + 29 * DAY);

    expect(await mine.closed).toBe(4401);
    await settle();
    expect(theirs.events).toContain('match.removed');
    await http().get('/v1/me').set(a.auth).expect(401);
    expect(await prisma.deviceSession.count({ where: { userId: a.id, revokedAt: null } })).toBe(0);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: a.id } });
    expect(user.status).toBe('PENDING_DELETION');
    expect(user.deletedAt).not.toBeNull();
    const [loc] = await prisma.$queryRaw<Array<{ has: boolean; geohash5: string | null }>>`
      SELECT location IS NOT NULL AS has, geohash5 FROM profiles WHERE user_id = ${a.id}::uuid`;
    expect(loc).toEqual({ has: false, geohash5: null });
    expect((await prisma.match.findUniqueOrThrow({ where: { id: matchId } })).unmatchedAt).not.toBeNull();
    expect((await http().get('/v1/matches').set(b.auth).expect(200)).body.matches).toEqual([]);
    expect(await feedIds(c)).not.toContain(a.id);
  });

  it('signing back in within 30 days restores the account', async () => {
    const a = await member();
    await http().delete('/v1/users/me').set(a.auth).expect(202);

    await prisma.otpChallenge.deleteMany();
    const ch = await http()
      .post('/v1/auth/otp/request')
      .set('X-Device-Id', a.device)
      .send({ phone: a.phone })
      .expect(202);
    const res = await http()
      .post('/v1/auth/otp/verify')
      .set('X-Device-Id', a.device)
      .send({ challenge_id: ch.body.challenge_id, code: otp.lastCode() })
      .expect(200);
    expect(res.body).toMatchObject({ status: 'signed_in', restored: true });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: a.id } });
    expect(user).toMatchObject({ status: 'ACTIVE', deletedAt: null });
    await http()
      .get('/v1/me')
      .set({ Authorization: `Bearer ${res.body.access_token}` })
      .expect(200);
  });

  it('after 30 days the purge erases the account and everything that cascades from it', async () => {
    const a = await member();
    const b = await member();
    await discoverable(a, 'WOMAN', 'MAN');
    const matchId = await makeMatch(a, b);
    await http().post(`/v1/matches/${matchId}/messages`).set(a.auth).send({ body: 'bye' }).expect(201);
    await http().post('/v1/safety/reports').set(b.auth).send({ user_id: a.id, category: 'other' }).expect(201);
    await http().delete('/v1/users/me').set(a.auth).expect(202);

    const accounts = app.get(AccountService);
    expect(await accounts.purgeDue()).toBe(0); // still inside the 30 days

    await prisma.user.update({ where: { id: a.id }, data: { deletedAt: new Date(Date.now() - 31 * DAY) } });
    expect(await accounts.purgeDue()).toBe(1);

    expect(await prisma.user.findUnique({ where: { id: a.id } })).toBeNull();
    expect(await prisma.profile.count({ where: { userId: a.id } })).toBe(0);
    expect(await prisma.profilePhoto.count({ where: { userId: a.id } })).toBe(0);
    expect(await prisma.deviceSession.count({ where: { userId: a.id } })).toBe(0);
    expect(await prisma.match.count({ where: { id: matchId } })).toBe(0);
    expect(await prisma.message.count({ where: { senderId: a.id } })).toBe(0);
    expect(await prisma.like.count({ where: { OR: [{ likerId: a.id }, { likeeId: a.id }] } })).toBe(0);
    expect(storage.deleted).toEqual([`photos/${a.id}/0.jpg`]);
    // The other member is untouched.
    await http().get('/v1/me').set(b.auth).expect(200);
  });
});
