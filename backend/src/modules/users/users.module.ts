import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { MeController } from './me.controller';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

/**
 * Account lifecycle: onboarding (18+ gate), GET /me. Still to come: pause/resume,
 * the 30-day verify-later auto-pause, data export and deletion.
 */
@Module({
  imports: [AuthModule],
  controllers: [OnboardingController, MeController],
  providers: [OnboardingService],
})
export class UsersModule {}
