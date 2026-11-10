import { generateKeyPairSync } from 'node:crypto';

import { type ConfigService } from '@nestjs/config';

import { ApiError } from '../../common/api-error';
import type { Env } from '../../config/env';
import { ACCESS_TOKEN_TTL_SECONDS, TokensService } from './tokens.service';

function config(values: Partial<Env>): ConfigService<Env, true> {
  return { get: (key: keyof Env) => values[key] } as unknown as ConfigService<Env, true>;
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof ApiError ? e.code : 'non-api-error';
  }
  return undefined;
}

describe('TokensService (ES256 JWT)', () => {
  const tokens = new TokensService(config({ NODE_ENV: 'test' }));
  const now = 1_800_000_000;

  it('round-trips an access token', () => {
    const jwt = tokens.issueAccess('user-1', 'session-1', now);
    expect(tokens.verifyAccess(jwt, now + 10)).toMatchObject({ use: 'access', sub: 'user-1', sid: 'session-1' });
  });

  it('round-trips a signup token', () => {
    const jwt = tokens.issueSignup('+2348012345678', 'devhash', now);
    expect(tokens.verifySignup(jwt, now)).toMatchObject({ use: 'signup', sub: '+2348012345678', dvh: 'devhash' });
  });

  it('never accepts a signup token as an access token, or the reverse', () => {
    expect(codeOf(() => tokens.verifyAccess(tokens.issueSignup('+2348012345678', undefined, now), now))).toBe(
      'INVALID_TOKEN',
    );
    expect(codeOf(() => tokens.verifySignup(tokens.issueAccess('u', 's', now), now))).toBe('INVALID_TOKEN');
  });

  it('rejects expired tokens', () => {
    const jwt = tokens.issueAccess('u', 's', now);
    expect(() => tokens.verifyAccess(jwt, now + ACCESS_TOKEN_TTL_SECONDS)).toThrow(/expired/);
  });

  it('rejects a tampered payload', () => {
    const [h, p, s] = tokens.issueAccess('user-1', 'session-1', now).split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), sub: 'admin' }),
    ).toString('base64url');
    expect(codeOf(() => tokens.verifyAccess(`${h}.${forged}.${s}`, now))).toBe('INVALID_TOKEN');
  });

  it('rejects alg=none and any other header', () => {
    const [, p] = tokens.issueAccess('u', 's', now).split('.');
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    expect(codeOf(() => tokens.verifyAccess(`${none}.${p}.`, now))).toBe('INVALID_TOKEN');
  });

  it('rejects tokens signed by a different key', () => {
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const foreign = new TokensService(
      config({
        NODE_ENV: 'test',
        JWT_PRIVATE_KEY_PEM: other.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        JWT_PUBLIC_KEY_PEM: other.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      }),
    );
    expect(codeOf(() => tokens.verifyAccess(foreign.issueAccess('u', 's', now), now))).toBe('INVALID_TOKEN');
  });

  it('refuses a non-P-256 signing key', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(
      () =>
        new TokensService(
          config({
            NODE_ENV: 'test',
            JWT_PRIVATE_KEY_PEM: rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
            JWT_PUBLIC_KEY_PEM: rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
          }),
        ),
    ).toThrow(/P-256/);
  });
});
