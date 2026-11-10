import { Module } from '@nestjs/common';

/**
 * Match conversations, messages, the WebSocket gateway and read receipts. Every route is behind @RequireAgeVerified().
 */
@Module({})
export class MessagingModule {}
