import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { AccountController } from './account.controller';
import { AccountPurger } from './account.purger';
import { AccountService } from './account.service';
import { MeController } from './me.controller';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { PreferencesController } from './preferences.controller';

/**
 * Account lifecycle: onboarding (18+ gate), GET /me, account controls
 * (pause, incognito), the NDPA data export and self-service deletion with
 * the 30-day purge. Still to come: the 30-day verify-later auto-pause.
 */
@Module({
  imports: [AuthModule, MediaModule],
  controllers: [OnboardingController, MeController, AccountController, PreferencesController],
  providers: [OnboardingService, AccountService, AccountPurger],
})
export class UsersModule {}
