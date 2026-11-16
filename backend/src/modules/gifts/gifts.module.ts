import { Body, Controller, Get, HttpCode, HttpStatus, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';

import type { AuthenticatedMember } from '../../common/authenticated-member';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthModule } from '../auth/auth.module';
import { CurrentMember } from '../auth/auth.guards';
import { HostsModule } from '../hosts/hosts.module';
import { MessagingModule } from '../messaging/messaging.module';
import { RequireActiveMember } from '../verification/active-member.guard';
import { WalletModule } from '../wallet/wallet.module';
import { GiftsService } from './gifts.service';

const sendSchema = z
  .object({
    gift_id: z.string().uuid(),
    /** Chosen by the app per tap, so a retry never charges twice. */
    idempotency_key: z.string().min(8).max(64),
  })
  .strict();

/** API.md "Gifts". */
@Controller()
@RequireActiveMember()
export class GiftsController {
  constructor(private readonly gifts: GiftsService) {}

  @Get('gifts')
  catalogue() {
    return this.gifts.catalogue();
  }

  @Post('matches/:matchId/gifts')
  @HttpCode(HttpStatus.CREATED)
  send(
    @CurrentMember() member: AuthenticatedMember,
    @Param('matchId', new ParseUUIDPipe()) matchId: string,
    @Body(new ZodValidationPipe(sendSchema)) body: z.infer<typeof sendSchema>,
  ) {
    return this.gifts.sendInChat(member.id, matchId, body.gift_id, body.idempotency_key);
  }
}

/** Virtual gifts to Verified Hosts (MONETIZATION_PLAN.md 3b), in chats and, next, Chat House rooms. */
@Module({
  imports: [AuthModule, WalletModule, HostsModule, MessagingModule],
  controllers: [GiftsController],
  providers: [GiftsService],
  exports: [GiftsService],
})
export class GiftsModule {}
