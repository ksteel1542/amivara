import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { z } from 'zod';

import type { AuthenticatedMember } from '../../common/authenticated-member';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthModule } from '../auth/auth.module';
import { CurrentMember } from '../auth/auth.guards';
import { CallsModule } from '../calls/calls.module';
import { HostsModule } from '../hosts/hosts.module';
import { MessagingModule } from '../messaging/messaging.module';
import { REPORT_CATEGORIES } from '../safety/safety.service';
import { SafetyModule } from '../safety/safety.module';
import { SafetyService } from '../safety/safety.service';
import { RequireActiveMember } from '../verification/active-member.guard';
import { WalletModule } from '../wallet/wallet.module';
import { MAX_ROOM_MESSAGE_LENGTH, MAX_ROOM_SEATS, RoomsService } from './rooms.service';

const openSchema = z
  .object({
    title: z.string().min(1).max(80),
    mode: z.enum(['audio', 'video']),
    audience: z.enum(['open', 'followers']).default('open'),
    seats: z.number().int().min(0).max(MAX_ROOM_SEATS).optional(),
  })
  .strict();
const messageSchema = z
  .object({
    body: z
      .string()
      .min(1)
      .max(MAX_ROOM_MESSAGE_LENGTH * 2),
  })
  .strict();
const giftSchema = z
  .object({
    gift_id: z.string().uuid(),
    recipient_id: z.string().uuid().optional(),
    idempotency_key: z.string().min(8).max(64),
  })
  .strict();
const reportSchema = z
  .object({
    user_id: z.string().uuid().optional(),
    category: z.enum(REPORT_CATEGORIES),
    details: z.string().max(1000).optional(),
  })
  .strict();

const uuid = () => new ParseUUIDPipe();

/** API.md "Chat House rooms" and Host follows. */
@Controller()
@RequireActiveMember()
export class RoomsController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly safety: SafetyService,
  ) {}

  @Post('hosts/:hostId/follow')
  @HttpCode(HttpStatus.OK)
  follow(@CurrentMember() m: AuthenticatedMember, @Param('hostId', uuid()) hostId: string) {
    return this.rooms.follow(m.id, hostId);
  }

  @Delete('hosts/:hostId/follow')
  @HttpCode(HttpStatus.OK)
  unfollow(@CurrentMember() m: AuthenticatedMember, @Param('hostId', uuid()) hostId: string) {
    return this.rooms.unfollow(m.id, hostId);
  }

  @Get('rooms')
  list(@CurrentMember() m: AuthenticatedMember) {
    return this.rooms.list(m.id);
  }

  @Post('rooms')
  @HttpCode(HttpStatus.CREATED)
  open(
    @CurrentMember() m: AuthenticatedMember,
    @Body(new ZodValidationPipe(openSchema)) body: z.infer<typeof openSchema>,
  ) {
    return this.rooms.open(m.id, {
      title: body.title,
      mode: body.mode === 'video' ? 'VIDEO' : 'AUDIO',
      audience: body.audience === 'followers' ? 'FOLLOWERS' : 'OPEN',
      seats: body.seats,
    });
  }

  @Get('rooms/:id')
  get(@CurrentMember() m: AuthenticatedMember, @Param('id', uuid()) id: string) {
    return this.rooms.get(m.id, id);
  }

  @Post('rooms/:id/join')
  @HttpCode(HttpStatus.OK)
  join(@CurrentMember() m: AuthenticatedMember, @Param('id', uuid()) id: string) {
    return this.rooms.join(m.id, id);
  }

  @Post('rooms/:id/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  async leave(@CurrentMember() m: AuthenticatedMember, @Param('id', uuid()) id: string) {
    await this.rooms.leave(m.id, id);
  }

  @Post('rooms/:id/end')
  @HttpCode(HttpStatus.NO_CONTENT)
  async end(@CurrentMember() m: AuthenticatedMember, @Param('id', uuid()) id: string) {
    await this.rooms.end(m.id, id);
  }

  @Post('rooms/:id/seat-request')
  @HttpCode(HttpStatus.NO_CONTENT)
  async requestSeat(@CurrentMember() m: AuthenticatedMember, @Param('id', uuid()) id: string) {
    await this.rooms.requestSeat(m.id, id);
  }

  @Delete('rooms/:id/seat-request')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancelSeatRequest(@CurrentMember() m: AuthenticatedMember, @Param('id', uuid()) id: string) {
    await this.rooms.cancelSeatRequest(m.id, id);
  }

  @Post('rooms/:id/speakers/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async seat(
    @CurrentMember() m: AuthenticatedMember,
    @Param('id', uuid()) id: string,
    @Param('userId', uuid()) userId: string,
  ) {
    await this.rooms.seat(m.id, id, userId);
  }

  @Post('rooms/:id/speakers/:userId/remove')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unseat(
    @CurrentMember() m: AuthenticatedMember,
    @Param('id', uuid()) id: string,
    @Param('userId', uuid()) userId: string,
  ) {
    await this.rooms.unseat(m.id, id, userId);
  }

  @Post('rooms/:id/mute/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async mute(
    @CurrentMember() m: AuthenticatedMember,
    @Param('id', uuid()) id: string,
    @Param('userId', uuid()) userId: string,
  ) {
    await this.rooms.setMuted(m.id, id, userId, true);
  }

  @Post('rooms/:id/unmute/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unmute(
    @CurrentMember() m: AuthenticatedMember,
    @Param('id', uuid()) id: string,
    @Param('userId', uuid()) userId: string,
  ) {
    await this.rooms.setMuted(m.id, id, userId, false);
  }

  @Post('rooms/:id/ban/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async ban(
    @CurrentMember() m: AuthenticatedMember,
    @Param('id', uuid()) id: string,
    @Param('userId', uuid()) userId: string,
  ) {
    await this.rooms.ban(m.id, id, userId);
  }

  @Get('rooms/:id/messages')
  messages(@CurrentMember() m: AuthenticatedMember, @Param('id', uuid()) id: string) {
    return this.rooms.messages(m.id, id);
  }

  @Post('rooms/:id/messages')
  @HttpCode(HttpStatus.CREATED)
  send(
    @CurrentMember() m: AuthenticatedMember,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(messageSchema)) body: z.infer<typeof messageSchema>,
  ) {
    return this.rooms.sendMessage(m.id, id, body.body);
  }

  @Post('rooms/:id/gifts')
  @HttpCode(HttpStatus.CREATED)
  gift(
    @CurrentMember() m: AuthenticatedMember,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(giftSchema)) body: z.infer<typeof giftSchema>,
  ) {
    return this.rooms.sendGift(m.id, id, {
      giftId: body.gift_id,
      recipientId: body.recipient_id,
      idempotencyKey: body.idempotency_key,
    });
  }

  /** The visible report button: reports the Host (or a named member) with the room as evidence. */
  @Post('rooms/:id/report')
  @HttpCode(HttpStatus.CREATED)
  async report(
    @CurrentMember() m: AuthenticatedMember,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(reportSchema)) body: z.infer<typeof reportSchema>,
  ) {
    const { room } = await this.rooms.get(m.id, id);
    const target = body.user_id ?? room.host.id;
    const report = await this.safety.report(m.id, {
      user_id: target,
      category: body.category,
      details: body.details,
      room_id: id,
    });
    // Reporting blocks (API.md "Safety"): the reporter leaves the room too.
    if (target === room.host.id) await this.rooms.leave(m.id, id);
    return report;
  }
}

/** Live "Chat House" rooms for Verified Hosts (MONETIZATION_PLAN.md 3b), on the same LiveKit setup as calls. */
@Module({
  imports: [AuthModule, WalletModule, HostsModule, MessagingModule, CallsModule, SafetyModule],
  controllers: [RoomsController],
  providers: [RoomsService],
  exports: [RoomsService],
})
export class RoomsModule {}
