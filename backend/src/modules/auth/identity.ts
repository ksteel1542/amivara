import { HttpStatus } from '@nestjs/common';

import { ApiError } from '../../common/api-error';
import { maskPhone } from './phone';

/**
 * How a member signs in (email-first since Nov 2026; phone is the optional
 * secondary). `value` is normalised: E.164 for phones, lower-case for email.
 */
export type IdentityKind = 'phone' | 'email';
export interface Identity {
  kind: IdentityKind;
  value: string;
}

/** How the identity was proven at sign-up: recorded as the member's first verification. */
export type ProofMethod = 'sms' | 'email' | 'google';

const EMAIL_RE =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Lower-cases and checks an email address. Throws 400 INVALID_EMAIL. */
export function normalizeEmail(input: string): string {
  const email = input.trim().toLowerCase();
  const domain = email.split('@')[1] ?? '';
  if (email.length > 254 || !EMAIL_RE.test(email) || !domain.includes('.')) {
    throw new ApiError(HttpStatus.BAD_REQUEST, 'INVALID_EMAIL', 'Enter a valid email address.');
  }
  return email;
}

/** "adaobi@gmail.com" -> "a****i@gmail.com": enough to recognise, not to harvest. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  const shown =
    local.length <= 2 ? `${local[0] ?? ''}*` : `${local[0]}${'*'.repeat(Math.min(4, local.length - 2))}${local.at(-1)}`;
  return `${shown}@${domain}`;
}

export function maskIdentity(identity: Identity): string {
  return identity.kind === 'email' ? maskEmail(identity.value) : maskPhone(identity.value);
}

/** The column that holds this identity (on users and on otp_challenges). */
export function identityWhere(identity: Identity): { phoneE164: string } | { email: string } {
  return identity.kind === 'email' ? { email: identity.value } : { phoneE164: identity.value };
}
