import { currentAge, MINIMUM_AGE, parseIsoDate } from '../users/age';
import type { SmileResult } from './smile-id.client';

/**
 * Turns a Smile ID result into an AMIVARA verification outcome (PRD §7, SECURITY.md §1).
 *
 * Pure function: no I/O, fully unit-tested, easy to adjust once the sandbox
 * shows real payloads. It decides on Smile ID's per-check `Actions` rather
 * than on result-code tables:
 *   - Verify_ID_Number                   the NIN exists at NIMC        → "Verified"
 *   - Liveness_Check                     a live person took the selfie → "Passed"
 *   - Selfie_To_ID_Authority_Compare     selfie matches the NIMC photo → "Passed" | "Completed"
 *     (Selfie_To_ID_Card_Compare for Document Verification)
 */

export type Outcome =
  | { status: 'PENDING' } // Smile ID is still working (e.g. human review): wait for the final result
  | { status: 'PASSED'; ageBand: string }
  | { status: 'MANUAL_REVIEW'; reason: 'DOB_MISMATCH' | 'DOB_UNAVAILABLE' | 'RETRIES_EXHAUSTED'; ageBand?: string }
  | { status: 'FAILED'; reason: 'UNDERAGE'; ageBand: string }
  | { status: 'FAILED'; reason: 'ID_NOT_VERIFIED' | 'LIVENESS_FAILED' | 'FACE_MISMATCH' | 'PROVIDER_ERROR' };

/** Third failed attempt goes to a human (PRD §7: "retry twice before a manual review"). */
export const MAX_FAILED_ATTEMPTS = 3;

const PASS = new Set(['passed', 'completed', 'verified', 'approved', 'returned']);
const PENDING = new Set(['pending', 'under review', 'in progress', 'awaiting review']);

function action(result: SmileResult, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = result.Actions?.[k];
    if (typeof v === 'string') return v.trim().toLowerCase();
  }
  return undefined;
}

/** Smile ID returns dates as YYYY-MM-DD or DD-MM-YYYY depending on the ID authority. */
export function parseProviderDob(raw: string | undefined): { y: number; m: number; d: number } | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  const iso = parseIsoDate(value.slice(0, 10));
  if (iso) return iso;
  const dmy = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(value);
  return dmy ? parseIsoDate(`${dmy[3]}-${dmy[2]}-${dmy[1]}`) : undefined;
}

export function ageBand(age: number): string {
  if (age < 18) return 'under-18';
  if (age <= 24) return '18-24';
  if (age <= 34) return '25-34';
  if (age <= 44) return '35-44';
  if (age <= 54) return '45-54';
  return '55+';
}

export function decide(
  result: SmileResult,
  ctx: { declaredDob: { y: number; m: number; d: number }; previousFailures: number; now?: number },
): Outcome {
  const idNumber = action(result, 'Verify_ID_Number', 'Verify_Document');
  const liveness = action(result, 'Liveness_Check');
  const face = action(result, 'Selfie_To_ID_Authority_Compare', 'Selfie_To_ID_Card_Compare');
  const human = action(result, 'Human_Review_Compare', 'Human_Review_Liveness_Check', 'Human_Review_Update_Selfie');

  if ([idNumber, liveness, face, human].some((v) => v !== undefined && PENDING.has(v))) {
    return { status: 'PENDING' };
  }

  const failure = (reason: 'ID_NOT_VERIFIED' | 'LIVENESS_FAILED' | 'FACE_MISMATCH' | 'PROVIDER_ERROR'): Outcome =>
    ctx.previousFailures + 1 >= MAX_FAILED_ATTEMPTS
      ? { status: 'MANUAL_REVIEW', reason: 'RETRIES_EXHAUSTED' }
      : { status: 'FAILED', reason };

  if (!result.Actions) return failure('PROVIDER_ERROR');
  if (!idNumber || !PASS.has(idNumber)) return failure('ID_NOT_VERIFIED');
  if (!liveness || !PASS.has(liveness)) return failure('LIVENESS_FAILED');
  if (!face || !PASS.has(face)) return failure('FACE_MISMATCH');

  // Identity confirmed. Now the age, from the ID authority's date of birth.
  const verifiedDob = parseProviderDob(result.DOB);
  if (!verifiedDob) return { status: 'MANUAL_REVIEW', reason: 'DOB_UNAVAILABLE' };

  const age = currentAge(verifiedDob, ctx.now);
  const band = ageBand(age);
  if (age < MINIMUM_AGE) return { status: 'FAILED', reason: 'UNDERAGE', ageBand: band };

  const d = ctx.declaredDob;
  const matches = verifiedDob.y === d.y && verifiedDob.m === d.m && verifiedDob.d === d.d;
  if (!matches) return { status: 'MANUAL_REVIEW', reason: 'DOB_MISMATCH', ageBand: band };

  return { status: 'PASSED', ageBand: band };
}
