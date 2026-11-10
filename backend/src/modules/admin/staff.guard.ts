import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  UseGuards,
} from '@nestjs/common';

import { ApiError } from '../../common/api-error';
import type { MemberRequest } from '../../common/authenticated-member';

const STAFF_ROLES = new Set(['MODERATOR', 'SENIOR_MODERATOR', 'ADMIN']);

/**
 * Moderation API: staff roles only. Runs after the global JwtAuthGuard, so
 * the session is already checked. Members get a plain 404, so the admin API
 * doesn't advertise itself.
 */
@Injectable()
export class StaffGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const member = context.switchToHttp().getRequest<MemberRequest>().member;
    if (!member || !STAFF_ROLES.has(member.role) || member.status !== 'ACTIVE') {
      throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found.');
    }
    return true;
  }
}

export const RequireStaff = (): MethodDecorator & ClassDecorator => applyDecorators(UseGuards(StaffGuard));
