import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { OTP_SENDER } from '../src/modules/auth/otp-sender';
import { MEDIA_STORAGE } from '../src/modules/media/media-storage';
import { GeoRepository } from '../src/modules/profiles/geo.repository';
import { PrismaService } from '../src/prisma/prisma.service';
import { CapturingSender, createMember, FakeMediaStorage } from './support/members';

const LAGOS = { lat: 6.5244, lng: 3.3792 };
const north = (km: number) => ({ lat: LAGOS.lat + km / 111.32, lng: LAGOS.lng });

/** GET /v1/profiles/:userId: the full profile and every visibility rule. */
describe('Profile view (integration, PostgreSQL + PostGIS)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const otp = new CapturingSender();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OTP_SENDER)
      .useValue(otp)
      .overrideProvider(MEDIA_STORAGE)
      .useValue(new FakeMediaStorage())
      .compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE users, otp_challenges, signup_blocks RESTART IDENTITY CASCADE`;
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  async function member(opts: { verified?: boolean; at?: { lat: number; lng: number } } = {}) {
    const token = await createMember(app, otp);
    const auth = { Authorization: `Bearer ${token}` };
    const id = (await http().get('/v1/me').set(auth).expect(200)).body.id as string;
    await prisma.user.update({ where: { id }, data: { ageVerified: opts.verified ?? true } });
    await prisma.profile.update({
      where: { userId: id },
      data: {
        bio: 'Engineer who loves jollof',
        interests: ['afrobeats', 'football'],
        languages: ['en', 'yo'],
        prompts: [{ prompt_id: 'perfect_sunday', answer: 'Church, then suya.' }],
        jobTitle: 'Engineer',
      },
    });
    await prisma.profilePhoto.create({
      data: {
        userId: id,
        storageKey: `photos/${id}/0.jpg`,
        contentType: 'image/jpeg',
        status: 'UPLOADED',
        position: 0,
      },
    });
    await app.get(GeoRepository).setLocation(id, (opts.at ?? LAGOS).lat, (opts.at ?? LAGOS).lng);
    return { id, auth };
  }

  const view = (viewer: { auth: object }, id: string) =>
    http()
      .get(`/v1/profiles/${id}`)
      .set(viewer.auth as Record<string, string>);

  async function makeMatch(a: { id: string; auth: object }, b: { id: string; auth: object }) {
    await http()
      .post('/v1/matching/likes')
      .set(b.auth as Record<string, string>)
      .send({ user_id: a.id })
      .expect(201);
    const res = await http()
      .post('/v1/matching/likes')
      .set(a.auth as Record<string, string>)
      .send({ user_id: b.id })
      .expect(201);
    return res.body.match_id as string;
  }

  it('returns the full profile with a coarse distance and never coordinates', async () => {
    const viewer = await member();
    const target = await member({ at: north(7) });
    const res = await view(viewer, target.id).expect(200);
    expect(res.body).toMatchObject({
      user_id: target.id,
      first_name: 'Chidinma',
      age: 27,
      verified: true,
      bio: 'Engineer who loves jollof',
      interests: ['afrobeats', 'football'],
      languages: ['en', 'yo'],
      job_title: 'Engineer',
      prompts: [{ prompt_id: 'perfect_sunday', prompt: expect.any(String), answer: 'Church, then suya.' }],
      match_id: null,
    });
    expect(res.body.photos).toHaveLength(1);
    expect(res.body.distance.label).toMatch(/km away$/);
    expect(Number.isInteger(res.body.distance.km)).toBe(true); // whole km, same rounding as discovery
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/6\.5|3\.37|latitude|longitude|phone|date_of_birth/);
  });

  it('unverified (browse-only) members can view; unverified members are never shown', async () => {
    const browser = await member({ verified: false });
    const target = await member();
    await view(browser, target.id).expect(200);
    const unverified = await member({ verified: false });
    await view(target, unverified.id).expect(404);
  });

  it('is a 404 for yourself, unknown ids, blocks either way, bans, suspensions and deletions', async () => {
    const viewer = await member();
    const target = await member();
    await view(viewer, viewer.id).expect(404);
    await view(viewer, '00000000-0000-4000-8000-0000000000ff').expect(404);
    await view(viewer, 'not-a-uuid').expect(400);

    await http()
      .post('/v1/safety/blocks')
      .set(target.auth as Record<string, string>)
      .send({ user_id: viewer.id })
      .expect(204);
    const blockedByThem = await view(viewer, target.id).expect(404);
    expect(blockedByThem.body.error.code).toBe('NOT_FOUND'); // same answer as "doesn't exist"
    await http()
      .delete(`/v1/safety/blocks/${viewer.id}`)
      .set(target.auth as Record<string, string>)
      .expect(204);
    await view(viewer, target.id).expect(200);

    for (const data of [{ status: 'BANNED' as const }, { status: 'SUSPENDED' as const }, { deletedAt: new Date() }]) {
      await prisma.user.update({ where: { id: target.id }, data });
      await view(viewer, target.id).expect(404);
      await prisma.user.update({ where: { id: target.id }, data: { status: 'ACTIVE', deletedAt: null } });
    }
  });

  it('a paused member stays visible to their match only; an ended match hides both ways', async () => {
    const a = await member();
    const b = await member();
    const stranger = await member();
    const matchId = await makeMatch(a, b);
    expect((await view(a, b.id).expect(200)).body.match_id).toBe(matchId);

    await prisma.user.update({ where: { id: b.id }, data: { status: 'PAUSED' } });
    await view(a, b.id).expect(200);
    await view(stranger, b.id).expect(404);

    await http()
      .delete(`/v1/matches/${matchId}`)
      .set(a.auth as Record<string, string>)
      .expect(204);
    await prisma.user.update({ where: { id: b.id }, data: { status: 'ACTIVE' } });
    await view(a, b.id).expect(404);
    await view(b, a.id).expect(404);
  });

  it('without a location on either side there is simply no distance', async () => {
    const viewer = await member();
    const target = await member();
    await prisma.$executeRaw`UPDATE profiles SET location = NULL WHERE user_id = ${viewer.id}::uuid`;
    expect((await view(viewer, target.id).expect(200)).body.distance).toBeNull();
  });
});
