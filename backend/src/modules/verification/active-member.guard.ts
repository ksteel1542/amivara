import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';

import type { MemberRequest } from '../../common/authenticated-member';

/**
 * Progressive trust (Nov 2026): liking, matching and chatting are open to every
 * member in good standing, verified or not (unverified chat is capped in
 * MessagingService). What still shuts them is a suspension or a ban.
 * AgeVerifiedGuard remains for actions that need a passed Smile ID check.
 */
@Injectable()
export class ActiveMemberGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const member = context.switchToHttp().getRequest<MemberRequest>().member;
    if (!member) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Sign in to continue.' });
    if (member.status === 'SUSPENDED' || member.status === 'BANNED') {
      throw new ForbiddenException({ code: 'ACCOUNT_SUSPENDED', message: 'This account is not active.' });
    }
    return true;
  }
}

export const RequireActiveMember = (): MethodDecorator & ClassDecorator =>
  applyDecorators(UseGuards(ActiveMemberGuard));
