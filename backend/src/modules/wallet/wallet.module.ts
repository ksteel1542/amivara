import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { LedgerService } from './ledger.service';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

/**
 * Coins (docs/MONETIZATION_PLAN.md): the double-entry ledger, member wallets,
 * starter coins and spending. Top-ups (M2), paid messages and gifts (M3) and
 * call billing (M5) build on WalletService.
 */
@Module({
  imports: [AuthModule],
  controllers: [WalletController],
  providers: [LedgerService, WalletService],
  exports: [LedgerService, WalletService],
})
export class WalletModule {}
