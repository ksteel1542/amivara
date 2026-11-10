import { Module } from '@nestjs/common';

import { AgeVerifiedGuard } from './age-verified.guard';
import { SmileIdClient } from './smile-id.client';
import { VerificationController } from './verification.controller';
import { VerificationPoller } from './verification.poller';
import { VerificationService } from './verification.service';

/**
 * Smile ID identity & age assurance (PRD §7, ARCHITECTURE.md §5): sessions,
 * the signed callback webhook, the job_status fallback poller, and the
 * @RequireAgeVerified() gate (403 VERIFICATION_REQUIRED).
 */
@Module({
  controllers: [VerificationController],
  providers: [AgeVerifiedGuard, SmileIdClient, VerificationService, VerificationPoller],
  exports: [AgeVerifiedGuard, VerificationService],
})
export class VerificationModule {}
