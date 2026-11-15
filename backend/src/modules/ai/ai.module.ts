import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { WalletModule } from '../wallet/wallet.module';
import { CompanionsController, SpendLimitsController } from './companions.controller';
import { CompanionsService } from './companions.service';
import { LLM_CLIENT, OpenAiClient } from './llm-client';

/**
 * AI Companions (MONETIZATION_PLAN.md M3b) behind a swappable LLM client
 * (LLM_PROVIDER: OpenAI gpt-4o-mini today), plus member spending limits.
 */
@Module({
  imports: [AuthModule, WalletModule],
  controllers: [CompanionsController, SpendLimitsController],
  providers: [OpenAiClient, { provide: LLM_CLIENT, useExisting: OpenAiClient }, CompanionsService],
  exports: [CompanionsService],
})
export class AiModule {}
