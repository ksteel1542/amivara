import { ApiError } from '../../common/api-error';
import { maskPhone, normalizeMobile, parseCountries } from './phone';

const NG = parseCountries('NG');

describe('normalizeMobile', () => {
  it.each([
    ['08012345678', '+2348012345678'],
    ['0801 234 5678', '+2348012345678'],
    ['801-234-5678', '+2348012345678'],
    ['+234 801 234 5678', '+2348012345678'],
    ['2348012345678', '+2348012345678'],
    ['07031234567', '+2347031234567'],
    ['08031234567', '+2348031234567'],
  ])('normalises %s to %s', (input, expected) => {
    expect(normalizeMobile(input, NG)).toBe(expected);
  });

  it.each([
    ['too short', '0801234'],
    ['letters', 'call me maybe'],
    ['foreign mobile (UK)', '+447911123456'],
    ['empty', ''],
  ])('rejects %s', (_label, input) => {
    expect(() => normalizeMobile(input, NG)).toThrow(ApiError);
  });

  it('masks numbers for logs', () => {
    expect(maskPhone('+2348012345678')).toBe('+234 *** *** 678');
  });
});
