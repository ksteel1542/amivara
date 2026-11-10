import { ageOn, currentAge, isAdult, parseIsoDate } from './age';

const date = (s: string) => parseIsoDate(s)!;
const at = (iso: string) => Date.parse(iso);

describe('age rules (PRD §4)', () => {
  it('parses strict calendar dates only', () => {
    expect(parseIsoDate('2000-02-29')).toEqual({ y: 2000, m: 2, d: 29 });
    expect(parseIsoDate('2001-02-29')).toBeUndefined();
    expect(parseIsoDate('2001-13-01')).toBeUndefined();
    expect(parseIsoDate('01-02-2001')).toBeUndefined();
    expect(parseIsoDate('2001-2-1')).toBeUndefined();
  });

  it('counts whole years', () => {
    expect(ageOn(date('2000-06-15'), date('2018-06-14'))).toBe(17);
    expect(ageOn(date('2000-06-15'), date('2018-06-15'))).toBe(18);
  });

  it('treats a 29 February birthday as reached on 1 March in common years', () => {
    expect(ageOn(date('2008-02-29'), date('2026-02-28'))).toBe(17);
    expect(ageOn(date('2008-02-29'), date('2026-03-01'))).toBe(18);
  });

  it('becomes 18 only when it is the birthday in both Lagos and UTC', () => {
    const birth = date('2008-11-10');
    // 23:30 UTC on 9 Nov = 00:30 on 10 Nov in Lagos: birthday in Lagos, not yet in UTC.
    expect(currentAge(birth, at('2026-11-09T23:30:00Z'))).toBe(17);
    expect(isAdult(birth, at('2026-11-09T23:30:00Z'))).toBe(false);
    // 00:00 UTC on 10 Nov: birthday everywhere.
    expect(isAdult(birth, at('2026-11-10T00:00:00Z'))).toBe(true);
  });
});
