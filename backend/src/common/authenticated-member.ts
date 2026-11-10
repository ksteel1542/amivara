import type { Request } from 'express';

/**
 * The member attached to a request by the global JwtAuthGuard.
 * Only the fields the cross-cutting guards need live here.
 */
export interface AuthenticatedMember {
  id: string;
  /** True only after Smile ID returned a pass and the verified age is 18+. */
  ageVerified: boolean;
  status: 'ACTIVE' | 'PAUSED' | 'SUSPENDED' | 'BANNED' | 'PENDING_DELETION';
  /** MEMBER, or a staff role for the moderation API. */
  role: 'MEMBER' | 'MODERATOR' | 'SENIOR_MODERATOR' | 'ADMIN';
}

export interface MemberRequest extends Request {
  member?: AuthenticatedMember;
  /** Device session behind the access token (for logout). */
  sessionId?: string;
  /** Set by SignupTokenGuard on onboarding routes. */
  signup?: { phoneE164: string; deviceHash?: string };
}
