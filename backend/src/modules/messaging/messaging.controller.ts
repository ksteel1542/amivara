import { Controller, HttpCode, NotImplementedException, Param, ParseUUIDPipe, Post } from '@nestjs/common';

import { RequireAgeVerified } from '../verification/require-age-verified.decorator';

/**
 * Conversations and messages (API.md "Messaging"). Every route requires a
 * Smile ID-verified adult (PRD §5.3a). The gate is wired now; sending
 * arrives with the messaging sprint.
 */
@Controller('conversations')
@RequireAgeVerified()
export class MessagingController {
  @Post(':id/messages')
  @HttpCode(201)
  send(@Param('id', new ParseUUIDPipe()) _id: string): never {
    throw new NotImplementedException('Messaging arrives in Stage 4, sprint 6');
  }
}
