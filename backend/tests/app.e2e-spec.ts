import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Boots the full AppModule (every feature module, config validation, the
 * /v1 prefix) with the database replaced by a stub. No PostgreSQL needed.
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

  it('GET /health is unprefixed and healthy', async () => {
    await request(app.getHttpServer()).get('/health').expect(200, { status: 'ok' });
  });

  it('GET /health/ready reports the database as up', async () => {
    await request(app.getHttpServer()).get('/health/ready').expect(200, { status: 'ok', database: 'up' });
  });

  it('feature routes live under /v1', async () => {
    await request(app.getHttpServer()).post('/matching/likes').expect(404);
  });

  it('POST /v1/matching/likes is behind the verification gate', async () => {
    const res = await request(app.getHttpServer()).post('/v1/matching/likes').expect(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('POST /v1/matching/passes is open before verification (browse-only members can pass)', async () => {
    await request(app.getHttpServer()).post('/v1/matching/passes').expect(501);
  });
});
