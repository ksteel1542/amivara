import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { OTP_SENDER } from '../src/modules/auth/otp-sender';
import { MEDIA_STORAGE } from '../src/modules/media/media-storage';
import { MATCH_NOTIFICATION } from '../src/modules/notifications/notifications.service';
import {
  PUSH_SENDER,
  type PushMessage,
  type PushSender,
  type SendResult,
} from '../src/modules/notifications/push-sender';
import { PrismaService } from '../src/prisma/prisma.service';
import { CapturingSender, createMember, FakeMediaStorage } from './support/members';

/** Records pushes instead of calling FCM. Tokens in `dead` behave like uninstalled apps. */
class FakePushSender implements PushSender {
  readonly enabled = true;
  readonly sent: Array<{ token: string; message: PushMessage }> = [];
  readonly dead = new Set<string>();
  async send(token: string, message: PushMessage): Promise<SendResult> {
    if (this.dead.has(token)) return 'unregistered';
    this.sent.push({ token, message });
    return 'sent';
  }
}

/** Domain-event listeners run asynchronously after the request. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
const fcmToken = (name: string) => `fcm-token-${name}-${'x'.repeat(40)}`;

/**
 * Sprint 5 integration tests: the matches list, unmatching, FCM token
 * registration and the privacy of match pushes, against real PostgreSQL.
 */
describe('Matches, unmatch and push notifications (integration, PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const otp = new CapturingSender();
  const push = new FakePushSender();

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
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    push.sent.length = 0;
    push.dead.clear();
    await prisma.$executeRaw`TRUNCATE users, otp_challenges, signup_blocks RESTART IDENTITY CASCADE`;
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

  /** A signed-up member, Smile ID-verified unless told otherwise. */
  async function member(verified = true): Promise<Member> {
    const token = await createMember(app, otp);
    const auth = { Authorization: `Bearer ${token}` };
    const me = await http().get('/v1/me').set(auth).expect(200);
    if (verified) await prisma.user.update({ where: { id: me.body.id }, data: { ageVerified: true } });
    return { id: me.body.id, token, auth };
  }

  async function registerPush(m: Member, name: string) {
    await http()
      .post('/v1/notifications/tokens')
      .set(m.auth)
      .send({ token: fcmToken(name), platform: 'android' })
      .expect(204);
  }

  /** Mutual like through the real endpoints. Returns the match id. */
  async function makeMatch(a: Member, b: Member): Promise<string> {
    await http().post('/v1/matching/likes').set(b.auth).send({ user_id: a.id }).expect(201);
    const res = await http().post('/v1/matching/likes').set(a.auth).send({ user_id: b.id }).expect(201);
    expect(res.body.matched).toBe(true);
    return res.body.match_id;
  }

  // ── Token registration ────────────────────────────────────

  it('registers a token against the device session; logout removes it', async () => {
    const a = await member();
    await registerPush(a, 'a');
    const row = await prisma.pushToken.findUniqueOrThrow({ where: { token: fcmToken('a') } });
    expect(row).toMatchObject({ userId: a.id, platform: 'android' });

    await http().post('/v1/auth/logout').set(a.auth).expect(204);
    expect(await prisma.pushToken.count()).toBe(0);
  });

  it('moves a token to whoever registers it last (shared or resold phones)', async () => {
    const a = await member();
    const b = await member();
    await registerPush(a, 'shared');
    await registerPush(b, 'shared');
    const row = await prisma.pushToken.findUniqueOrThrow({ where: { token: fcmToken('shared') } });
    expect(row.userId).toBe(b.id);
    expect(await prisma.pushToken.count()).toBe(1);
  });

  it('validates registrations and requires sign-in', async () => {
    const a = await member();
    await http()
      .post('/v1/notifications/tokens')
      .send({ token: fcmToken('x'), platform: 'android' })
      .expect(401);
    await http()
      .post('/v1/notifications/tokens')
      .set(a.auth)
      .send({ token: fcmToken('x'), platform: 'symbian' })
      .expect(400);
    await http().post('/v1/notifications/tokens').set(a.auth).send({ token: 'short', platform: 'android' }).expect(400);
  });

  it('unregisters a token', async () => {
    const a = await member();
    await registerPush(a, 'a');
    await http()
      .delete('/v1/notifications/tokens')
      .set(a.auth)
      .send({ token: fcmToken('a') })
      .expect(204);
    expect(await prisma.pushToken.count()).toBe(0);
  });

  // ── match.created push ────────────────────────────────────

  it('a new match notifies both members, generically: no names, phone or location', async () => {
    const a = await member();
    const b = await member();
    await registerPush(a, 'a');
    await registerPush(b, 'b');

    const matchId = await makeMatch(a, b);
    await settle();

    expect(push.sent.map((s) => s.token).sort()).toEqual([fcmToken('a'), fcmToken('b')]);
    for (const { message } of push.sent) {
      expect(message.notification).toEqual(MATCH_NOTIFICATION);
      expect(message.data).toEqual({ type: 'match.created', match_id: matchId });
      const json = JSON.stringify(message);
      expect(json).not.toMatch(/Chidinma|\+234|lat|lng|location|km/i);
    }
  });

  it('removes tokens FCM reports as dead', async () => {
    const a = await member();
    const b = await member();
    await registerPush(a, 'a');
    push.dead.add(fcmToken('a'));
    await makeMatch(a, b);
    await settle();
    expect(await prisma.pushToken.count({ where: { token: fcmToken('a') } })).toBe(0);
  });

  // ── Matches list ──────────────────────────────────────────

  it('lists active matches, newest conversation first, with unread counts', async () => {
    const a = await member();
    const b = await member();
    const c = await member();
    const withB = await makeMatch(a, b);
    const withC = await makeMatch(a, c);

    // C sent two messages to A; the newest conversation sorts first.
    await prisma.message.createMany({
      data: [
        { matchId: withC, senderId: c.id, body: 'Hello there' },
        { matchId: withC, senderId: c.id, body: 'How was your weekend?' },
      ],
    });
    await prisma.match.update({ where: { id: withC }, data: { lastMessageAt: new Date() } });

    const res = await http().get('/v1/matches').set(a.auth).expect(200);
    expect(res.body.matches.map((m: { match_id: string }) => m.match_id)).toEqual([withC, withB]);
    expect(res.body.matches[0]).toMatchObject({
      photos_unlocked: false,
      unread_count: 2,
      user: { user_id: c.id, first_name: 'Chidinma', age: 27, verified: true },
      last_message: { from_me: false },
    });
    expect(res.body.matches[1]).toMatchObject({ unread_count: 0, last_message: null });
  });

  it('matches are for verified members only', async () => {
    const unverified = await member(false);
    const res = await http().get('/v1/matches').set(unverified.auth).expect(403);
    expect(res.body.error.code).toBe('VERIFICATION_REQUIRED');
  });

  // ── Unmatch ───────────────────────────────────────────────

  it('unmatch is final for both members, with only a silent refresh for the other', async () => {
    const a = await member();
    const b = await member();
    await registerPush(b, 'b');
    const matchId = await makeMatch(a, b);
    await settle();
    push.sent.length = 0;

    await http().delete(`/v1/matches/${matchId}`).set(a.auth).expect(204);
    await settle();

    expect((await http().get('/v1/matches').set(a.auth).expect(200)).body.matches).toEqual([]);
    expect((await http().get('/v1/matches').set(b.auth).expect(200)).body.matches).toEqual([]);

    // B is told silently (no visible notification, nothing about who).
    expect(push.sent).toEqual([
      { token: fcmToken('b'), message: { data: { type: 'match.removed', match_id: matchId } } },
    ]);

    const row = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(row.unmatchedById).toBe(a.id);
    expect(row.unmatchedAt).not.toBeNull();

    // Twice, or from the other side: already gone.
    await http().delete(`/v1/matches/${matchId}`).set(a.auth).expect(404);
    await http().delete(`/v1/matches/${matchId}`).set(b.auth).expect(404);
  });

  it('liking again after an unmatch never re-creates the match', async () => {
    const a = await member();
    const b = await member();
    const matchId = await makeMatch(a, b);
    await http().delete(`/v1/matches/${matchId}`).set(b.auth).expect(204);
    await settle();
    push.sent.length = 0;

    const again = await http().post('/v1/matching/likes').set(a.auth).send({ user_id: b.id }).expect(201);
    expect(again.body).toEqual({ matched: false, match_id: null });
    await settle();
    expect(push.sent).toEqual([]);
    expect(await prisma.match.count()).toBe(1);
  });

  it("members can't unmatch other people's matches", async () => {
    const a = await member();
    const b = await member();
    const stranger = await member();
    const matchId = await makeMatch(a, b);
    await http().delete(`/v1/matches/${matchId}`).set(stranger.auth).expect(404);
    expect((await prisma.match.findUniqueOrThrow({ where: { id: matchId } })).unmatchedAt).toBeNull();
  });
});
