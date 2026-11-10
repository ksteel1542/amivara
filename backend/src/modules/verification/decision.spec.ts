import { ageBand, decide, parseProviderDob } from './decision';
import type { SmileResult } from './smile-id.client';

const declaredDob = { y: 1999, m: 3, d: 14 };
const now = Date.parse('2026-11-10T12:00:00Z');

const passing = (overrides: Partial<SmileResult> = {}): SmileResult => ({
  ResultCode: '1020',
  ResultText: 'Exact Match',
  DOB: '1999-03-14',
  Actions: {
    Verify_ID_Number: 'Verified',
    Liveness_Check: 'Passed',
    Selfie_To_ID_Authority_Compare: 'Completed',
    Return_Personal_Info: 'Returned',
  },
  ...overrides,
});

const ctx = (previousFailures = 0) => ({ declaredDob, previousFailures, now });

describe('Smile ID decision (PRD §7, SECURITY.md §1)', () => {
  it('passes a verified adult whose DOB matches the one declared at signup', () => {
    expect(decide(passing(), ctx())).toEqual({ status: 'PASSED', ageBand: '25-34' });
  });

  it('accepts the DD-MM-YYYY date format', () => {
    expect(decide(passing({ DOB: '14-03-1999' }), ctx())).toEqual({ status: 'PASSED', ageBand: '25-34' });
  });

  it('sends a DOB mismatch to manual review', () => {
    expect(decide(passing({ DOB: '1998-03-14' }), ctx())).toEqual({
      status: 'MANUAL_REVIEW',
      reason: 'DOB_MISMATCH',
      ageBand: '25-34',
    });
  });

  it('sends a missing DOB to manual review (age cannot be confirmed)', () => {
    expect(decide(passing({ DOB: 'Not Available' }), ctx())).toMatchObject({
      status: 'MANUAL_REVIEW',
      reason: 'DOB_UNAVAILABLE',
    });
  });

  it('fails an ID that shows the member is under 18, even if they declared otherwise', () => {
    expect(decide(passing({ DOB: '2010-01-01' }), ctx())).toEqual({
      status: 'FAILED',
      reason: 'UNDERAGE',
      ageBand: 'under-18',
    });
  });

  it.each([
    ['the NIN is not verified', { Verify_ID_Number: 'Not Verified' }, 'ID_NOT_VERIFIED'],
    ['liveness failed', { Liveness_Check: 'Failed' }, 'LIVENESS_FAILED'],
    ['the selfie does not match', { Selfie_To_ID_Authority_Compare: 'Failed' }, 'FACE_MISMATCH'],
  ])('fails when %s', (_label, change, reason) => {
    const result = passing();
    result.Actions = { ...result.Actions, ...change };
    expect(decide(result, ctx())).toEqual({ status: 'FAILED', reason });
  });

  it('fails a result with no Actions at all', () => {
    expect(decide({ ResultCode: '2213', ResultText: 'Error' }, ctx())).toEqual({
      status: 'FAILED',
      reason: 'PROVIDER_ERROR',
    });
  });

  it('the third failed attempt goes to manual review', () => {
    const failing = passing();
    failing.Actions = { ...failing.Actions, Liveness_Check: 'Failed' };
    expect(decide(failing, ctx(1))).toMatchObject({ status: 'FAILED' });
    expect(decide(failing, ctx(2))).toEqual({ status: 'MANUAL_REVIEW', reason: 'RETRIES_EXHAUSTED' });
  });

  it('waits while Smile ID is still reviewing', () => {
    const reviewing = passing();
    reviewing.Actions = { ...reviewing.Actions, Human_Review_Compare: 'Pending' };
    expect(decide(reviewing, ctx())).toEqual({ status: 'PENDING' });
  });

  it('parses provider dates and buckets ages', () => {
    expect(parseProviderDob('1999-03-14')).toEqual({ y: 1999, m: 3, d: 14 });
    expect(parseProviderDob('14/03/1999')).toEqual({ y: 1999, m: 3, d: 14 });
    expect(parseProviderDob('31-02-1999')).toBeUndefined();
    expect([17, 18, 24, 25, 44, 60].map(ageBand)).toEqual(['under-18', '18-24', '18-24', '25-34', '35-44', '55+']);
  });
});
