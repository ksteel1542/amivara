import type { Request } from 'express';

/**
 * The member attached to a request by the auth module's JWT guard (Stage 4).
 * Only the fields the cross-cutting guards need live here.
 */
export interface AuthenticatedMember {
  id: string;
  /** True only after Smile ID returned a pass and the verified age is 18+. */
  ageVerified: boolean;
  status: 'ACTIVE' | 'PAUSED' | 'SUSPENDED' | 'BANNED' | 'PENDING_DELETION';
}

export interface MemberRequest extends Request {
  member?: AuthenticatedMember;
}
