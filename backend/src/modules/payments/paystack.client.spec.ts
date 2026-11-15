import type { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env';
import { PaystackClient, paystackSignature } from './paystack.client';

const client = (key?: string) =>
  new PaystackClient({
    get: (name: string) => (name === 'PAYSTACK_SECRET_KEY' ? key : undefined),
  } as unknown as ConfigService<Env, true>);

describe('PaystackClient webhook signatures', () => {
  const key = 'sk_test_unit';
  const body = Buffer.from('{"event":"charge.success","data":{"reference":"amv_1"}}');

  it('accepts the HMAC-SHA512 of the exact raw body', () => {
    expect(client(key).verifySignature(body, paystackSignature(body, key))).toBe(true);
    expect(client(key).verifySignature(body, paystackSignature(body, key).toUpperCase())).toBe(true);
  });

  it('refuses a changed body, another key, malformed or missing signatures', () => {
    const sig = paystackSignature(body, key);
    expect(client(key).verifySignature(Buffer.from(`${body.toString()} `), sig)).toBe(false);
    expect(client(key).verifySignature(body, paystackSignature(body, 'sk_test_other'))).toBe(false);
    expect(client(key).verifySignature(body, sig.slice(0, 64))).toBe(false);
    expect(client(key).verifySignature(body, undefined)).toBe(false);
    expect(client(key).verifySignature(undefined, sig)).toBe(false);
    expect(client(key).verifySignature(body, ['x'])).toBe(false);
  });

  it('refuses everything when no secret key is configured', () => {
    expect(client(undefined).configured).toBe(false);
    expect(client(undefined).verifySignature(body, paystackSignature(body, ''))).toBe(false);
  });
});
