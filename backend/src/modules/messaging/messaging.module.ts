import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { VerificationModule } from '../verification/verification.module';
import { ChatGateway } from './chat.gateway';
import { MessagesController } from './messages.controller';
import { MessagingService } from './messaging.service';
import { RealtimeRegistry } from './realtime.registry';

/**
 * Chat inside an active match: history, sending, read receipts and typing,
 * over REST (/v1/matches/:id/…) and the WebSocket at /ws/chat. Verified
 * members only. Bodies are encrypted at rest (MessageCipher).
 */
@Module({
  imports: [AuthModule, VerificationModule],
  controllers: [MessagesController],
  providers: [MessagingService, RealtimeRegistry, ChatGateway],
  exports: [MessagingService, RealtimeRegistry],
})
export class MessagingModule {}
