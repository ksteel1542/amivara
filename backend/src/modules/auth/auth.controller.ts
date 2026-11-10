import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';

import { ApiError } from '../../common/api-error';
import type { AuthenticatedMember } from '../../common/authenticated-member';
import { Ctx, type RequestContext } from '../../common/request-context';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { HasherService } from '../../common/hasher.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SignupBlocksService } from '../users/signup-blocks.service';
import { CurrentMember, CurrentSessionId, Public } from './auth.guards';
import {
  type RefreshInput,
  refreshSchema,
  type RequestOtpInput,
  requestOtpSchema,
  type VerifyOtpInput,
  verifyOtpSchema,
} from './auth.schemas';
import { OtpService } from './otp.service';
import { SessionsService } from './sessions.service';
import { SIGNUP_TOKEN_TTL_SECONDS, TokensService } from './tokens.service';

/** API.md "Auth". */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly otp: OtpService,
    private readonly sessions: SessionsService,
    private readonly tokens: TokensService,
    private readonly blocks: SignupBlocksService,
    private readonly hasher: HasherService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Sends a code. The response is the same whether or not the number already
   * has an account, so this endpoint cannot be used to discover members.
   */
  @Public()
  @Post('otp/request')
  @HttpCode(HttpStatus.ACCEPTED)
  async requestOtp(@Body(new ZodValidationPipe(requestOtpSchema)) body: RequestOtpInput, @Ctx() ctx: RequestContext) {
    const result = await this.otp.request(body.phone, body.channel, ctx);
    return {
      challenge_id: result.challengeId,
      channel: result.channel,
      expires_in: result.expiresIn,
      resend_in: result.resendIn,
    };
  }

  /**
   * Existing member: signs in and returns tokens.
   * New number: returns a 30-minute signup token for the onboarding endpoints.
   */
  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body(new ZodValidationPipe(verifyOtpSchema)) body: VerifyOtpInput, @Ctx() ctx: RequestContext) {
    const phone = await this.otp.verify(body.challenge_id, body.code);

    const user = await this.prisma.user.findUnique({ where: { phoneE164: phone }, select: { id: true, status: true } });
    if (user) {
      if (user.status === 'BANNED') {
        throw new ApiError(HttpStatus.FORBIDDEN, 'ACCOUNT_SUSPENDED', 'This account is not active.');
      }
      // Signing back in within the 30-day grace period cancels a deletion (API.md "Account controls").
      const restored = user.status === 'PENDING_DELETION' && (await this.restore(user.id));
      const tokens = await this.sessions.create(user.id, ctx);
      return { status: 'signed_in', ...tokens, ...(restored ? { restored: true } : {}) };
    }

    const deviceHash = this.hasher.hashOptional('device', ctx.deviceId);
    if (await this.blocks.isBlocked(this.blocks.subjects(phone, deviceHash))) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'SIGNUP_BLOCKED', "You can't create an account right now.");
    }
    return {
      status: 'signup_required',
      signup_token: this.tokens.issueSignup(phone, deviceHash),
      expires_in: SIGNUP_TOKEN_TTL_SECONDS,
    };
  }

  /**
   * Cancels a pending deletion. A suspension that was running when the
   * member deleted their account still applies; archived matches stay
   * archived and the location must be shared again.
   */
  private async restore(userId: string): Promise<boolean> {
    const last = await this.prisma.enforcementAction.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { action: true, expiresAt: true },
    });
    const stillSuspended = last?.action === 'SUSPEND' && (!last.expiresAt || last.expiresAt > new Date());
    const restored = await this.prisma.user.updateMany({
      where: { id: userId, status: 'PENDING_DELETION' },
      data: { status: stillSuspended ? 'SUSPENDED' : 'ACTIVE', deletedAt: null },
    });
    return restored.count > 0;
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput, @Ctx() ctx: RequestContext) {
    return this.sessions.refresh(body.refresh_token, ctx);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentMember() member: AuthenticatedMember, @CurrentSessionId() sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId, member.id);
  }

  @Get('sessions')
  async listSessions(@CurrentMember() member: AuthenticatedMember, @CurrentSessionId() sessionId: string) {
    const sessions = await this.sessions.list(member.id);
    return {
      sessions: sessions.map((s) => ({
        id: s.id,
        platform: s.platform,
        device_model: s.deviceModel,
        created_at: s.createdAt.toISOString(),
        last_used_at: s.lastUsedAt.toISOString(),
        current: s.id === sessionId,
      })),
    };
  }

  /** "Sign out other devices": everything except this session. */
  @Delete('sessions')
  @HttpCode(HttpStatus.OK)
  async revokeOtherSessions(@CurrentMember() member: AuthenticatedMember, @CurrentSessionId() sessionId: string) {
    return { revoked: await this.sessions.revokeOthers(member.id, sessionId) };
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @CurrentMember() member: AuthenticatedMember,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    if (!(await this.sessions.revoke(id, member.id))) {
      throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Session not found.');
    }
  }
}
