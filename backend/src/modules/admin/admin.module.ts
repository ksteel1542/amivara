import { Module } from '@nestjs/common';

import { MediaModule } from '../media/media.module';
import { SafetyModule } from '../safety/safety.module';
import { AdminController } from './admin.controller';
import { StaffGuard } from './staff.guard';

/**
 * Admin-only endpoints for the moderation console (staff roles), with every
 * action written to the append-only audit log.
 */
@Module({
  imports: [SafetyModule, MediaModule],
  controllers: [AdminController],
  providers: [StaffGuard],
})
export class AdminModule {}
