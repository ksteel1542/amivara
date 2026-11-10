import { Module } from '@nestjs/common';

import { VerificationModule } from '../verification/verification.module';
import { MessagingController } from './messaging.controller';

/** Match conversations, messages, the WebSocket gateway and read receipts. Every route is behind @RequireAgeVerified(). */
@Module({
  imports: [VerificationModule],
  controllers: [MessagingController],
})
export class MessagingModule {}
