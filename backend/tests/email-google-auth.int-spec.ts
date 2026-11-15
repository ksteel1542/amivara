import { generateKeyPairSync, sign } from 'node:crypto';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { GOOGLE_KEYS } from '../src/modules/auth/google-identity';
import { OTP_SENDER } from '../src/modules/auth/otp-sender';
import { MEDIA_STORAGE } from '../src/modules/media/media-storage';
import { PrismaService } from '../src/prisma/prisma.service';
import { CapturingSender, FakeMediaStorage } from './support/members';

const CLIENT = 'amivara-test.apps.googleusercontent.com';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

/** A Google-style ID token signed with our local test key (the app never talks to Google in tests). */
function googleToken(email: string, extra: Record<string, unknown> = {}): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', kid: 'test-key', typ: 'JWT' });
  const body = b64({
    iss: 'accounts.google.com',
    aud: CLIENT,
    iat: now,
    exp: now + 3600,
    email,
    email_verified: true,
    ...extra,
  });
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
}

const yearsAgo = (n: number) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - n);
  d.setUTCDate(d.getUTCDate() - 3);
  return d.toISOString().slice(0, 10);
};
const profile = (dob: string) => ({
  first_name: 'Adaeze',
  date_of_birth: dob,
  gender: 'woman',
  interested_in: ['man'],
  intent: 'relationship',
});

/**
 * Email-first sign-up (Nov 2026): email codes and Google Sign-In as the primary
 * paths, phone optional; under-18 and ban blocks cover email + device; the
 * community guidelines are accepted once after sign-up.
 */
describe('Email and Google sign-in (integration, PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sender = new CapturingSender();
  let device = 0;

  beforeAll(async () => {
    process.env.GOOGLE_CLIENT_IDS = CLIENT;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OTP_SENDER)
      .useValue(sender)
      .overrideProvider(MEDIA_STORAGE)
      .useValue(new FakeMediaStorage())
      .overrideProvider(GOOGLE_KEYS)
      .useValue({ key: async (kid: string) => (kid === 'test-key' ? publicKey : undefined) })
      .compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    sender.sent.length = 0;
    device += 1;
    await prisma.$executeRaw`TRUNCATE users, otp_challenges, signup_blocks RESTART IDENTITY CASCADE`;
  });

  afterAll(async () => {
    delete process.env.GOOGLE_CLIENT_IDS;
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const dev = () => `email-test-device-${String(device).padStart(4, '0')}`;

  async function emailCode(email: string) {
    const res = await http().post('/v1/auth/email/request').set('X-Device-Id', dev()).send({ email }).expect(202);
    expect(res.body).toMatchObject({ channel: 'email', expires_in: 300 });
    return http()
      .post('/v1/auth/otp/verify')
      .set('X-Device-Id', dev())
      .send({ challenge_id: res.body.challenge_id, code: sender.lastCode() });
  }

  function onboard(signupToken: string, dob = yearsAgo(26)) {
    return http()
      .post('/v1/onboarding/complete')
      .set('Authorization', `Bearer ${signupToken}`)
      .set('X-Device-Id', dev())
      .send(profile(dob));
  }

  it('signs up by email code, then signs straight back in; addresses are case-insensitive', async () => {
    const first = await emailCode('Adaeze.Okafor@Example.com');
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('signup_required');
    expect(sender.sent.at(-1)).toMatchObject({ phone: 'adaeze.okafor@example.com', channel: 'email' });

    const done = await onboard(first.body.signup_token).expect(201);
    const auth = { Authorization: `Bearer ${done.body.access_token}` };
    const me = await http().get('/v1/me').set(auth).expect(200);
    expect(me.body).toMatchObject({
      email: 'adaeze.okafor@example.com',
      phone_last4: null,
      verification: { email: true, phone: false, age_verified: false },
      guidelines_accepted: false,
    });
    const user = await prisma.user.findFirstOrThrow({ include: { verifications: true } });
    expect(user.phoneE164).toBeNull();
    expect(user.verifications.map((v) => v.type)).toEqual(['EMAIL_OTP']);

    await prisma.otpChallenge.deleteMany(); // skip the resend cooldown
    const again = await emailCode('ADAEZE.OKAFOR@example.COM');
    expect(again.body.status).toBe('signed_in');
  });

  it('the response never reveals whether an address has an account', async () => {
    await onboard((await emailCode('member@example.com')).body.signup_token).expect(201);
    await prisma.otpChallenge.deleteMany();
    const known = await http()
      .post('/v1/auth/email/request')
      .set('X-Device-Id', dev())
      .send({ email: 'member@example.com' });
    const unknown = await http()
      .post('/v1/auth/email/request')
      .set('X-Device-Id', dev())
      .send({ email: 'nobody@example.com' });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(Object.keys(known.body).sort()).toEqual(Object.keys(unknown.body).sort());
  });

  it('rejects malformed addresses and rate-limits like phone codes', async () => {
    for (const email of ['not-an-email', 'a@b', 'ada@@example.com', `${'x'.repeat(250)}@example.com`]) {
      const res = await http().post('/v1/auth/email/request').set('X-Device-Id', dev()).send({ email });
      expect(res.status).toBe(400);
    }
    await http()
      .post('/v1/auth/email/request')
      .set('X-Device-Id', dev())
      .send({ email: 'ada@example.com' })
      .expect(202);
    const tooSoon = await http()
      .post('/v1/auth/email/request')
      .set('X-Device-Id', dev())
      .send({ email: 'ada@example.com' });
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.error.code).toBe('OTP_RATE_LIMITED');
  });

  it('under 18 blocks the email and the device, like a phone', async () => {
    const res = await emailCode('young@example.com');
    const blocked = await http()
      .post('/v1/onboarding/age-gate')
      .set('Authorization', `Bearer ${res.body.signup_token}`)
      .send({ date_of_birth: yearsAgo(16) });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('UNDERAGE');

    // Same email again, from the same device: refused before onboarding.
    await prisma.otpChallenge.deleteMany();
    const retry = await emailCode('young@example.com');
    expect(retry.status).toBe(403);
    expect(retry.body.error.code).toBe('SIGNUP_BLOCKED');
    // A fresh email on the same device is refused too (device block).
    await prisma.otpChallenge.deleteMany();
    const fresh = await emailCode('another@example.com');
    expect(fresh.body.error.code).toBe('SIGNUP_BLOCKED');
  });

  it('Google Sign-In signs up and back in with the Google-verified email', async () => {
    const first = await http()
      .post('/v1/auth/google')
      .set('X-Device-Id', dev())
      .send({ id_token: googleToken('Kunle@Gmail.com') })
      .expect(200);
    expect(first.body.status).toBe('signup_required');
    await onboard(first.body.signup_token).expect(201);
    const user = await prisma.user.findFirstOrThrow({ include: { verifications: true } });
    expect(user.email).toBe('kunle@gmail.com');
    expect(user.verifications.map((v) => v.type)).toEqual(['GOOGLE']);

    const again = await http()
      .post('/v1/auth/google')
      .set('X-Device-Id', dev())
      .send({ id_token: googleToken('kunle@gmail.com') })
      .expect(200);
    expect(again.body.status).toBe('signed_in');

    // Same address by email code reaches the same account.
    const byCode = await emailCode('kunle@gmail.com');
    expect(byCode.body.status).toBe('signed_in');
  });

  it('rejects forged or unverified Google tokens', async () => {
    const forged = googleToken('kunle@gmail.com').replace(/\.[^.]+$/, '.AAAA');
    const bad = await http().post('/v1/auth/google').send({ id_token: forged }).expect(401);
    expect(bad.body.error.code).toBe('INVALID_GOOGLE_TOKEN');
    await http()
      .post('/v1/auth/google')
      .send({ id_token: googleToken('x@gmail.com', { email_verified: false }) })
      .expect(401);
    await http()
      .post('/v1/auth/google')
      .send({ id_token: googleToken('x@gmail.com', { aud: 'another-app' }) })
      .expect(401);
  });

  it('a banned email account cannot sign in or sign up again on that device', async () => {
    const done = await onboard((await emailCode('scammer@example.com')).body.signup_token).expect(201);
    const scammerDevice = device;
    const id = (
      await http()
        .get('/v1/me')
        .set({ Authorization: `Bearer ${done.body.access_token}` })
    ).body.id;
    const modToken = await onboard((await emailCodeOnNewDevice('mod@example.com')).body.signup_token);
    const mod = (
      await http()
        .get('/v1/me')
        .set({ Authorization: `Bearer ${modToken.body.access_token}` })
    ).body.id;
    await prisma.user.update({ where: { id: mod }, data: { role: 'MODERATOR' } });
    await http()
      .post(`/v1/admin/users/${id}/ban`)
      .set({ Authorization: `Bearer ${modToken.body.access_token}` })
      .send({ reason: 'Romance scam' })
      .expect(204);

    device = scammerDevice; // back on the scammer's phone
    await prisma.otpChallenge.deleteMany();
    const signIn = await emailCode('scammer@example.com');
    expect(signIn.body.error.code).toBe('ACCOUNT_SUSPENDED');
    await prisma.otpChallenge.deleteMany();
    const newAccount = await emailCode('scammer2@example.com'); // same device
    expect(newAccount.body.error.code).toBe('SIGNUP_BLOCKED');
  });

  it('community guidelines are accepted once', async () => {
    const done = await onboard((await emailCode('member@example.com')).body.signup_token).expect(201);
    const auth = { Authorization: `Bearer ${done.body.access_token}` };
    expect((await http().get('/v1/me').set(auth)).body.guidelines_accepted).toBe(false);
    await http().post('/v1/me/guidelines/accept').set(auth).expect(204);
    await http().post('/v1/me/guidelines/accept').set(auth).expect(204); // idempotent
    expect((await http().get('/v1/me').set(auth)).body.guidelines_accepted).toBe(true);
    const at = (await prisma.user.findFirstOrThrow()).guidelinesAcceptedAt;
    expect(at).not.toBeNull();
  });

  /** A second member on their own device, so the device-based limits don't interfere. */
  async function emailCodeOnNewDevice(email: string) {
    device += 1;
    return emailCode(email);
  }
});
