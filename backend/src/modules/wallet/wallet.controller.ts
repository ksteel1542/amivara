import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';

import type { AuthenticatedMember } from '../../common/authenticated-member';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentMember, CurrentSessionId } from '../auth/auth.guards';
import { RequireActiveMember } from '../verification/active-member.guard';
import { WalletService } from './wallet.service';

const historyQuery = z
  .object({ before: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(50).default(20) })
  .strict();

/** API.md "Wallet" (MONETIZATION_PLAN.md M1): coin balance, packages and history. */
@Controller('wallet')
@RequireActiveMember()
export class WalletController {
  constructor(private readonly wallets: WalletService) {}

  /** Balance (promo + paid), starter coins (granted on first load when due) and top-up packages. */
  @Get()
  wallet(@CurrentMember() member: AuthenticatedMember, @CurrentSessionId() sessionId: string) {
    return this.wallets.wallet(member.id, sessionId);
  }

  @Get('transactions')
  history(
    @CurrentMember() member: AuthenticatedMember,
    @Query(new ZodValidationPipe(historyQuery)) query: z.infer<typeof historyQuery>,
  ) {
    return this.wallets.history(member.id, query);
  }
}
