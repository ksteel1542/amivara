import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { validateEnv } from './config/env';
import { HealthModule } from './health/health.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { BillingModule } from './modules/billing/billing.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { MatchingModule } from './modules/matching/matching.module';
import { MediaModule } from './modules/media/media.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { SafetyModule } from './modules/safety/safety.module';
import { UsersModule } from './modules/users/users.module';
import { VerificationModule } from './modules/verification/verification.module';
import { PrismaModule } from './prisma/prisma.module';
import { HasherModule } from './common/hasher.service';

/** Modular monolith: one deployable, clear module boundaries (ARCHITECTURE.md §3). */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    PrismaModule,
    HasherModule,
    HealthModule,
    AuthModule,
    UsersModule,
    ProfilesModule,
    VerificationModule,
    DiscoveryModule,
    MatchingModule,
    MessagingModule,
    SafetyModule,
    MediaModule,
    NotificationsModule,
    BillingModule,
    AdminModule,
  ],
})
export class AppModule {}
