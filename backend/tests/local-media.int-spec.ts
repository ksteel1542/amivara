import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { OTP_SENDER } from '../src/modules/auth/otp-sender';
import { LocalDiskMediaStorage } from '../src/modules/media/local-disk-storage';
import { MEDIA_STORAGE } from '../src/modules/media/media-storage';
import { PrismaService } from '../src/prisma/prisma.service';
import { CapturingSender, createMember, jpegBytes, pngBytes } from './support/members';

/**
 * Local photo storage (MEDIA_LOCAL_DIR) for development without S3: the same
 * upload-url → POST file → confirm → signed view URL flow the app uses with S3,
 * with real files on disk.
 */
describe('Local photo storage (integration, disk)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let dir: string;
  const otp = new CapturingSender();

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'amivara-media-'));
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OTP_SENDER)
      .useValue(otp)
      .overrideProvider(MEDIA_STORAGE)
      .useValue(new LocalDiskMediaStorage(dir, 'http://localhost:4000/v1', 'test-secret'))
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
    await rm(dir, { recursive: true, force: true });
  });

  const http = () => request(app.getHttpServer());
  /** The path part of an absolute URL the API handed out (the phone reaches it via localhost:4000). */
  const path = (url: string) => new URL(url).pathname + new URL(url).search;

  async function ticket(auth: Record<string, string>) {
    const res = await http().post('/v1/media/upload-url').set(auth).send({ content_type: 'image/jpeg' }).expect(201);
    return res.body as {
      photo_id: string;
      upload: { url: string; fields: Record<string, string>; file_field: string };
    };
  }

  function post(t: Awaited<ReturnType<typeof ticket>>, bytes: Uint8Array, fields = t.upload.fields) {
    let req = http().post(path(t.upload.url));
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req.attach(t.upload.file_field, Buffer.from(bytes), 'photo.jpg');
  }

  it('uploads, confirms and serves a photo through signed URLs', async () => {
    const auth = { Authorization: `Bearer ${await createMember(app, otp)}` };
    const t = await ticket(auth);
    expect(t.upload.url).toBe('http://localhost:4000/v1/media/local/upload');

    const photo = jpegBytes(4096);
    await post(t, photo).expect(204);
    const confirmed = await http().post(`/v1/media/photos/${t.photo_id}/confirm`).set(auth).expect(200);
    const url = confirmed.body.photos[0].url as string;
    expect(url).toMatch(/^http:\/\/localhost:4000\/v1\/media\/local\/file\?key=photos%2F/);

    const served = await http().get(path(url)).buffer(true).expect(200);
    expect(served.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.compare(served.body as Buffer, Buffer.from(photo))).toBe(0);

    // Tampered or unsigned view links are refused.
    await http()
      .get(path(url).replace(/sig=[^&]+/, 'sig=forged'))
      .expect(403);
    await http().get('/v1/media/local/file?key=photos%2Fx.jpg').expect(403);

    // Deleting the photo removes the file.
    await http().delete(`/v1/media/photos/${t.photo_id}`).set(auth).expect(200);
    const left = await readdir(dir, { recursive: true });
    expect(left.filter((f) => String(f).endsWith('.jpg'))).toEqual([]);
  });

  it('refuses forged tokens, other content types, oversize files and fake images', async () => {
    const auth = { Authorization: `Bearer ${await createMember(app, otp)}` };
    const t = await ticket(auth);
    await post(t, jpegBytes(), { ...t.upload.fields, token: 'forged.token' }).expect(403);
    await post(t, jpegBytes(), { ...t.upload.fields, 'Content-Type': 'image/webp' }).expect(403);
    await post(t, new Uint8Array(1_600_000)).expect(413);

    // Accepted by the upload route, but confirm checks the real bytes.
    await post(t, pngBytes()).expect(204);
    await http().post(`/v1/media/photos/${t.photo_id}/confirm`).set(auth).expect(422); // INVALID_IMAGE
  });

  it('keys can never escape the media directory', () => {
    const storage = app.get<LocalDiskMediaStorage>(MEDIA_STORAGE);
    for (const key of ['../secret', 'photos/../../x', '/etc/passwd', 'photos\\..\\x', '']) {
      expect(() => storage.pathFor(key)).toThrow('Invalid media key');
    }
  });
});
