import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** HMAC-SHA256 as lowercase hex. Used for OTP codes, IPs, device ids and phone numbers we must not store raw. */
export function hmacHex(pepper: string, value: string): string {
  return createHmac('sha256', pepper).update(value, 'utf8').digest('hex');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Constant-time comparison of two equal-length hex digests. */
export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

/** Opaque, URL-safe random token (refresh tokens). 32 bytes = 256 bits of entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Uniformly random 6-digit OTP from a CSPRNG (leading zeros allowed). */
export function randomOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}
