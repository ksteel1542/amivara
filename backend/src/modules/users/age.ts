/** Minimum age to use AMIVARA (PRD §4). */
export const MINIMUM_AGE = 18;
/** Dates of birth more than this many years ago are rejected as typos. */
export const MAXIMUM_AGE = 100;

const LAGOS_OFFSET_MS = 60 * 60 * 1000; // WAT is UTC+1 all year (no daylight saving).

/** Parses a strict YYYY-MM-DD calendar date (rejects 2001-02-30 and similar). */
export function parseIsoDate(value: string): { y: number; m: number; d: number } | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return undefined;
  return { y, m, d };
}

/** Whole years between a birth date and a calendar date. A 29 February birthday counts from 1 March in common years. */
export function ageOn(birth: { y: number; m: number; d: number }, on: { y: number; m: number; d: number }): number {
  let age = on.y - birth.y;
  if (on.m < birth.m || (on.m === birth.m && on.d < birth.d)) age -= 1;
  return age;
}

function calendarDate(ms: number): { y: number; m: number; d: number } {
  const date = new Date(ms);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

/**
 * The member's age right now. It must hold on BOTH the Lagos date (what the
 * member sees) and the UTC date (what the database CHECK constraint uses with
 * CURRENT_DATE), so the API and the database can never disagree: for the
 * first hour of an 18th birthday in Lagos, the member still counts as 17.
 */
export function currentAge(birth: { y: number; m: number; d: number }, nowMs = Date.now()): number {
  return Math.min(ageOn(birth, calendarDate(nowMs + LAGOS_OFFSET_MS)), ageOn(birth, calendarDate(nowMs)));
}

export function isAdult(birth: { y: number; m: number; d: number }, nowMs = Date.now()): boolean {
  return currentAge(birth, nowMs) >= MINIMUM_AGE;
}
