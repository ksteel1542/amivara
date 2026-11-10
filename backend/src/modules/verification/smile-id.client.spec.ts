import { createHmac } from 'node:crypto';

import { type ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env';
import { CALLBACK_MAX_AGE_MS, computeSignature, SmileIdClient } from './smile-id.client';

function client(values: Partial<Env>): SmileIdClient {
  return new SmileIdClient({ get: (k: keyof Env) => values[k] } as unknown as ConfigService<Env, true>);
}

describe('SmileIdClient signatures', () => {
  const smile = client({
    SMILE_ID_PARTNER_ID: '1234',
    SMILE_ID_API_KEY: 'test-api-key',
    SMILE_ID_ENVIRONMENT: 'sandbox',
  });
  const now = Date.parse('2026-11-10T12:00:00Z');

  it('signs base64(HMAC-SHA256(api_key, timestamp + partner_id + "sid_request"))', () => {
    const timestamp = '2026-11-10T12:00:00.000Z';
    const expected = createHmac('sha256', 'test-api-key').update(`${timestamp}1234sid_request`).digest('base64');
    expect(smile.sign(timestamp)).toEqual({ partner_id: '1234', timestamp, signature: expected });
  });

  it('accepts a fresh, correctly signed callback', () => {
    const ts = new Date(now - 60_000).toISOString();
    expect(smile.verifyCallback(computeSignature('test-api-key', '1234', ts), ts, now)).toBe(true);
  });

  it.each([
    [
      'a wrong key',
      () => {
        const ts = new Date(now).toISOString();
        return [computeSignature('other-key', '1234', ts), ts];
      },
    ],
    [
      'a stale timestamp (replay)',
      () => {
        const ts = new Date(now - CALLBACK_MAX_AGE_MS - 1000).toISOString();
        return [computeSignature('test-api-key', '1234', ts), ts];
      },
    ],
    [
      'a timestamp from the future',
      () => {
        const ts = new Date(now + 60 * 60 * 1000).toISOString();
        return [computeSignature('test-api-key', '1234', ts), ts];
      },
    ],
    ['a missing signature', () => [undefined, new Date(now).toISOString()]],
    ['garbage', () => ['not-base64!', 'yesterday']],
  ])('rejects %s', (_label, make) => {
    const [signature, timestamp] = make();
    expect(smile.verifyCallback(signature, timestamp, now)).toBe(false);
  });

  it('refuses everything when not configured', () => {
    const unconfigured = client({ SMILE_ID_ENVIRONMENT: 'sandbox' });
    const ts = new Date(now).toISOString();
    expect(unconfigured.configured).toBe(false);
    expect(unconfigured.verifyCallback(computeSignature('test-api-key', '1234', ts), ts, now)).toBe(false);
    expect(() => unconfigured.sign()).toThrow(/not available/);
  });
});
