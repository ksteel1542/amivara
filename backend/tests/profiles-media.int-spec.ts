import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { OTP_SENDER } from '../src/modules/auth/otp-sender';
import { MEDIA_STORAGE } from '../src/modules/media/media-storage';
import { PrismaService } from '../src/prisma/prisma.service';
import { CapturingSender, createMember, FakeMediaStorage, jpegBytes, pngBytes } from './support/members';

/**
 * Sprint 2 integration tests: profile editing, photo uploads (S3 replaced by
 * an in-memory store) and PostGIS location, against real PostgreSQL + PostGIS.
 */
describe('Profiles, photos and location (integration, PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sender = new CapturingSender();
  const storage = new FakeMediaStorage();
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OTP_SENDER)
      .useValue(sender)
      .overrideProvider(MEDIA_STORAGE)
      .useValue(storage)
      .compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    storage.objects.clear();
    await prisma.$executeRaw`TRUNCATE users, otp_challenges, signup_blocks RESTART IDENTITY CASCADE`;
    token = await createMember(app, sender);
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  /** upload-url → simulated direct-to-S3 POST → confirm. Returns the photo id. */
  async function addPhoto(bytes: Uint8Array = jpegBytes()): Promise<string> {
    const res = await http().post('/v1/media/upload-url').set(auth()).send({ content_type: 'image/jpeg' }).expect(201);
    storage.put(res.body.upload.fields.key, bytes);
    await http().post(`/v1/media/photos/${res.body.photo_id}/confirm`).set(auth()).expect(200);
    return res.body.photo_id;
  }

  // ── Media: upload URLs ────────────────────────────────────

  it('issues a presigned POST for a direct-to-S3 upload', async () => {
    const res = await http().post('/v1/media/upload-url').set(auth()).send({ content_type: 'image/jpeg' }).expect(201);
    expect(res.body).toMatchObject({
      upload: { method: 'POST', url: 'https://media-bucket.example.test/', file_field: 'file' },
      max_bytes: 1_500_000,
      expires_in: 600,
    });
    const key: string = res.body.upload.fields.key;
    expect(key).toMatch(new RegExp(`^photos/[0-9a-f-]{36}/${res.body.photo_id}\\.jpg$`));

    const row = await prisma.profilePhoto.findUniqueOrThrow({ where: { id: res.body.photo_id } });
    expect(row).toMatchObject({ status: 'PENDING_UPLOAD', position: null, contentType: 'image/jpeg' });
  });

  it('rejects unsupported content types and requires sign-in', async () => {
    const bad = await http().post('/v1/media/upload-url').set(auth()).send({ content_type: 'image/png' }).expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    await http().post('/v1/media/upload-url').send({ content_type: 'image/jpeg' }).expect(401);
  });

  it('confirm fails until the object exists, and rejects files that are not really JPEG/WebP', async () => {
    const res = await http().post('/v1/media/upload-url').set(auth()).send({ content_type: 'image/jpeg' }).expect(201);
    const missing = await http().post(`/v1/media/photos/${res.body.photo_id}/confirm`).set(auth()).expect(409);
    expect(missing.body.error.code).toBe('UPLOAD_NOT_FOUND');

    // A PNG uploaded with a JPEG content type is discarded (row and object).
    storage.put(res.body.upload.fields.key, pngBytes());
    const invalid = await http().post(`/v1/media/photos/${res.body.photo_id}/confirm`).set(auth()).expect(422);
    expect(invalid.body.error.code).toBe('INVALID_IMAGE');
    expect(await prisma.profilePhoto.count()).toBe(0);
    expect(storage.deleted).toContain(res.body.upload.fields.key);
  });

  it('rejects an oversized file even if S3 accepted it', async () => {
    const res = await http().post('/v1/media/upload-url').set(auth()).send({ content_type: 'image/jpeg' }).expect(201);
    storage.put(res.body.upload.fields.key, jpegBytes(1_500_001));
    const big = await http().post(`/v1/media/photos/${res.body.photo_id}/confirm`).set(auth()).expect(422);
    expect(big.body.error.code).toBe('INVALID_IMAGE');
  });

  it('fills slots in order, caps at 6 photos and returns signed view URLs', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(await addPhoto());

    const list = await http().get('/v1/media/photos').set(auth()).expect(200);
    expect(list.body.photos.map((p: { id: string }) => p.id)).toEqual(ids);
    expect(list.body.photos[0]).toMatchObject({ position: 0, is_primary: true, moderation_status: 'pending' });
    expect(list.body.photos[0].url).toMatch(/^https:\/\/media\.example\.test\/photos\/.+\?signed=1$/);

    const seventh = await http()
      .post('/v1/media/upload-url')
      .set(auth())
      .send({ content_type: 'image/jpeg' })
      .expect(409);
    expect(seventh.body.error.code).toBe('PHOTO_LIMIT');
  });

  it('reorders, sets the primary photo and keeps at least 2 photos', async () => {
    const [a, b, c] = [await addPhoto(), await addPhoto(), await addPhoto()];

    const reordered = await http()
      .put('/v1/media/photos/order')
      .set(auth())
      .send({ photo_ids: [c, a, b] })
      .expect(200);
    expect(reordered.body.photos.map((p: { id: string }) => p.id)).toEqual([c, a, b]);

    // Order must list every photo exactly once.
    await http()
      .put('/v1/media/photos/order')
      .set(auth())
      .send({ photo_ids: [c, a] })
      .expect(400);
    await http()
      .put('/v1/media/photos/order')
      .set(auth())
      .send({ photo_ids: [c, a, a] })
      .expect(400);

    const primary = await http().put(`/v1/media/photos/${b}/primary`).set(auth()).expect(200);
    expect(primary.body.photos.map((p: { id: string }) => p.id)).toEqual([b, c, a]);
    expect(primary.body.photos[0].is_primary).toBe(true);

    const removed = await http().delete(`/v1/media/photos/${c}`).set(auth()).expect(200);
    expect(removed.body.photos.map((p: { id: string; position: number }) => [p.id, p.position])).toEqual([
      [b, 0],
      [a, 1],
    ]);

    const tooFew = await http().delete(`/v1/media/photos/${a}`).set(auth()).expect(409);
    expect(tooFew.body.error.code).toBe('MIN_PHOTOS');
  });

  it("cannot touch another member's photos", async () => {
    const mine = await addPhoto();
    token = await createMember(app, sender);
    await http().put(`/v1/media/photos/${mine}/primary`).set(auth()).expect(404);
    await http().delete(`/v1/media/photos/${mine}`).set(auth()).expect(404);
  });

  // ── Profile editing ───────────────────────────────────────

  it('updates bio, intent, prompts, interests, languages and height', async () => {
    const res = await http()
      .patch('/v1/profiles/me')
      .set(auth())
      .send({
        bio: '  Lagos girl, Abuja heart. Ask me about jollof.  ',
        intent: 'friendship',
        prompts: [
          { prompt_id: 'perfect_sunday', answer: 'Church, then suya at Wuse.' },
          { prompt_id: 'jollof_take', answer: 'Party jollof beats every other kind.' },
        ],
        interests: ['afrobeats', 'nollywood', 'cooking'],
        languages: ['en', 'yo', 'pcm'],
        height_cm: 168,
      })
      .expect(200);

    expect(res.body).toMatchObject({
      bio: 'Lagos girl, Abuja heart. Ask me about jollof.',
      intent: 'friendship',
      interests: ['afrobeats', 'nollywood', 'cooking'],
      languages: ['en', 'yo', 'pcm'],
      height_cm: 168,
      has_location: false,
    });
    expect(res.body.prompts).toHaveLength(2);
    expect(res.body.completeness).toBeGreaterThan(0);

    // Partial update leaves other fields alone; empty string clears a field.
    const cleared = await http().patch('/v1/profiles/me').set(auth()).send({ bio: '' }).expect(200);
    expect(cleared.body.bio).toBeNull();
    expect(cleared.body.intent).toBe('friendship');
  });

  it.each([
    [
      'more than 5 prompts',
      {
        prompts: ['perfect_sunday', 'green_flag', 'jollof_take', 'love_language', 'proud_of', 'first_date'].map(
          (id) => ({ prompt_id: id, answer: 'x' }),
        ),
      },
    ],
    ['an unknown prompt', { prompts: [{ prompt_id: 'made_up', answer: 'x' }] }],
    [
      'a duplicated prompt',
      {
        prompts: [
          { prompt_id: 'green_flag', answer: 'a' },
          { prompt_id: 'green_flag', answer: 'b' },
        ],
      },
    ],
    ['a height below the minimum', { height_cm: 90 }],
    ['an invalid intent', { intent: 'hookup' }],
    ['an unknown interest', { interests: ['crypto-scams'] }],
    ['a bio over 500 characters', { bio: 'a'.repeat(501) }],
    ['an unknown field', { age_verified: true }],
  ])('rejects %s', async (_label, body) => {
    const res = await http().patch('/v1/profiles/me').set(auth()).send(body).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('serves the catalogue the editor needs', async () => {
    const res = await http().get('/v1/profiles/catalog').set(auth()).expect(200);
    expect(res.body.limits).toMatchObject({ prompts: 5, photos: { min: 2, max: 6 } });
    expect(res.body.prompts.length).toBeGreaterThanOrEqual(5);
    expect(res.body.languages).toEqual(expect.arrayContaining([{ code: 'pcm', name: 'Pidgin' }]));
  });

  // ── Location (PostGIS) ────────────────────────────────────

  it('stores the location rounded to ~100 m and never returns it', async () => {
    await http()
      .put('/v1/profiles/me/location')
      .set(auth())
      .send({ lat: 6.524379, lng: 3.379206, accuracy_m: 12 })
      .expect(204);

    const rows = await prisma.$queryRaw<Array<{ lat: number; lng: number; geohash5: string }>>`
      SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, geohash5 FROM profiles`;
    expect(rows).toHaveLength(1);
    expect(rows[0].lat).toBeCloseTo(6.524, 6);
    expect(rows[0].lng).toBeCloseTo(3.379, 6);
    expect(rows[0].geohash5).toBe('s14mh'); // Lagos Island cell (~5 km)

    const me = await http().get('/v1/profiles/me').set(auth()).expect(200);
    expect(me.body.has_location).toBe(true);
    expect(JSON.stringify(me.body)).not.toContain('6.524');
  });

  it.each([
    ['latitude out of range', { lat: 91, lng: 3 }],
    ['null island (no fix)', { lat: 0, lng: 0 }],
    ['non-numbers', { lat: '6.5', lng: '3.4' }],
  ])('rejects %s', async (_label, body) => {
    await http().put('/v1/profiles/me/location').set(auth()).send(body).expect(400);
  });
});
