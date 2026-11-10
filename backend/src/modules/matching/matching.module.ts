import { Module } from '@nestjs/common';

import { MediaModule } from '../media/media.module';
import { VerificationModule } from '../verification/verification.module';
import { MatchingController } from './matching.controller';
import { MatchesController } from './matches.controller';
import { MatchingService } from './matching.service';

/** Likes, passes, match creation (mutual likes only, PRD §5.4) and unmatching. */
@Module({
  imports: [VerificationModule, MediaModule],
  controllers: [MatchingController, MatchesController],
  providers: [MatchingService],
})
export class MatchingModule {}
