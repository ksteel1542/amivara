import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env';

const VERSION = 'v1';

/**
 * Application-level encryption of message bodies (SECURITY.md §5): the
 * database (and its backups) only ever hold ciphertext.
 * AES-256-GCM, a fresh 96-bit IV per message, 128-bit auth tag.
 * Format: "v1:" + base64(iv | tag | ciphertext). The version prefix allows
 * key rotation later (v2 = new key, old rows still readable).
 */
@Injectable()
export class MessageCipher {
  private readonly logger = new Logger(MessageCipher.name);
  private readonly key: Buffer;

  constructor(config: ConfigService<Env, true>) {
    const configured = config.get('MESSAGE_ENC_KEY', { infer: true });
    if (configured) {
      this.key = Buffer.from(configured, 'base64');
      if (this.key.length !== 32) throw new Error('MESSAGE_ENC_KEY must be 32 bytes, base64-encoded');
    } else {
      // env.ts requires the key in staging/production; dev/test get a per-process key.
      this.key = randomBytes(32);
      if (config.get('NODE_ENV', { infer: true }) === 'development') {
        this.logger.warn('MESSAGE_ENC_KEY not set: using an ephemeral key (messages unreadable after restart)');
      }
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')}`;
  }

  decrypt(stored: string): string {
    if (!stored.startsWith(`${VERSION}:`)) throw new Error('Unknown message encryption version');
    const raw = Buffer.from(stored.slice(VERSION.length + 1), 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  }
}

@Global()
@Module({ providers: [MessageCipher], exports: [MessageCipher] })
export class MessageCipherModule {}
