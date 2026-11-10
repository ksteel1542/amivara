import { type INestApplication } from '@nestjs/common';
import request from 'supertest';

import type { MediaStorage, PresignedUpload, StoredObject } from '../../src/modules/media/media-storage';
import type { OtpSender } from '../../src/modules/auth/otp-sender';

/** Captures OTP codes instead of sending them. */
export class CapturingSender implements OtpSender {
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

/** In-memory stand-in for the S3 media bucket. Tests "upload" with put(). */
export class FakeMediaStorage implements MediaStorage {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  readonly deleted: string[] = [];

  async presignUpload(key: string, contentType: string, maxBytes: number): Promise<PresignedUpload> {
    return {
      url: 'https://media-bucket.example.test/',
      fields: { key, 'Content-Type': contentType, 'x-max-bytes': String(maxBytes) },
      expiresIn: 600,
    };
  }
  async head(key: string): Promise<StoredObject | null> {
    const o = this.objects.get(key);
    return o ? { size: o.bytes.length, contentType: o.contentType } : null;
  }
  async readPrefix(key: string, bytes: number): Promise<Uint8Array> {
    return (this.objects.get(key)?.bytes ?? new Uint8Array()).slice(0, bytes);
  }
  async delete(key: string): Promise<void> {
    this.deleted.push(key);
    this.objects.delete(key);
  }
  async viewUrl(key: string): Promise<string> {
    return `https://media.example.test/${key}?signed=1`;
  }
  put(key: string, bytes: Uint8Array, contentType = 'image/jpeg'): void {
    this.objects.set(key, { bytes, contentType });
  }
}

/** A tiny valid-looking JPEG (signature + padding). */
export function jpegBytes(size = 2048): Uint8Array {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return b;
}

export function pngBytes(): Uint8Array {
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
}

let counter = 0;

/** Signs up a fresh member through the real OTP + onboarding endpoints. Returns an access token. */
export async function createMember(app: INestApplication, sender: CapturingSender): Promise<string> {
  return (await createMemberDetailed(app, sender)).token;
}

/** Like createMember, also returning the phone (national format) and X-Device-Id it signed up with. */
export async function createMemberDetailed(
  app: INestApplication,
  sender: CapturingSender,
): Promise<{ token: string; phone: string; device: string }> {
  counter += 1;
  const phone = `0803${String(1_000_000 + counter).slice(-7)}`;
  const device = `test-device-${String(counter).padStart(4, '0')}`;
  const http = () => request(app.getHttpServer());

  const otp = await http().post('/v1/auth/otp/request').set('X-Device-Id', device).send({ phone }).expect(202);
  const verified = await http()
    .post('/v1/auth/otp/verify')
    .set('X-Device-Id', device)
    .send({ challenge_id: otp.body.challenge_id, code: sender.lastCode() })
    .expect(200);
  const dob = new Date();
  dob.setUTCFullYear(dob.getUTCFullYear() - 27);
  const done = await http()
    .post('/v1/onboarding/complete')
    .set('Authorization', `Bearer ${verified.body.signup_token}`)
    .set('X-Device-Id', device)
    .send({
      first_name: 'Chidinma',
      date_of_birth: dob.toISOString().slice(0, 10),
      gender: 'woman',
      interested_in: ['man'],
      intent: 'relationship',
    })
    .expect(201);
  return { token: done.body.access_token as string, phone, device };
}
