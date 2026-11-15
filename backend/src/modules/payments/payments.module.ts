import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { WalletModule } from '../wallet/wallet.module';
import { GooglePlayProvider } from './google-play.provider';
import { PaymentsReconciler } from './payments.reconciler';
import { PaymentsWebhookController, TopupsController } from './payments.controller';
import { PAYMENT_PROVIDER_LIST, PaymentsService } from './payments.service';
import { PaystackClient } from './paystack.client';

/**
 * Coin top-ups (MONETIZATION_PLAN.md M2): Paystack checkout now, Google Play
 * Billing behind the same PaymentProvider interface. PAYMENT_PROVIDERS picks
 * which ones the API accepts.
 */
@Module({
  imports: [AuthModule, WalletModule],
  controllers: [TopupsController, PaymentsWebhookController],
  providers: [
    PaystackClient,
    GooglePlayProvider,
    {
      provide: PAYMENT_PROVIDER_LIST,
      useFactory: (paystack: PaystackClient, play: GooglePlayProvider) => [paystack, play],
      inject: [PaystackClient, GooglePlayProvider],
    },
    PaymentsService,
    PaymentsReconciler,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
