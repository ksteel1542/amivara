import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Boots the full AppModule (every feature module, config validation, the /v1
 * prefix, the global auth guard and the error envelope) with the database
 * replaced by a stub. Only paths that never reach the database are tested
 * here; the database-backed flows are in tests/*.int-spec.ts.
 */
describe('AMIVARA API (e2e, no database)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        isReachable: async () => true,
        $disconnect: async () => undefined,
        onModuleDestroy: async () => undefined,
      })
      .compile();

    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('GET /health is public, unprefixed and healthy', async () => {
    await http().get('/health').expect(200, { status: 'ok' });
  });

  it('GET /health/ready reports the database as up', async () => {
    await http().get('/health/ready').expect(200, { status: 'ok', database: 'up' });
  });

  it('feature routes live under /v1, and errors use the API envelope', async () => {
    const res = await http().post('/matching/likes').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it.each([
    ['POST', '/v1/matching/likes'],
    ['POST', '/v1/matching/passes'],
    ['GET', '/v1/me'],
    ['POST', '/v1/auth/logout'],
    ['GET', '/v1/auth/sessions'],
  ])('%s %s requires sign-in', async (method, path) => {
    const res = await (method === 'GET' ? http().get(path) : http().post(path)).expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a malformed bearer token', async () => {
    const res = await http().get('/v1/me').set('Authorization', 'Bearer not.a.jwt').expect(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('onboarding requires the signup token', async () => {
    const res = await http().post('/v1/onboarding/complete').send({}).expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('validates OTP requests before touching the database', async () => {
    const res = await http().post('/v1/auth/otp/request').send({ channel: 'pigeon' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.fields.map((f: { path: string }) => f.path)).toEqual(
      expect.arrayContaining(['phone', 'channel']),
    );
  });

  it('the Smile ID webhook is public but refuses unsigned callbacks', async () => {
    const res = await http()
      .post('/v1/verification/webhook')
      .send({ PartnerParams: { user_id: 'x', job_id: 'y' }, ResultCode: '1020' })
      .expect(401);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
  });

  it('verification sessions require sign-in', async () => {
    await http().post('/v1/verification/sessions').send({}).expect(401);
  });

  it('rejects non-Nigerian numbers at launch', async () => {
    const res = await http().post('/v1/auth/otp/request').send({ phone: '+447911123456' }).expect(400);
    expect(res.body.error.code).toBe('INVALID_PHONE');
  });
});
