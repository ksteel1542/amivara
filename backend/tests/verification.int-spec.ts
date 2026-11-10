import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { OTP_SENDER } from '../src/modules/auth/otp-sender';
import { computeSignature, SmileIdClient } from '../src/modules/verification/smile-id.client';
import { VerificationService } from '../src/modules/verification/verification.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CapturingSender, createMember } from './support/members';

/**
 * Sprint 3 integration tests: Smile ID sessions, signed webhook callbacks,
 * status transitions, the job_status fallback poller, and the verification
 * gate on likes and messages, against real PostgreSQL + PostGIS.
 * Smile ID itself is simulated with correctly signed callbacks.
 */
const PARTNER_ID = '000';
const API_KEY = 'test-smile-api-key';

describe('Smile ID verification (integration, PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sender = new CapturingSender();
  let token: string;
  let userId: string;
  let declaredDob: string;

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
    jest.restoreAllMocks();
    await prisma.$executeRaw`TRUNCATE users, otp_challenges, signup_blocks RESTART IDENTITY CASCADE`;
    token = await createMember(app, sender);
    const user = await prisma.user.findFirstOrThrow();
    userId = user.id;
    declaredDob = user.dateOfBirth.toISOString().slice(0, 10);
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  async function startSession(): Promise<{ jobId: string; body: Record<string, unknown> }> {
    const res = await http().post('/v1/verification/sessions').set(auth()).send({}).expect(201);
    return { jobId: res.body.partner_params.job_id, body: res.body };
  }

  /** A callback exactly as Smile ID would sign it. */
  function callback(
    jobId: string,
    opts: { dob?: string; actions?: Record<string, string>; signedBy?: string; at?: Date } = {},
  ) {
    const timestamp = (opts.at ?? new Date()).toISOString();
    return {
      signature: computeSignature(opts.signedBy ?? API_KEY, PARTNER_ID, timestamp),
      timestamp,
      ResultCode: '1020',
      ResultText: 'Exact Match',
      SmileJobID: '0000012345',
      PartnerParams: { user_id: userId, job_id: jobId, job_type: 1 },
      Actions: {
        Verify_ID_Number: 'Verified',
        Liveness_Check: 'Passed',
        Selfie_To_ID_Authority_Compare: 'Completed',
        Return_Personal_Info: 'Returned',
        ...opts.actions,
      },
      DOB: opts.dob ?? declaredDob,
    };
  }

  const failingCallback = (jobId: string) => callback(jobId, { actions: { Liveness_Check: 'Failed' } });

  // ── Sessions ──────────────────────────────────────────────

  it('creates a signed Smile ID session with our partner params', async () => {
    const { body } = await startSession();
    expect(body).toMatchObject({
      environment: 'sandbox',
      partner_id: PARTNER_ID,
      partner_params: { user_id: userId, job_type: 1 },
      id_info: { country: 'NG', id_type: 'NIN_V2' },
      callback_url: 'https://api.example.test/v1/verification/webhook',
      attempts_left: 3,
    });
    expect(body.signature).toBe(computeSignature(API_KEY, PARTNER_ID, body.timestamp as string));
    expect(JSON.stringify(body)).not.toContain(API_KEY);

    const row = await prisma.verification.findFirstOrThrow({ where: { type: 'BIOMETRIC_KYC' } });
    expect(row).toMatchObject({
      status: 'PENDING',
      provider: 'SMILE_ID',
      providerJobId: (body.partner_params as { job_id: string }).job_id,
    });
  });

  it('a new session supersedes the previous one', async () => {
    const first = await startSession();
    await startSession();
    const old = await prisma.verification.findUniqueOrThrow({ where: { providerJobId: first.jobId } });
    expect(old.status).toBe('EXPIRED');
    const res = await http().post('/v1/verification/webhook').send(callback(first.jobId)).expect(200);
    expect(res.body.status).toBe('already_processed');
  });

  // ── Gate (PRD §5.3a) ──────────────────────────────────────

  it('blocks liking and messaging until verified, with VERIFICATION_REQUIRED', async () => {
    const like = await http().post('/v1/matching/likes').set(auth()).expect(403);
    expect(like.body.error.code).toBe('VERIFICATION_REQUIRED');
    const message = await http()
      .post('/v1/conversations/00000000-0000-4000-8000-000000000000/messages')
      .set(auth())
      .expect(403);
    expect(message.body.error.code).toBe('VERIFICATION_REQUIRED');
    await http().post('/v1/matching/passes').set(auth()).expect(501); // browsing actions stay open
  });

  // ── Webhook ───────────────────────────────────────────────

  it('rejects callbacks with a bad signature or a stale timestamp', async () => {
    const { jobId } = await startSession();
    const forged = await http()
      .post('/v1/verification/webhook')
      .send(callback(jobId, { signedBy: 'not-the-key' }))
      .expect(401);
    expect(forged.body.error.code).toBe('INVALID_SIGNATURE');
    await http()
      .post('/v1/verification/webhook')
      .send(callback(jobId, { at: new Date(Date.now() - 3 * 60 * 60 * 1000) }))
      .expect(401);
    const row = await prisma.verification.findUniqueOrThrow({ where: { providerJobId: jobId } });
    expect(row.status).toBe('PENDING');
  });

  it('PASSED: unlocks liking and messaging, idempotently', async () => {
    const { jobId } = await startSession();
    const res = await http().post('/v1/verification/webhook').send(callback(jobId)).expect(200);
    expect(res.body.status).toBe('passed');

    const row = await prisma.verification.findUniqueOrThrow({ where: { providerJobId: jobId } });
    expect(row).toMatchObject({
      status: 'PASSED',
      verifiedAdult: true,
      dobMatches: true,
      verifiedAgeBand: '25-34',
      resultCode: '1020',
    });

    const me = await http().get('/v1/me').set(auth()).expect(200);
    expect(me.body.verification).toMatchObject({ age_verified: true, can_like_and_message: true });
    const status = await http().get('/v1/verification/status').set(auth()).expect(200);
    expect(status.body).toMatchObject({ age_verified: true, latest: { status: 'passed' } });

    await http().post('/v1/matching/likes').set(auth()).expect(501); // past the gate
    await http().post('/v1/conversations/00000000-0000-4000-8000-000000000000/messages').set(auth()).expect(501);

    // Smile ID retries: a replay changes nothing.
    const replay = await http().post('/v1/verification/webhook').send(failingCallback(jobId)).expect(200);
    expect(replay.body.status).toBe('already_processed');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).ageVerified).toBe(true);

    const again = await http().post('/v1/verification/sessions').set(auth()).send({}).expect(409);
    expect(again.body.error.code).toBe('ALREADY_VERIFIED');
  });

  it('DOB mismatch: under review, still browse-only', async () => {
    const { jobId } = await startSession();
    const res = await http()
      .post('/v1/verification/webhook')
      .send(callback(jobId, { dob: '1990-01-01' }))
      .expect(200);
    expect(res.body.status).toBe('manual_review');

    const row = await prisma.verification.findUniqueOrThrow({ where: { providerJobId: jobId } });
    expect(row).toMatchObject({ status: 'MANUAL_REVIEW', failureReason: 'DOB_MISMATCH', dobMatches: false });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).ageVerified).toBe(false);

    const blocked = await http().post('/v1/verification/sessions').set(auth()).send({}).expect(409);
    expect(blocked.body.error.code).toBe('UNDER_REVIEW');
  });

  it('ID shows under 18: account banned and every session ended', async () => {
    const { jobId } = await startSession();
    const res = await http()
      .post('/v1/verification/webhook')
      .send(callback(jobId, { dob: '2012-05-05' }))
      .expect(200);
    expect(res.body.status).toBe('failed');

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user).toMatchObject({ status: 'BANNED', ageVerified: false });
    const row = await prisma.verification.findUniqueOrThrow({ where: { providerJobId: jobId } });
    expect(row).toMatchObject({ failureReason: 'UNDERAGE', verifiedAdult: false, verifiedAgeBand: 'under-18' });
    expect(await prisma.deviceSession.count({ where: { userId, revokedAt: null } })).toBe(0);

    await http().get('/v1/me').set(auth()).expect(401);
  });

  it('failures count down; the third goes to manual review', async () => {
    for (const [expected, attemptsLeft] of [
      ['failed', 2],
      ['failed', 1],
    ] as const) {
      const { jobId } = await startSession();
      const res = await http().post('/v1/verification/webhook').send(failingCallback(jobId)).expect(200);
      expect(res.body.status).toBe(expected);
      const status = await http().get('/v1/verification/status').set(auth()).expect(200);
      expect(status.body.attempts_left).toBe(attemptsLeft);
    }
    const { jobId } = await startSession();
    const third = await http().post('/v1/verification/webhook').send(failingCallback(jobId)).expect(200);
    expect(third.body.status).toBe('manual_review');
    await http().post('/v1/verification/sessions').set(auth()).send({}).expect(409);
  });

  // ── Fallback poller ───────────────────────────────────────

  it('the poller resolves a session whose callback never arrived', async () => {
    const { jobId } = await startSession();
    await prisma.verification.updateMany({ data: { createdAt: new Date(Date.now() - 5 * 60_000) } });

    const smile = app.get(SmileIdClient);
    const jobStatus = jest.spyOn(smile, 'jobStatus').mockResolvedValue({
      jobComplete: true,
      jobSuccess: true,
      result: callback(jobId),
    });

    const result = await app.get(VerificationService).pollPending();
    expect(jobStatus).toHaveBeenCalledWith(userId, jobId);
    expect(result).toMatchObject({ checked: 1, resolved: 1 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).ageVerified).toBe(true);

    // The late callback then changes nothing.
    const late = await http().post('/v1/verification/webhook').send(callback(jobId)).expect(200);
    expect(late.body.status).toBe('already_processed');
  });

  it('the poller leaves incomplete jobs pending and expires sessions after 24 hours', async () => {
    const { jobId } = await startSession();
    await prisma.verification.updateMany({ data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    jest
      .spyOn(app.get(SmileIdClient), 'jobStatus')
      .mockResolvedValue({ jobComplete: false, jobSuccess: false, result: null });

    await app.get(VerificationService).pollPending();
    expect((await prisma.verification.findUniqueOrThrow({ where: { providerJobId: jobId } })).status).toBe('PENDING');

    await prisma.verification.updateMany({ data: { createdAt: new Date(Date.now() - 25 * 60 * 60_000) } });
    const result = await app.get(VerificationService).pollPending();
    expect(result.expired).toBe(1);
    expect((await prisma.verification.findUniqueOrThrow({ where: { providerJobId: jobId } })).status).toBe('EXPIRED');
  });
});
