import { type ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';

import type { AuthenticatedMember } from '../../common/authenticated-member';
import { AgeVerifiedGuard } from './age-verified.guard';

function contextFor(member?: AuthenticatedMember): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ member }) }),
  } as unknown as ExecutionContext;
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return ((e as ForbiddenException).getResponse() as { code?: string }).code;
  }
  return undefined;
}

describe('AgeVerifiedGuard (PRD §5.3a)', () => {
  const guard = new AgeVerifiedGuard();
  const member = (overrides: Partial<AuthenticatedMember> = {}): AuthenticatedMember => ({
    id: '00000000-0000-4000-8000-000000000001',
    ageVerified: true,
    status: 'ACTIVE',
    role: 'MEMBER',
    ...overrides,
  });

  it('allows a verified, active member', () => {
    expect(guard.canActivate(contextFor(member()))).toBe(true);
  });

  it('rejects unauthenticated requests with 401', () => {
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(UnauthorizedException);
  });

  it('blocks an unverified member with VERIFICATION_REQUIRED (verify later = browse only)', () => {
    expect(() => guard.canActivate(contextFor(member({ ageVerified: false })))).toThrow(ForbiddenException);
    expect(codeOf(() => guard.canActivate(contextFor(member({ ageVerified: false }))))).toBe('VERIFICATION_REQUIRED');
  });

  it.each(['SUSPENDED', 'BANNED'] as const)('blocks a %s member even if verified', (status) => {
    expect(codeOf(() => guard.canActivate(contextFor(member({ status }))))).toBe('ACCOUNT_SUSPENDED');
  });
});
