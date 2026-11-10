import { randomBytes } from 'node:crypto';

import { type ConfigService } from '@nestjs/config';

import type { Env } from '../config/env';
import { MessageCipher } from './message-cipher';

const cipherWith = (key?: string) =>
  new MessageCipher({
    get: (k: keyof Env) => (k === 'MESSAGE_ENC_KEY' ? key : 'test'),
  } as unknown as ConfigService<Env, true>);

describe('MessageCipher (AES-256-GCM at rest)', () => {
  const key = randomBytes(32).toString('base64');

  it('round-trips, including Yoruba/Hausa text and emoji', () => {
    const c = cipherWith(key);
    for (const text of ['Hello!', 'Ẹ kú àárọ̀ ✦', 'Ina ƙwana? ɗan uwa', '😂🔥']) {
      expect(c.decrypt(c.encrypt(text))).toBe(text);
    }
  });

  it('never stores plaintext, and the same text encrypts differently each time', () => {
    const c = cipherWith(key);
    const a = c.encrypt('meet me at the mall');
    const b = c.encrypt('meet me at the mall');
    expect(a).toMatch(/^v1:/);
    expect(a).not.toContain('mall');
    expect(a).not.toBe(b);
  });

  it('detects tampering', () => {
    const c = cipherWith(key);
    const stored = c.encrypt('secret');
    const raw = Buffer.from(stored.slice(3), 'base64');
    raw[raw.length - 1] ^= 0xff;
    expect(() => c.decrypt(`v1:${raw.toString('base64')}`)).toThrow();
  });

  it('cannot be read with another key', () => {
    const stored = cipherWith(key).encrypt('secret');
    expect(() => cipherWith(randomBytes(32).toString('base64')).decrypt(stored)).toThrow();
  });

  it('rejects a key of the wrong length', () => {
    expect(() => cipherWith(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});
