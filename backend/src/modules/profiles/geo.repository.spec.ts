import { roundCoordinate } from './geo.repository';

describe('roundCoordinate (~100 m privacy rounding)', () => {
  it('rounds to 3 decimal places', () => {
    expect(roundCoordinate(6.524379)).toBe(6.524); // Lagos Island
    expect(roundCoordinate(3.379206)).toBe(3.379);
    expect(roundCoordinate(9.0579)).toBe(9.058); // Abuja
    expect(roundCoordinate(-0.0004)).toBe(-0);
  });

  it('moves a point by at most ~80 m', () => {
    // Worst case: 0.0005° on both axes ≈ 55 m north-south and 55 m east-west at 6° N.
    const lat = 6.4565;
    const lng = 3.3895;
    const dLat = Math.abs(roundCoordinate(lat) - lat) * 111_320;
    const dLng = Math.abs(roundCoordinate(lng) - lng) * 111_320 * Math.cos((lat * Math.PI) / 180);
    expect(Math.hypot(dLat, dLng)).toBeLessThan(80);
  });
});
