import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import type { AuthenticatedMember } from '../../common/authenticated-member';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentMember } from '../auth/auth.guards';
import { RequireAgeVerified } from '../verification/require-age-verified.decorator';
import { MAX_MESSAGE_LENGTH, MessagingService } from './messaging.service';

const historyQuery = z
  .object({ before: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(50).default(30) })
  .strict();
const sendSchema = z
  .object({
    body: z
      .string()
      .min(1)
      .max(MAX_MESSAGE_LENGTH * 2),
  })
  .strict();
const readSchema = z.object({ up_to_message_id: z.string().uuid() }).strict();

/**
 * Chat over REST (API.md "Messaging"): history, the send fallback and read
 * receipts. Live delivery is the WebSocket at /ws/chat. Verified members
 * only, and only inside an active (not unmatched) match.
 */
@Controller('matches/:matchId')
@RequireAgeVerified()
export class MessagesController {
  constructor(private readonly messaging: MessagingService) {}

  @Get('messages')
  history(
    @CurrentMember() member: AuthenticatedMember,
    @Param('matchId', new ParseUUIDPipe()) matchId: string,
    @Query(new ZodValidationPipe(historyQuery)) query: z.infer<typeof historyQuery>,
  ) {
    return this.messaging.history(member.id, matchId, query);
  }

  @Post('messages')
  @HttpCode(HttpStatus.CREATED)
  send(
    @CurrentMember() member: AuthenticatedMember,
    @Param('matchId', new ParseUUIDPipe()) matchId: string,
    @Body(new ZodValidationPipe(sendSchema)) body: z.infer<typeof sendSchema>,
  ) {
    return this.messaging.send(member.id, matchId, body.body);
  }

  @Post('read')
  @HttpCode(HttpStatus.OK)
  read(
    @CurrentMember() member: AuthenticatedMember,
    @Param('matchId', new ParseUUIDPipe()) matchId: string,
    @Body(new ZodValidationPipe(readSchema)) body: z.infer<typeof readSchema>,
  ) {
    return this.messaging.markRead(member.id, matchId, body.up_to_message_id);
  }
}
