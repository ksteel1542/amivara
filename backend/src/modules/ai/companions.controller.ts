import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { z } from 'zod';

import type { AuthenticatedMember } from '../../common/authenticated-member';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentMember } from '../auth/auth.guards';
import { RequireActiveMember } from '../verification/active-member.guard';
import { CompanionsService, MAX_AI_MESSAGE_LENGTH, SELF_EXCLUSION_DAYS } from './companions.service';

const sendSchema = z
  .object({
    body: z
      .string()
      .min(1)
      .max(MAX_AI_MESSAGE_LENGTH * 2),
  })
  .strict();
const capSchema = z.object({ ai_daily_cap_coins: z.number().int().min(0).max(100_000).nullable() }).strict();
const excludeSchema = z
  .object({
    days: z
      .number()
      .int()
      .refine((d) => (SELF_EXCLUSION_DAYS as readonly number[]).includes(d), 'Use 7 or 30'),
  })
  .strict();

/** API.md "AI Companions": labelled AI personas, in their own section. Reply-only. */
@Controller('ai')
@RequireActiveMember()
export class CompanionsController {
  constructor(private readonly companions: CompanionsService) {}

  @Get('companions')
  list() {
    return this.companions.personas();
  }

  /** Opens (or reopens) the member's chat with a companion. */
  @Post('companions/:slug/conversation')
  @HttpCode(HttpStatus.OK)
  open(@CurrentMember() member: AuthenticatedMember, @Param('slug') slug: string) {
    return this.companions.open(member.id, slug);
  }

  @Get('conversations')
  conversations(@CurrentMember() member: AuthenticatedMember) {
    return this.companions.conversations(member.id);
  }

  @Get('conversations/:id')
  conversation(@CurrentMember() member: AuthenticatedMember, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.companions.conversationView(member.id, id);
  }

  @Post('conversations/:id/messages')
  @HttpCode(HttpStatus.CREATED)
  send(
    @CurrentMember() member: AuthenticatedMember,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(sendSchema)) body: z.infer<typeof sendSchema>,
  ) {
    return this.companions.send(member.id, id, body.body);
  }

  /** Deletes the conversation and its messages. */
  @Delete('conversations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentMember() member: AuthenticatedMember, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.companions.remove(member.id, id);
  }

  @Post('messages/:id/report')
  @HttpCode(HttpStatus.NO_CONTENT)
  async report(@CurrentMember() member: AuthenticatedMember, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.companions.report(member.id, id);
  }
}

/** Spending protections (MONETIZATION_PLAN.md 3e). */
@Controller('me/spend-limits')
@RequireActiveMember()
export class SpendLimitsController {
  constructor(private readonly companions: CompanionsService) {}

  @Get()
  get(@CurrentMember() member: AuthenticatedMember) {
    return this.companions.limits(member.id);
  }

  @Put()
  set(
    @CurrentMember() member: AuthenticatedMember,
    @Body(new ZodValidationPipe(capSchema)) body: z.infer<typeof capSchema>,
  ) {
    return this.companions.setCap(member.id, body.ai_daily_cap_coins);
  }

  @Post('self-exclude')
  @HttpCode(HttpStatus.OK)
  selfExclude(
    @CurrentMember() member: AuthenticatedMember,
    @Body(new ZodValidationPipe(excludeSchema)) body: z.infer<typeof excludeSchema>,
  ) {
    return this.companions.selfExclude(member.id, body.days);
  }
}
