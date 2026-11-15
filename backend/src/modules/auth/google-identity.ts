import { createPublicKey, type JsonWebKey, type KeyObject, verify } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ApiError } from '../../common/api-error';
import type { Env } from '../../config/env';
import { normalizeEmail } from './identity';

const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const CLOCK_SKEW_SECONDS = 60;

/** Google's token-signing keys, by key id. Swapped for a local key in tests. */
export interface GoogleKeySource {
  key(kid: string): Promise<KeyObject | undefined>;
}
export const GOOGLE_KEYS = Symbol('GOOGLE_KEYS');

/** Google's public JWKS, cached for as long as Google's Cache-Control allows. */
@Injectable()
export class HttpGoogleKeySource implements GoogleKeySource {
  private keys = new Map<string, KeyObject>();
  private expiresAt = 0;

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async key(kid: string): Promise<KeyObject | undefined> {
    if (Date.now() >= this.expiresAt || !this.keys.has(kid)) await this.refresh();
    return this.keys.get(kid);
  }

  private async refresh(): Promise<void> {
    const res = await this.fetchImpl('https://www.googleapis.com/oauth2/v3/certs');
    if (!res.ok) throw new Error(`Google JWKS ${res.status}`);
    const body = (await res.json()) as { keys: Array<JsonWebKey & { kid: string }> };
    this.keys = new Map(body.keys.map((k) => [k.kid, createPublicKey({ key: k, format: 'jwk' })]));
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
    this.expiresAt = Date.now() + maxAge * 1000;
  }
}

/**
 * Verifies a Google Sign-In ID token (RS256 JWT) and returns the member's
 * Google-verified email. Off (503 GOOGLE_SIGNIN_UNAVAILABLE) until
 * GOOGLE_CLIENT_IDS lists the app's OAuth client ids.
 */
@Injectable()
export class GoogleIdentityService {
  private readonly clientIds: Set<string>;

  constructor(
    @Inject(GOOGLE_KEYS) private readonly keys: GoogleKeySource,
    config: ConfigService<Env, true>,
  ) {
    const raw = config.get('GOOGLE_CLIENT_IDS', { infer: true }) ?? '';
    this.clientIds = new Set(
      raw
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean),
    );
  }

  get enabled(): boolean {
    return this.clientIds.size > 0;
  }

  async verifiedEmail(idToken: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
    if (!this.enabled) {
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'GOOGLE_SIGNIN_UNAVAILABLE',
        'Google sign-in is not available yet.',
      );
    }
    const invalid = () =>
      new ApiError(HttpStatus.UNAUTHORIZED, 'INVALID_GOOGLE_TOKEN', 'Google sign-in failed. Try again.');
    const parts = idToken.split('.');
    if (parts.length !== 3) throw invalid();
    const [h, p, s] = parts as [string, string, string];

    let header: { alg?: string; kid?: string };
    let claims: {
      iss?: string;
      aud?: string;
      exp?: number;
      iat?: number;
      email?: string;
      email_verified?: boolean | string;
    };
    try {
      header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
      claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    } catch {
      throw invalid();
    }
    if (header.alg !== 'RS256' || !header.kid) throw invalid();

    const key = await this.keys.key(header.kid).catch(() => undefined);
    if (!key) throw invalid();
    const ok = verify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'));
    if (!ok) throw invalid();

    if (!claims.iss || !ISSUERS.has(claims.iss)) throw invalid();
    if (!claims.aud || !this.clientIds.has(claims.aud)) throw invalid();
    if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < nowSeconds) throw invalid();
    if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_SECONDS > nowSeconds) throw invalid();
    if (!claims.email || !(claims.email_verified === true || claims.email_verified === 'true')) {
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        'INVALID_GOOGLE_TOKEN',
        'Your Google account email is not verified. Use your email address instead.',
      );
    }
    return normalizeEmail(claims.email);
  }
}
