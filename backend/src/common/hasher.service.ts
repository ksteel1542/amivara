import { randomBytes } from 'node:crypto';

import { Global, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env';
import { hmacHex } from './crypto';

/**
 * Keyed hashing for values we need to match later but must not store:
 * OTP codes, IP addresses, device ids and the phones of blocked signups.
 */
@Injectable()
export class HasherService {
  private readonly pepper: string;

  constructor(config: ConfigService<Env, true>) {
    // env.ts requires HASH_PEPPER in staging/production. Dev/test fall back to a
    // per-process random pepper (rate limits and blocks reset on restart).
    this.pepper = config.get('HASH_PEPPER', { infer: true }) ?? randomBytes(32).toString('hex');
  }

  hash(kind: 'otp' | 'ip' | 'device' | 'phone', value: string): string {
    return hmacHex(this.pepper, `${kind}:${value}`);
  }

  hashOptional(kind: 'ip' | 'device', value: string | undefined): string | undefined {
    return value ? this.hash(kind, value) : undefined;
  }
}

@Global()
@Module({ providers: [HasherService], exports: [HasherService] })
export class HasherModule {}
