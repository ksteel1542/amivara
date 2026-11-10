import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ApiError } from '../../common/api-error';
import type { AuthenticatedMember, MemberRequest } from '../../common/authenticated-member';
import { PrismaService } from '../../prisma/prisma.service';
import { TokensService } from './tokens.service';

const IS_PUBLIC = 'amivara:isPublic';

/** Opens a route to unauthenticated callers (health, OTP, refresh, onboarding). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

function bearer(req: MemberRequest): string | undefined {
  const header = req.header('authorization');
  if (!header) return undefined;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

/**
 * Global guard: every route requires a valid access token unless marked @Public().
 * The session row is checked on every request, so logout, "sign out other
 * devices" and bans take effect immediately rather than when the token expires.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) {
      return true;
    }
    const req = context.switchToHttp().getRequest<MemberRequest>();
    const token = bearer(req);
    if (!token) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in to continue.');
    }
    const claims = this.tokens.verifyAccess(token);

    const session = await this.prisma.deviceSession.findUnique({
      where: { id: claims.sid },
      select: {
        userId: true,
        revokedAt: true,
        expiresAt: true,
        user: { select: { id: true, status: true, ageVerified: true, deletedAt: true } },
      },
    });
    if (!session || session.userId !== claims.sub || session.revokedAt || session.expiresAt <= new Date()) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'INVALID_TOKEN', 'Your session has ended. Please sign in again.');
    }
    if (session.user.status === 'BANNED') {
      throw new ApiError(HttpStatus.FORBIDDEN, 'ACCOUNT_SUSPENDED', 'This account is not active.');
    }

    const member: AuthenticatedMember = {
      id: session.user.id,
      status: session.user.status,
      ageVerified: session.user.ageVerified,
    };
    req.member = member;
    req.sessionId = claims.sid;
    return true;
  }
}

/** Onboarding routes: requires the short-lived signup token issued after OTP verification. */
@Injectable()
export class SignupTokenGuard implements CanActivate {
  constructor(private readonly tokens: TokensService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<MemberRequest>();
    const token = bearer(req);
    if (!token) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Verify your phone number first.');
    }
    const claims = this.tokens.verifySignup(token);
    req.signup = { phoneE164: claims.sub, deviceHash: claims.dvh };
    return true;
  }
}

/** `@CurrentMember() member: AuthenticatedMember` */
export const CurrentMember = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthenticatedMember => {
  const member = ctx.switchToHttp().getRequest<MemberRequest>().member;
  if (!member) throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in to continue.');
  return member;
});

/** `@CurrentSessionId() sid: string` */
export const CurrentSessionId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const sid = ctx.switchToHttp().getRequest<MemberRequest>().sessionId;
  if (!sid) throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in to continue.');
  return sid;
});

/** `@SignupIdentity() signup` on onboarding routes. */
export const SignupIdentity = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): NonNullable<MemberRequest['signup']> => {
    const signup = ctx.switchToHttp().getRequest<MemberRequest>().signup;
    if (!signup) throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Verify your phone number first.');
    return signup;
  },
);
