import { Module } from '@nestjs/common';

import { VerificationModule } from '../verification/verification.module';
import { MatchingController } from './matching.controller';

/** Likes, passes, match creation (mutual likes only, PRD §5.4) and unmatching. */
@Module({
  imports: [VerificationModule],
  controllers: [MatchingController],
})
export class MatchingModule {}
