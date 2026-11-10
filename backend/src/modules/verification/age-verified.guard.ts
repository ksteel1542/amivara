import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import type { MemberRequest } from '../../common/authenticated-member';

/**
 * Verification gate (PRD §5.3a, "verify later").
 *
 * Unverified members may browse, but liking, Super Liking, messaging and
 * buying AMIVARA Plus all require a passed Smile ID verification. This guard
 * is the server-side enforcement; the client UI is only a convenience.
 */
@Injectable()
export class AgeVerifiedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<MemberRequest>();
    const member = request.member;

    if (!member) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Sign in to continue.' });
    }
    if (member.status === 'SUSPENDED' || member.status === 'BANNED') {
      throw new ForbiddenException({ code: 'ACCOUNT_SUSPENDED', message: 'This account is not active.' });
    }
    if (!member.ageVerified) {
      throw new ForbiddenException({
        code: 'VERIFICATION_REQUIRED',
        message: 'Verify your identity with Smile ID to like and chat.',
      });
    }
    return true;
  }
}
