import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { DisabledPushSender, FcmPushSender, PUSH_SENDER, type PushSender } from './push-sender';

/** FCM push (Android and web): token registration and event-driven pushes (match created, unmatched). */
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    {
      provide: PUSH_SENDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): PushSender => {
        const projectId = config.get('FCM_PROJECT_ID', { infer: true });
        const clientEmail = config.get('FCM_CLIENT_EMAIL', { infer: true });
        const privateKeyPem = config.get('FCM_PRIVATE_KEY_PEM', { infer: true });
        return projectId && clientEmail && privateKeyPem
          ? new FcmPushSender({ projectId, clientEmail, privateKeyPem })
          : new DisabledPushSender();
      },
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
