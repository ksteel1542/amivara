import { Module } from '@nestjs/common';

import { AgeVerifiedGuard } from './age-verified.guard';

/**
 * Smile ID identity & age assurance (ARCHITECTURE.md §3, §5).
 *
 * Stage 4: VerificationProvider interface + SmileIdProvider (job signature,
 * Biometric KYC / Document Verification / SmartSelfie), the signed callback
 * webhook (POST /v1/verification/webhook), and the status-poll fallback worker.
 */
@Module({
  providers: [AgeVerifiedGuard],
  exports: [AgeVerifiedGuard],
})
export class VerificationModule {}
