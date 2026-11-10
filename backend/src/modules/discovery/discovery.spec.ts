import { ApiError } from '../../common/api-error';
import { decodeCursor, encodeCursor } from './cursor';
import { RANKING_WEIGHTS } from './discovery.repository';
import { distanceLabel } from './distance';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('distanceLabel (SECURITY.md §4: no precise distances)', () => {
  it('never reports anything finer than 1 km, and nothing under 2 km', () => {
    expect(distanceLabel(150, A, B).label).toBe('Less than 2 km away');
    expect(distanceLabel(1_600, A, B).label).toBe('Less than 2 km away');
    for (const m of [2_500, 4_000, 7_300, 9_000]) {
      expect(distanceLabel(m, A, B).label).toMatch(/^\d+ km away$|^Less than 2 km away$/);
    }
  });

  it('uses 5 km steps from 10 km and caps at 50+', () => {
    expect(distanceLabel(23_000, A, B).km % 5).toBe(0);
    expect(distanceLabel(80_000, A, B).label).toBe('50+ km away');
  });

  it('the jitter is fixed per pair, so repeating the query reveals nothing new', () => {
    const first = distanceLabel(6_700, A, B);
    for (let i = 0; i < 5; i++) expect(distanceLabel(6_700, A, B)).toEqual(first);
    expect(distanceLabel(6_700, B, A)).toEqual(first); // symmetric
  });

  it('stays within ±15% before bucketing', () => {
    const { km } = distanceLabel(20_000, A, B);
    expect(km).toBeGreaterThanOrEqual(15);
    expect(km).toBeLessThanOrEqual(25);
  });
});

describe('feed cursor', () => {
  const now = Date.parse('2026-11-11T10:00:00Z');

  it('round-trips', () => {
    const c = { anchor: now - 1000, score: 0.734, id: A };
    expect(decodeCursor(encodeCursor(c), now)).toEqual(c);
  });

  it.each([
    ['garbage', 'not-a-cursor'],
    ['an expired anchor', encodeCursor({ anchor: now - 7 * 60 * 60 * 1000, score: 0.5, id: A })],
    ['a non-uuid id', Buffer.from(JSON.stringify([now, 0.5, "1' OR 1=1"])).toString('base64url')],
  ])('rejects %s', (_label, raw) => {
    expect(() => decodeCursor(raw, now)).toThrow(ApiError);
  });
});

describe('ranking weights', () => {
  it('sum to 1 and keep randomness small', () => {
    const total = Object.values(RANKING_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
    expect(RANKING_WEIGHTS.shuffle).toBeLessThanOrEqual(0.05);
  });
});
