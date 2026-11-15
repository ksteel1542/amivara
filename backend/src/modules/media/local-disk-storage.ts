import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

import {
  type MediaStorage,
  type PresignedUpload,
  type StoredObject,
  UPLOAD_URL_TTL_SECONDS,
  VIEW_URL_TTL_SECONDS,
} from './media-storage';

/** What a signed upload ticket allows: one key, one content type, a size cap, until `exp`. */
export interface UploadGrant {
  key: string;
  contentType: string;
  maxBytes: number;
  exp: number;
}

const b64url = (s: string) => Buffer.from(s).toString('base64url');

/**
 * Photo storage on the local disk, for development and tests on a machine without
 * S3 or MinIO (MEDIA_LOCAL_DIR). It mirrors the S3 flow the app already uses:
 * a signed POST target for the file (POST /v1/media/local/upload), then
 * short-lived signed URLs to view it (GET /v1/media/local/file).
 * env.ts refuses it in staging and production.
 */
export class LocalDiskMediaStorage implements MediaStorage {
  private readonly root: string;
  private readonly secret: Buffer;

  constructor(
    dir: string,
    /** How the app reaches this API, e.g. http://localhost:4000/v1 (the phone, over adb reverse). */
    private readonly publicBaseUrl: string,
    secret?: string,
  ) {
    this.root = resolve(dir);
    this.secret = secret ? Buffer.from(secret) : randomBytes(32);
  }

  /** Absolute path for a key, refusing anything that would leave the media directory. */
  pathFor(key: string): string {
    if (!/^[A-Za-z0-9/_.-]{1,200}$/.test(key) || key.includes('..') || key.startsWith('/')) {
      throw new Error('Invalid media key');
    }
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error('Invalid media key');
    return full;
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }

  private verifySig(payload: string, sig: string): boolean {
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  async presignUpload(key: string, contentType: string, maxBytes: number): Promise<PresignedUpload> {
    this.pathFor(key);
    const grant: UploadGrant = { key, contentType, maxBytes, exp: Date.now() + UPLOAD_URL_TTL_SECONDS * 1000 };
    const payload = b64url(JSON.stringify(grant));
    return {
      url: `${this.publicBaseUrl}/media/local/upload`,
      fields: { token: `${payload}.${this.sign(`upload:${payload}`)}`, 'Content-Type': contentType },
      expiresIn: UPLOAD_URL_TTL_SECONDS,
    };
  }

  /** The grant inside a valid, unexpired upload token, or null. */
  readUploadToken(token: unknown): UploadGrant | null {
    if (typeof token !== 'string') return null;
    const [payload, sig] = token.split('.');
    if (!payload || !sig || !this.verifySig(`upload:${payload}`, sig)) return null;
    try {
      const grant = JSON.parse(Buffer.from(payload, 'base64url').toString()) as UploadGrant;
      return grant.exp > Date.now() ? grant : null;
    } catch {
      return null;
    }
  }

  async write(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const file = this.pathFor(key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
    await writeFile(`${file}.meta.json`, JSON.stringify({ contentType }));
  }

  async head(key: string): Promise<StoredObject | null> {
    const file = this.pathFor(key);
    try {
      const [info, meta] = await Promise.all([stat(file), readFile(`${file}.meta.json`, 'utf8')]);
      return { size: info.size, contentType: (JSON.parse(meta) as { contentType?: string }).contentType };
    } catch {
      return null;
    }
  }

  async readPrefix(key: string, bytes: number): Promise<Uint8Array> {
    const handle = await open(this.pathFor(key), 'r');
    try {
      const buf = Buffer.alloc(bytes);
      const { bytesRead } = await handle.read(buf, 0, bytes, 0);
      return new Uint8Array(buf.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  }

  async read(key: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    const object = await this.head(key);
    if (!object) return null;
    return { bytes: await readFile(this.pathFor(key)), contentType: object.contentType ?? 'application/octet-stream' };
  }

  async delete(key: string): Promise<void> {
    const file = this.pathFor(key);
    await rm(file, { force: true });
    await rm(`${file}.meta.json`, { force: true });
  }

  async viewUrl(key: string): Promise<string> {
    this.pathFor(key);
    const exp = Date.now() + VIEW_URL_TTL_SECONDS * 1000;
    const sig = this.sign(`view:${key}:${exp}`);
    return `${this.publicBaseUrl}/media/local/file?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sig}`;
  }

  /** True when a view URL's signature is valid and unexpired. */
  checkView(key: unknown, exp: unknown, sig: unknown): key is string {
    if (typeof key !== 'string' || typeof exp !== 'string' || typeof sig !== 'string') return false;
    const expires = Number(exp);
    return Number.isFinite(expires) && expires > Date.now() && this.verifySig(`view:${key}:${expires}`, sig);
  }
}
