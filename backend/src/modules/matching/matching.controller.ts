import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { z } from 'zod';

import type { AuthenticatedMember } from '../../common/authenticated-member';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentMember } from '../auth/auth.guards';
import { RequireAgeVerified } from '../verification/require-age-verified.decorator';
import { MatchingService } from './matching.service';

const likeSchema = z.object({ user_id: z.string().uuid(), is_super: z.boolean().default(false) }).strict();
const passSchema = z.object({ user_id: z.string().uuid() }).strict();

/** Likes, passes and matches (API.md "Discovery & Matching"). */
@Controller('matching')
export class MatchingController {
  constructor(private readonly matching: MatchingService) {}

  /** 403 VERIFICATION_REQUIRED until Smile ID passes (PRD §5.3a). */
  @Post('likes')
  @HttpCode(HttpStatus.CREATED)
  @RequireAgeVerified()
  like(
    @CurrentMember() member: AuthenticatedMember,
    @Body(new ZodValidationPipe(likeSchema)) body: z.infer<typeof likeSchema>,
  ) {
    return this.matching.like(member.id, body.user_id, body.is_super);
  }

  /** Open before verification: passing only changes the member's own stack. */
  @Post('passes')
  @HttpCode(HttpStatus.NO_CONTENT)
  async pass(
    @CurrentMember() member: AuthenticatedMember,
    @Body(new ZodValidationPipe(passSchema)) body: z.infer<typeof passSchema>,
  ): Promise<void> {
    await this.matching.pass(member.id, body.user_id);
  }
}
