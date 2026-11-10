import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { z } from 'zod';

import type { AuthenticatedMember } from '../../common/authenticated-member';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentMember, Public } from '../auth/auth.guards';
import type { SmileResult } from './smile-id.client';
import { VerificationService } from './verification.service';

const sessionSchema = z.object({ method: z.enum(['biometric_kyc']).default('biometric_kyc') }).strict();

/** API.md "Verification". */
@Controller('verification')
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  /**
   * Starts a Smile ID job: returns our partner params (user_id, job_id, job_type)
   * and a server-made signature. The member's NIN never touches our API: the
   * Smile ID SDK sends it straight to Smile ID.
   */
  @Post('sessions')
  @HttpCode(HttpStatus.CREATED)
  createSession(
    @CurrentMember() member: AuthenticatedMember,
    @Body(new ZodValidationPipe(sessionSchema)) body: z.infer<typeof sessionSchema>,
  ) {
    return this.verification.createSession(member.id, body.method);
  }

  @Get('status')
  status(@CurrentMember() member: AuthenticatedMember) {
    return this.verification.status(member.id);
  }

  /**
   * Smile ID callback. Public, but every request must carry a valid
   * signature and a fresh timestamp. Always answers 200 for authentic
   * requests, so Smile ID does not retry results we have already stored.
   */
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  webhook(@Body() body: SmileResult & { signature?: unknown; timestamp?: unknown }) {
    return this.verification.handleCallback(body);
  }
}
