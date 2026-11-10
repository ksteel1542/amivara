import { createHash } from 'node:crypto';

/**
 * Member-facing distance (SECURITY.md §4). Distances are never shown precisely:
 * precise distances from a few vantage points would let someone locate a
 * member (trilateration). So we
 *   1. add a fixed ±15% jitter per pair of members (the same pair always gets
 *      the same jitter, so repeating the query cannot average it away), then
 *   2. bucket the result: "Less than 2 km", whole km to 10 km, 5 km steps to
 *      50 km, then "50+ km".
 * Coordinates are stored rounded to ~100 m and never returned.
 */
export function distanceLabel(meters: number, viewerId: string, candidateId: string): { km: number; label: string } {
  const [a, b] = viewerId < candidateId ? [viewerId, candidateId] : [candidateId, viewerId];
  const digest = createHash('sha256').update(`${a}:${b}:distance`).digest();
  const unit = digest.readUInt32BE(0) / 0xffffffff; // 0..1, fixed per pair
  const jittered = (meters / 1000) * (0.85 + unit * 0.3);

  if (jittered < 2) return { km: 2, label: 'Less than 2 km away' };
  if (jittered < 10) {
    const km = Math.round(jittered);
    return { km, label: `${km} km away` };
  }
  if (jittered < 50) {
    const km = Math.round(jittered / 5) * 5;
    return { km, label: `${km} km away` };
  }
  return { km: 50, label: '50+ km away' };
}
