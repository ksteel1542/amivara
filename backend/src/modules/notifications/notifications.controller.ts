import { Body, Controller, Delete, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { z } from 'zod';

import type { AuthenticatedMember } from '../../common/authenticated-member';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentMember, CurrentSessionId } from '../auth/auth.guards';
import { NotificationsService } from './notifications.service';

const registerSchema = z
  .object({
    token: z.string().min(20).max(4096),
    platform: z.enum(['android', 'web']),
  })
  .strict();
const unregisterSchema = z.object({ token: z.string().min(20).max(4096) }).strict();

/** API.md "Notifications": FCM registration tokens, bound to the device session. */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post('tokens')
  @HttpCode(HttpStatus.NO_CONTENT)
  async register(
    @CurrentMember() member: AuthenticatedMember,
    @CurrentSessionId() sessionId: string,
    @Body(new ZodValidationPipe(registerSchema)) body: z.infer<typeof registerSchema>,
  ): Promise<void> {
    await this.notifications.register(member.id, sessionId, body.token, body.platform);
  }

  @Delete('tokens')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unregister(
    @CurrentMember() member: AuthenticatedMember,
    @Body(new ZodValidationPipe(unregisterSchema)) body: z.infer<typeof unregisterSchema>,
  ): Promise<void> {
    await this.notifications.unregister(member.id, body.token);
  }
}
