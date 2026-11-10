import { HttpStatus } from '@nestjs/common';
import { type CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js/max';

import { ApiError } from '../../common/api-error';

/**
 * Normalises user input to E.164 and accepts only mobile numbers from the
 * allowed countries (Nigeria at launch). Handles local formats such as
 * "0801 234 5678", "801-234-5678", "+234 801 234 5678" and "2348012345678".
 */
export function normalizeMobile(input: string, allowedCountries: readonly CountryCode[]): string {
  const raw = input.trim();
  const defaultCountry = allowedCountries[0];
  // "234801..." without a plus is common when copied from WhatsApp.
  const candidate = /^234\d{10}$/.test(raw.replace(/\D/g, '')) && !raw.startsWith('+') ? `+${raw}` : raw;
  const parsed = parsePhoneNumberFromString(candidate, defaultCountry);

  if (!parsed || !parsed.isValid() || !parsed.country || !allowedCountries.includes(parsed.country)) {
    throw invalidPhone();
  }
  const type = parsed.getType();
  if (type !== 'MOBILE' && type !== 'FIXED_LINE_OR_MOBILE') {
    throw invalidPhone();
  }
  return parsed.number;
}

/** "+2348012345678" -> "+234 *** *** 678" for logs and support tooling. */
export function maskPhone(e164: string): string {
  return `${e164.slice(0, 4)} *** *** ${e164.slice(-3)}`;
}

export function parseCountries(list: string): CountryCode[] {
  return list
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean) as CountryCode[];
}

function invalidPhone(): ApiError {
  return new ApiError(HttpStatus.BAD_REQUEST, 'INVALID_PHONE', 'Enter a valid Nigerian mobile number.');
}
