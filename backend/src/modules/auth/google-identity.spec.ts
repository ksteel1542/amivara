import { generateKeyPairSync, type KeyObject, sign } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { ApiError } from '../../common/api-error';
import type { Env } from '../../config/env';
import { GoogleIdentityService, type GoogleKeySource } from './google-identity';

const CLIENT = 'amivara-android.apps.googleusercontent.com';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const NOW = 1_800_000_000;

const keys: GoogleKeySource = { key: async (kid: string) => (kid === 'k1' ? publicKey : undefined) };
const config = (ids?: string) =>
  ({ get: (k: keyof Env) => (k === 'GOOGLE_CLIENT_IDS' ? ids : undefined) }) as unknown as ConfigService<Env, true>;

function token(claims: Record<string, unknown>, opts: { kid?: string; alg?: string; key?: KeyObject } = {}): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? 'k1', typ: 'JWT' });
  const body = b64({
    iss: 'https://accounts.google.com',
    aud: CLIENT,
    iat: NOW - 10,
    exp: NOW + 3600,
    email: 'Ada.Obi@Gmail.com',
    email_verified: true,
    ...claims,
  });
  const sig = sign('RSA-SHA256', Buffer.from(`${head}.${body}`), opts.key ?? privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return (e as ApiError).code;
  }
};

describe('GoogleIdentityService (Google Sign-In ID tokens)', () => {
  const svc = new GoogleIdentityService(keys, config(`${CLIENT}, other-client`));

  it('accepts a valid token and returns the lower-cased, Google-verified email', async () => {
    expect(await svc.verifiedEmail(token({}), NOW)).toBe('ada.obi@gmail.com');
  });

  it.each([
    ['a signature from another key', token({}, { key: other.privateKey })],
    ['an unknown key id', token({}, { kid: 'k9' })],
    ['a non-RS256 algorithm', token({}, { alg: 'HS256' })],
    ['another app as audience', token({ aud: 'someone-else' })],
    ['a foreign issuer', token({ iss: 'https://evil.example' })],
    ['an expired token', token({ exp: NOW - 3600 })],
    ['a token issued in the future', token({ iat: NOW + 3600 })],
    ['an unverified Google email', token({ email_verified: false })],
    ['a garbled token', 'not.a.jwt'],
  ])('rejects %s', async (_label, jwt) => {
    expect(await codeOf(svc.verifiedEmail(jwt, NOW))).toBe('INVALID_GOOGLE_TOKEN');
  });

  it('is off (503) until GOOGLE_CLIENT_IDS is configured', async () => {
    const off = new GoogleIdentityService(keys, config(undefined));
    expect(off.enabled).toBe(false);
    expect(await codeOf(off.verifiedEmail(token({}), NOW))).toBe('GOOGLE_SIGNIN_UNAVAILABLE');
  });
});
