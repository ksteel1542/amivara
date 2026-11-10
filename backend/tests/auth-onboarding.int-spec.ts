import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { OTP_SENDER, type OtpSender } from '../src/modules/auth/otp-sender';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Sprint 1 integration tests: the full phone-OTP + onboarding flow over HTTP
 * against a real PostgreSQL + PostGIS database with the migrations applied.
 * Run by CI's database job (`pnpm --filter @amivara/backend test:integration`).
 */

class CapturingSender implements OtpSender {
  readonly sent: Array<{ phone: string; code: string; channel: string }> = [];
  async send(phone: string, code: string, channel: string): Promise<void> {
    this.sent.push({ phone, code, channel });
  }
  lastCode(): string {
    const last = this.sent.at(-1);
    if (!last) throw new Error('no OTP sent');
    return last.code;
  }
}

const DEVICE_A = 'device-aaaaaaaa-0001';
const DEVICE_B = 'device-bbbbbbbb-0002';

function yearsAgo(years: number, extraDays = 0): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() + extraDays);
  return d.toISOString().slice(0, 10);
}

describe('Auth + onboarding (integration, PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sender = new CapturingSender();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OTP_SENDER)
      .useValue(sender)
      .compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    sender.sent.length = 0;
    await prisma.$executeRaw`TRUNCATE users, otp_challenges, signup_blocks RESTART IDENTITY CASCADE`;
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  async function requestOtp(phone: string, device = DEVICE_A) {
    const res = await http()
      .post('/v1/auth/otp/request')
      .set('X-Device-Id', device)
      .send({ phone, channel: 'sms' })
      .expect(202);
    return { challengeId: res.body.challenge_id as string, code: sender.lastCode(), body: res.body };
  }

  // Not async: returning the supertest Test keeps `.expect()` chainable.
  function verifyOtp(challengeId: string, code: string, device = DEVICE_A) {
    return http().post('/v1/auth/otp/verify').set('X-Device-Id', device).send({ challenge_id: challengeId, code });
  }

  async function signupToken(phone: string, device = DEVICE_A): Promise<string> {
    const { challengeId, code } = await requestOtp(phone, device);
    const res = await verifyOtp(challengeId, code, device).expect(200);
    expect(res.body.status).toBe('signup_required');
    return res.body.signup_token;
  }

  const profile = (dob: string) => ({
    first_name: 'Ọlá',
    date_of_birth: dob,
    gender: 'woman',
    interested_in: ['man'],
    intent: 'relationship',
  });

  async function onboard(phone: string): Promise<{ access_token: string; refresh_token: string }> {
    const token = await signupToken(phone);
    const res = await http()
      .post('/v1/onboarding/complete')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Device-Id', DEVICE_A)
      .send(profile(yearsAgo(25)))
      .expect(201);
    return res.body;
  }

  // ── Happy path ────────────────────────────────────────────

  it('new number: OTP → signup token → onboarding → signed-in member (browse-only)', async () => {
    const { challengeId, code, body } = await requestOtp('0801 234 5678');
    expect(body).toMatchObject({ channel: 'sms', expires_in: 300, resend_in: 60 });
    expect(sender.sent[0].phone).toBe('+2348012345678');

    // The code is never stored: only a 64-hex HMAC.
    const row = await prisma.otpChallenge.findUniqueOrThrow({ where: { id: challengeId } });
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.codeHash).not.toContain(code);

    const verified = await verifyOtp(challengeId, code).expect(200);
    expect(verified.body).toMatchObject({ status: 'signup_required', expires_in: 1800 });

    const signup = verified.body.signup_token as string;
    await http()
      .post('/v1/onboarding/age-gate')
      .set('Authorization', `Bearer ${signup}`)
      .send({ date_of_birth: yearsAgo(25) })
      .expect(204);

    const done = await http()
      .post('/v1/onboarding/complete')
      .set('Authorization', `Bearer ${signup}`)
      .set('X-Platform', 'android')
      .send(profile(yearsAgo(25)))
      .expect(201);
    expect(done.body).toMatchObject({ token_type: 'Bearer', expires_in: 900 });

    const me = await http().get('/v1/me').set('Authorization', `Bearer ${done.body.access_token}`).expect(200);
    expect(me.body).toMatchObject({
      status: 'active',
      phone_last4: '5678',
      age: 25,
      verification: { phone: true, age_verified: false, can_like_and_message: false },
      profile: { first_name: 'Ọlá', gender: 'woman', intent: 'relationship' },
      preferences: { interested_in: ['man'], age_min: 20, age_max: 30 },
    });
    expect(JSON.stringify(me.body)).not.toContain('+2348012345678');
  });

  it('existing number signs straight in', async () => {
    await onboard('08012345678');
    // Wait out the resend cooldown by ageing the previous challenge.
    await prisma.otpChallenge.updateMany({ data: { createdAt: new Date(Date.now() - 5 * 60_000) } });

    const { challengeId, code } = await requestOtp('+234 801 234 5678');
    const res = await verifyOtp(challengeId, code).expect(200);
    expect(res.body.status).toBe('signed_in');
    expect(res.body.access_token).toBeDefined();
  });

  it('a second onboarding for the same number is refused', async () => {
    const token = await signupToken('08012345678');
    await http()
      .post('/v1/onboarding/complete')
      .set('Authorization', `Bearer ${token}`)
      .send(profile(yearsAgo(30)))
      .expect(201);
    const again = await http()
      .post('/v1/onboarding/complete')
      .set('Authorization', `Bearer ${token}`)
      .send(profile(yearsAgo(30)))
      .expect(409);
    expect(again.body.error.code).toBe('PHONE_ALREADY_REGISTERED');
  });

  // ── 18+ gate (PRD §4, SECURITY.md §1) ─────────────────────

  it('under 18: refused, nothing stored, phone and device blocked', async () => {
    const token = await signupToken('08012345678');
    const gate = await http()
      .post('/v1/onboarding/age-gate')
      .set('Authorization', `Bearer ${token}`)
      .send({ date_of_birth: yearsAgo(18, 1) }) // turns 18 tomorrow
      .expect(403);
    expect(gate.body.error.code).toBe('UNDERAGE');

    // Editing the date afterwards does not help.
    const retry = await http()
      .post('/v1/onboarding/complete')
      .set('Authorization', `Bearer ${token}`)
      .send(profile(yearsAgo(25)))
      .expect(403);
    expect(retry.body.error.code).toBe('SIGNUP_BLOCKED');

    expect(await prisma.user.count()).toBe(0);
    const blocks = await prisma.signupBlock.findMany();
    expect(blocks).toHaveLength(2); // phone + device
    for (const b of blocks) {
      expect(b.subject).toMatch(/^[0-9a-f]{64}$/); // HMAC only, never the number
      expect(b.expiresAt.getTime()).toBeGreaterThan(Date.now() + 360 * 24 * 3600 * 1000);
    }

    // Same phone later: blocked at verification.
    await prisma.otpChallenge.updateMany({ data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    const again = await requestOtp('08012345678', DEVICE_B);
    expect((await verifyOtp(again.challengeId, again.code, DEVICE_B).expect(403)).body.error.code).toBe(
      'SIGNUP_BLOCKED',
    );

    // Different phone on the same device: also blocked.
    const other = await requestOtp('08099998888', DEVICE_A);
    expect((await verifyOtp(other.challengeId, other.code, DEVICE_A).expect(403)).body.error.code).toBe(
      'SIGNUP_BLOCKED',
    );
  });

  it('exactly 18 today is allowed', async () => {
    const token = await signupToken('08012345678');
    await http()
      .post('/v1/onboarding/age-gate')
      .set('Authorization', `Bearer ${token}`)
      .send({ date_of_birth: yearsAgo(18) }) // 18th birthday today
      .expect(204);
  });

  // ── OTP abuse controls (SECURITY.md §2) ───────────────────

  it('wrong codes count down, then lock the number for 15 minutes', async () => {
    const { challengeId, code } = await requestOtp('08012345678');
    const wrong = code === '000000' ? '111111' : '000000';

    for (const left of [4, 3, 2, 1]) {
      const res = await verifyOtp(challengeId, wrong).expect(400);
      expect(res.body.error).toMatchObject({ code: 'OTP_INVALID', details: { attempts_left: left } });
    }
    expect((await verifyOtp(challengeId, wrong).expect(429)).body.error.code).toBe('OTP_LOCKED');
    // Even the right code is refused now.
    expect((await verifyOtp(challengeId, code).expect(429)).body.error.code).toBe('OTP_LOCKED');

    await prisma.otpChallenge.updateMany({ data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    const res = await http().post('/v1/auth/otp/request').send({ phone: '08012345678' }).expect(429);
    expect(res.body.error.code).toBe('OTP_LOCKED');
    expect(res.body.error.details.retry_after).toBeGreaterThan(0);
  });

  it('codes are single-use and expire after 5 minutes', async () => {
    const first = await requestOtp('08012345678');
    await verifyOtp(first.challengeId, first.code).expect(200);
    expect((await verifyOtp(first.challengeId, first.code).expect(400)).body.error.code).toBe('OTP_EXPIRED');

    await prisma.otpChallenge.updateMany({ data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    const second = await requestOtp('08012345678');
    await prisma.otpChallenge.update({
      where: { id: second.challengeId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await verifyOtp(second.challengeId, second.code).expect(400)).body.error.code).toBe('OTP_EXPIRED');
  });

  it('enforces the resend cooldown and 3 codes per 10 minutes per number', async () => {
    await requestOtp('08012345678');
    const cooldown = await http()
      .post('/v1/auth/otp/request')
      .set('X-Device-Id', DEVICE_A)
      .send({ phone: '08012345678' })
      .expect(429);
    expect(cooldown.body.error.code).toBe('OTP_RATE_LIMITED');
    expect(cooldown.body.error.details.retry_after).toBeLessThanOrEqual(60);

    const age = async (minutes: number) => {
      for (const row of await prisma.otpChallenge.findMany()) {
        await prisma.otpChallenge.update({
          where: { id: row.id },
          data: { createdAt: new Date(row.createdAt.getTime() - minutes * 60_000) },
        });
      }
    };
    await age(3);
    await requestOtp('08012345678', DEVICE_B);
    await age(3);
    await requestOtp('08012345678', DEVICE_A);
    await age(3);
    const limited = await http().post('/v1/auth/otp/request').send({ phone: '08012345678' }).expect(429);
    expect(limited.body.error.code).toBe('OTP_RATE_LIMITED');
  });

  // ── Sessions (SECURITY.md §3) ─────────────────────────────

  it('rotates refresh tokens and revokes the family when an old one is replayed', async () => {
    const first = await onboard('08012345678');

    const second = await http().post('/v1/auth/refresh').send({ refresh_token: first.refresh_token }).expect(200);
    expect(second.body.refresh_token).not.toBe(first.refresh_token);
    await http().get('/v1/me').set('Authorization', `Bearer ${second.body.access_token}`).expect(200);

    // Replay of the rotated token = theft signal.
    const replay = await http().post('/v1/auth/refresh').send({ refresh_token: first.refresh_token }).expect(401);
    expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');

    // The whole family is gone, including the legitimate newer session.
    await http().post('/v1/auth/refresh').send({ refresh_token: second.body.refresh_token }).expect(401);
    const me = await http().get('/v1/me').set('Authorization', `Bearer ${second.body.access_token}`).expect(401);
    expect(me.body.error.code).toBe('INVALID_TOKEN');
  });

  it('logout ends the session immediately', async () => {
    const tokens = await onboard('08012345678');
    const auth = { Authorization: `Bearer ${tokens.access_token}` };
    await http().post('/v1/auth/logout').set(auth).expect(204);
    await http().get('/v1/me').set(auth).expect(401);
    await http().post('/v1/auth/refresh').send({ refresh_token: tokens.refresh_token }).expect(401);
  });

  it('lists and revokes device sessions', async () => {
    const tokens = await onboard('08012345678');
    const auth = { Authorization: `Bearer ${tokens.access_token}` };
    const list = await http().get('/v1/auth/sessions').set(auth).expect(200);
    expect(list.body.sessions).toHaveLength(1);
    expect(list.body.sessions[0].current).toBe(true);
    await http().delete('/v1/auth/sessions/00000000-0000-4000-8000-000000000000').set(auth).expect(404);
  });

  it('never accepts a signup token as an access token', async () => {
    const token = await signupToken('08012345678');
    const res = await http().get('/v1/me').set('Authorization', `Bearer ${token}`).expect(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  // ── Verification gate (PRD §5.3a) ─────────────────────────

  it('a browse-only member can pass but not like', async () => {
    const tokens = await onboard('08012345678');
    const auth = { Authorization: `Bearer ${tokens.access_token}` };
    const like = await http().post('/v1/matching/likes').set(auth).expect(403);
    expect(like.body.error.code).toBe('VERIFICATION_REQUIRED');
    await http().post('/v1/matching/passes').set(auth).expect(501);
  });
});
