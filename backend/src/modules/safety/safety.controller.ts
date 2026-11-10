import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';

import type { AuthenticatedMember } from '../../common/authenticated-member';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentMember } from '../auth/auth.guards';
import { REPORT_CATEGORIES, SafetyService } from './safety.service';

const blockSchema = z.object({ user_id: z.string().uuid() }).strict();
const reportSchema = z
  .object({
    user_id: z.string().uuid(),
    category: z.enum(REPORT_CATEGORIES),
    details: z.string().max(1000).optional(),
    message_id: z.string().uuid().optional(),
  })
  .strict();

/**
 * API.md "Safety". Open to every signed-in member, verified or not:
 * anyone must be able to block and report.
 */
@Controller('safety')
export class SafetyController {
  constructor(private readonly safety: SafetyService) {}

  @Post('blocks')
  @HttpCode(HttpStatus.NO_CONTENT)
  async block(
    @CurrentMember() member: AuthenticatedMember,
    @Body(new ZodValidationPipe(blockSchema)) body: z.infer<typeof blockSchema>,
  ): Promise<void> {
    await this.safety.block(member.id, body.user_id);
  }

  @Delete('blocks/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unblock(
    @CurrentMember() member: AuthenticatedMember,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<void> {
    await this.safety.unblock(member.id, userId);
  }

  @Get('blocks')
  async blocks(@CurrentMember() member: AuthenticatedMember) {
    return { blocks: await this.safety.listBlocks(member.id) };
  }

  @Post('reports')
  @HttpCode(HttpStatus.CREATED)
  report(
    @CurrentMember() member: AuthenticatedMember,
    @Body(new ZodValidationPipe(reportSchema)) body: z.infer<typeof reportSchema>,
  ) {
    return this.safety.report(member.id, body);
  }
}
