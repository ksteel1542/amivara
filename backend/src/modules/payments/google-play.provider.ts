import { HttpStatus, Injectable } from '@nestjs/common';

import { ApiError } from '../../common/api-error';
import type { PaymentProvider, ProviderVerification } from './payment-provider';

/**
 * Google Play Billing, for the Play Store build. Not wired yet. Play purchases
 * are verified with a purchase token through the Android Publisher API, which
 * needs a service account and the Play Console products. Until then this
 * provider reports itself unconfigured, so enabling 'google_play' answers
 * 503 PAYMENTS_UNAVAILABLE.
 */
@Injectable()
export class GooglePlayProvider implements PaymentProvider {
  readonly name = 'google_play' as const;
  readonly configured = false;

  startCheckout(): Promise<{ checkoutUrl: string }> {
    return Promise.reject(this.unavailable());
  }

  verify(): Promise<ProviderVerification> {
    return Promise.reject(this.unavailable());
  }

  private unavailable(): ApiError {
    return new ApiError(
      HttpStatus.SERVICE_UNAVAILABLE,
      'PAYMENTS_UNAVAILABLE',
      'Google Play top-ups are not available yet.',
    );
  }
}
