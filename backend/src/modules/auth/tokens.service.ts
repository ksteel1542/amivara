import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  randomUUID,
  sign,
  verify,
} from 'node:crypto';

import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ApiError } from '../../common/api-error';
import type { Env } from '../../config/env';

const ISSUER = 'amivara';
const AUDIENCE = 'amivara-api';
const HEADER = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url');

/** Access tokens are short-lived; sessions are long-lived through rotating refresh tokens. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
/** A signup token lets a phone-verified (but not yet registered) person finish onboarding. */
export const SIGNUP_TOKEN_TTL_SECONDS = 30 * 60;

export interface AccessClaims {
  use: 'access';
  sub: string; // user id
  sid: string; // device session id
}

export interface SignupClaims {
  use: 'signup';
  sub: string; // verified phone number (E.164)
  dvh?: string; // device hash at verification time
}

type Claims = AccessClaims | SignupClaims;
type Registered = { iss: string; aud: string; iat: number; exp: number; jti: string };

/**
 * ES256 JWTs on Node's crypto (no third-party JWT library).
 * - The algorithm is fixed: the header is never trusted, so `alg: none` / HS256 confusion is impossible.
 * - Every token carries `use`, and verification requires the expected one, so a
 *   signup token can never be used as an access token or the reverse.
 */
@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;

  constructor(config: ConfigService<Env, true>) {
    const privatePem = config.get('JWT_PRIVATE_KEY_PEM', { infer: true });
    const publicPem = config.get('JWT_PUBLIC_KEY_PEM', { infer: true });

    if (privatePem && publicPem) {
      this.privateKey = createPrivateKey(privatePem);
      this.publicKey = createPublicKey(publicPem);
    } else {
      // env.ts requires both keys in staging/production; this branch is dev/test only.
      const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      this.privateKey = pair.privateKey;
      this.publicKey = pair.publicKey;
      if (config.get('NODE_ENV', { infer: true }) === 'development') {
        this.logger.warn('JWT keys not set: using an ephemeral key pair (tokens die on restart)');
      }
    }

    const details = this.privateKey.asymmetricKeyDetails;
    if (this.privateKey.asymmetricKeyType !== 'ec' || details?.namedCurve !== 'prime256v1') {
      throw new Error('JWT_PRIVATE_KEY_PEM must be an EC P-256 key (ES256)');
    }
  }

  issueAccess(userId: string, sessionId: string, nowSeconds = epoch()): string {
    return this.sign({ use: 'access', sub: userId, sid: sessionId }, ACCESS_TOKEN_TTL_SECONDS, nowSeconds);
  }

  issueSignup(phoneE164: string, deviceHash: string | undefined, nowSeconds = epoch()): string {
    const claims: SignupClaims = { use: 'signup', sub: phoneE164, ...(deviceHash ? { dvh: deviceHash } : {}) };
    return this.sign(claims, SIGNUP_TOKEN_TTL_SECONDS, nowSeconds);
  }

  verifyAccess(token: string, nowSeconds = epoch()): AccessClaims {
    const claims = this.verify(token, nowSeconds);
    if (claims.use !== 'access' || typeof claims.sid !== 'string') throw invalid();
    return claims;
  }

  verifySignup(token: string, nowSeconds = epoch()): SignupClaims {
    const claims = this.verify(token, nowSeconds);
    if (claims.use !== 'signup') throw invalid();
    return claims;
  }

  private sign(claims: Claims, ttlSeconds: number, now: number): string {
    const payload: Claims & Registered = {
      ...claims,
      iss: ISSUER,
      aud: AUDIENCE,
      iat: now,
      exp: now + ttlSeconds,
      jti: randomUUID(),
    };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signingInput = `${HEADER}.${body}`;
    const signature = sign('sha256', Buffer.from(signingInput), { key: this.privateKey, dsaEncoding: 'ieee-p1363' });
    return `${signingInput}.${signature.toString('base64url')}`;
  }

  private verify(token: string, now: number): Claims & Registered {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== HEADER) throw invalid();

    const signature = Buffer.from(parts[2], 'base64url');
    const ok =
      signature.length === 64 &&
      verify(
        'sha256',
        Buffer.from(`${parts[0]}.${parts[1]}`),
        { key: this.publicKey, dsaEncoding: 'ieee-p1363' },
        signature,
      );
    if (!ok) throw invalid();

    let payload: Claims & Registered;
    try {
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Claims & Registered;
    } catch {
      throw invalid();
    }
    if (payload.iss !== ISSUER || payload.aud !== AUDIENCE || typeof payload.sub !== 'string') throw invalid();
    if (typeof payload.exp !== 'number' || payload.exp <= now) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'INVALID_TOKEN', 'Your session has expired.', { reason: 'expired' });
    }
    if (typeof payload.iat !== 'number' || payload.iat > now + 60) throw invalid();
    return payload;
  }
}

function epoch(): number {
  return Math.floor(Date.now() / 1000);
}

function invalid(): ApiError {
  return new ApiError(HttpStatus.UNAUTHORIZED, 'INVALID_TOKEN', 'Your session is not valid. Please sign in again.');
}
