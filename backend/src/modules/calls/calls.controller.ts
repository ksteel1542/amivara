import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import type { AuthenticatedMember } from '../../common/authenticated-member';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentMember, Public } from '../auth/auth.guards';
import { RequireActiveMember } from '../verification/active-member.guard';
import { CallsService } from './calls.service';

const startSchema = z.object({ type: z.enum(['voice', 'video']) }).strict();

/** API.md "Calls": ringing a match. */
@Controller('matches/:matchId/calls')
@RequireActiveMember()
export class MatchCallsController {
  constructor(private readonly calls: CallsService) {}

  /** Whether the chat header shows call buttons, and the price per minute. */
  @Get('quote')
  quote(@CurrentMember() member: AuthenticatedMember, @Param('matchId', new ParseUUIDPipe()) matchId: string) {
    return this.calls.quote(member.id, matchId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async start(
    @CurrentMember() member: AuthenticatedMember,
    @Param('matchId', new ParseUUIDPipe()) matchId: string,
    @Body(new ZodValidationPipe(startSchema)) body: z.infer<typeof startSchema>,
  ) {
    return { call: await this.calls.start(member.id, matchId, body.type === 'video' ? 'VIDEO' : 'VOICE') };
  }
}

/** API.md "Calls": answering, joining and hanging up. */
@Controller('calls')
@RequireActiveMember()
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  @Get('current')
  current(@CurrentMember() member: AuthenticatedMember) {
    return this.calls.current(member.id);
  }

  @Get(':id')
  async get(@CurrentMember() member: AuthenticatedMember, @Param('id', new ParseUUIDPipe()) id: string) {
    return { call: await this.calls.get(member.id, id) };
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  accept(@CurrentMember() member: AuthenticatedMember, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.calls.accept(member.id, id);
  }

  @Post(':id/join')
  @HttpCode(HttpStatus.OK)
  join(@CurrentMember() member: AuthenticatedMember, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.calls.join(member.id, id);
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  async decline(@CurrentMember() member: AuthenticatedMember, @Param('id', new ParseUUIDPipe()) id: string) {
    return { call: await this.calls.decline(member.id, id) };
  }

  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  async end(@CurrentMember() member: AuthenticatedMember, @Param('id', new ParseUUIDPipe()) id: string) {
    return { call: await this.calls.end(member.id, id) };
  }
}

/** LiveKit webhooks (signed with the API secret): a member leaving the room ends the call. */
@Controller('calls/livekit')
export class CallsWebhookController {
  constructor(private readonly calls: CallsService) {}

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('authorization') authorization: string | undefined,
  ): Promise<{ received: true }> {
    await this.calls.onMediaEvent(req.rawBody?.toString('utf8') ?? '', authorization);
    return { received: true };
  }
}
