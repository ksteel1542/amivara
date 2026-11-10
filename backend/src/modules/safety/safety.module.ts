import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { EnforcementService } from './enforcement.service';
import { SafetyController } from './safety.controller';
import { SafetyService } from './safety.service';

/**
 * Blocks, reports (an underage report suspends immediately) and enforcement:
 * warnings, suspensions, bans and unbans (used by the admin module).
 */
@Module({
  imports: [AuthModule],
  controllers: [SafetyController],
  providers: [SafetyService, EnforcementService],
  exports: [SafetyService, EnforcementService],
})
export class SafetyModule {}
