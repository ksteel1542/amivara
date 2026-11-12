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
/** ~111 km per degree of latitude. */
const north = (km: number) => ({ lat: LAGOS.lat + km / 111.32, lng: LAGOS.lng });

/** GET/PATCH /v1/me/preferences, and that discovery follows them. */
describe('Discovery preferences (integration, PostgreSQL + PostGIS)', () => {
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

  /** A verified member in discovery. Onboarding makes her 27, woman, into men, 22–32, 50 km. */
  async function member(gender: 'WOMAN' | 'MAN', into: 'WOMAN' | 'MAN', at = LAGOS) {
    const token = await createMember(app, otp);
    const auth = { Authorization: `Bearer ${token}` };
    const me = await http().get('/v1/me').set(auth).expect(200);
    const id = me.body.id as string;
    await prisma.user.update({ where: { id }, data: { ageVerified: true } });
    await prisma.profile.update({ where: { userId: id }, data: { gender } });
    await prisma.preference.update({ where: { userId: id }, data: { interestedIn: [into] } });
    await prisma.profilePhoto.create({
      data: {
        userId: id,
        storageKey: `photos/${id}/0.jpg`,
        contentType: 'image/jpeg',
        status: 'UPLOADED',
        position: 0,
      },
    });
    await app.get(GeoRepository).setLocation(id, at.lat, at.lng);
    return { id, auth };
  }

  const feed = async (auth: Record<string, string>): Promise<string[]> =>
    (await http().get('/v1/discovery').set(auth).expect(200)).body.cards.map((c: { user_id: string }) => c.user_id);

  it('returns the onboarding defaults and updates them', async () => {
    const token = await createMember(app, otp);
    const auth = { Authorization: `Bearer ${token}` };
    const got = await http().get('/v1/me/preferences').set(auth).expect(200);
    expect(got.body).toEqual({ interested_in: ['man'], age_min: 22, age_max: 32, max_distance_km: 50 });

    const res = await http()
      .patch('/v1/me/preferences')
      .set(auth)
      .send({ interested_in: ['man', 'woman'], age_min: 25, age_max: 40, max_distance_km: 120 })
      .expect(200);
    expect(res.body).toEqual({ interested_in: ['man', 'woman'], age_min: 25, age_max: 40, max_distance_km: 120 });

    // Partial update keeps the rest.
    const partial = await http().patch('/v1/me/preferences').set(auth).send({ max_distance_km: 10 }).expect(200);
    expect(partial.body).toEqual({ interested_in: ['man', 'woman'], age_min: 25, age_max: 40, max_distance_km: 10 });
    await http().get('/v1/me/preferences').expect(401);
  });

  it('validates every field, including the merged age range', async () => {
    const auth = { Authorization: `Bearer ${await createMember(app, otp)}` };
    const bad = [
      {},
      { age_min: 17 },
      { age_max: 100 },
      { age_min: 25.5 },
      { max_distance_km: 0 },
      { max_distance_km: 301 },
      { interested_in: [] },
      { interested_in: ['robot'] },
      { interested_in: ['man', 'man'] },
      { incognito: true },
    ];
    for (const body of bad) await http().patch('/v1/me/preferences').set(auth).send(body).expect(400);

    // age_max below the stored age_min (22) is rejected even when sent alone.
    const res = await http().patch('/v1/me/preferences').set(auth).send({ age_max: 20 }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect((await http().get('/v1/me/preferences').set(auth).expect(200)).body.age_max).toBe(32);
  });

  it('discovery follows the new age range and distance', async () => {
    const viewer = await member('WOMAN', 'MAN');
    const near = await member('MAN', 'WOMAN', north(5));
    const far = await member('MAN', 'WOMAN', north(40));
    // `far` must also be willing to look 40 km out (both radii apply).
    expect(await feed(viewer.auth)).toEqual(expect.arrayContaining([near.id, far.id]));

    await http().patch('/v1/me/preferences').set(viewer.auth).send({ max_distance_km: 20 }).expect(200);
    const within20 = await feed(viewer.auth);
    expect(within20).toContain(near.id);
    expect(within20).not.toContain(far.id);

    // Everyone here is 27: an age range of 30–40 excludes them all.
    await http().patch('/v1/me/preferences').set(viewer.auth).send({ age_min: 30, age_max: 40 }).expect(200);
    expect(await feed(viewer.auth)).toEqual([]);
  });
});
