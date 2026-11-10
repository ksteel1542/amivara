import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';

import type { AuthenticatedMember } from '../../common/authenticated-member';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentMember } from '../auth/auth.guards';
import { AccountService } from './account.service';

const settingsSchema = z
  .object({ paused: z.boolean().optional(), incognito: z.boolean().optional() })
  .strict()
  .refine((s) => s.paused !== undefined || s.incognito !== undefined, 'Nothing to change');

/** API.md "Account controls & privacy": settings, the NDPA data export and account deletion. */
@Controller('users/me')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get('settings')
  settings(@CurrentMember() member: AuthenticatedMember) {
    return this.account.settings(member.id);
  }

  @Patch('settings')
  update(
    @CurrentMember() member: AuthenticatedMember,
    @Body(new ZodValidationPipe(settingsSchema)) body: z.infer<typeof settingsSchema>,
  ) {
    return this.account.updateSettings(member.id, body, member);
  }

  /** A download, never cached anywhere on the way. */
  @Get('export')
  async export(@CurrentMember() member: AuthenticatedMember, @Res({ passthrough: true }) res: Response) {
    const data = await this.account.export(member.id);
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="amivara-data-${day}.json"`);
    res.setHeader('Cache-Control', 'no-store');
    return data;
  }

  @Delete()
  @HttpCode(HttpStatus.ACCEPTED)
  delete(@CurrentMember() member: AuthenticatedMember) {
    return this.account.delete(member.id);
  }
}
