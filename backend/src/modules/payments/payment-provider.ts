/** Checkout providers (MONETIZATION_PLAN.md 2a). Chosen per app build, accepted per PAYMENT_PROVIDERS. */
export type ProviderName = 'paystack' | 'google_play';

/** Providers PAYMENT_PROVIDERS turns on (whether each is configured is the provider's own call). */
export function enabledProviders(setting: string): Set<ProviderName> {
  return new Set(
    setting
      .split(',')
      .map((p) => p.trim())
      .filter((p): p is ProviderName => p === 'paystack' || p === 'google_play'),
  );
}

export const PROVIDER_ENUM = { paystack: 'PAYSTACK', google_play: 'GOOGLE_PLAY' } as const;

/** What the provider says about one payment, from its own API (never from a webhook body). */
export interface ProviderVerification {
  outcome: 'succeeded' | 'failed' | 'pending';
  amountKobo: number;
  currency: string;
  providerTransactionId: string | null;
  /** card, bank, ussd, bank_transfer... */
  channel: string | null;
  paidAt: Date | null;
  /** Short provider reason for a failure, e.g. "Declined" */
  reason: string | null;
}

export interface CheckoutRequest {
  reference: string;
  amountKobo: number;
  /** Receipt address: the member's verified email, or a pseudonymous one */
  email: string;
  metadata: Record<string, string | number>;
}

/**
 * One checkout provider. A top-up only credits coins after `verify` confirms the
 * payment with the provider it came from (Paystack's verify transaction, or
 * Google's Purchases API for Play Billing).
 */
export interface PaymentProvider {
  readonly name: ProviderName;
  readonly configured: boolean;
  /** Starts a hosted checkout and returns the URL the member pays on. */
  startCheckout(request: CheckoutRequest): Promise<{ checkoutUrl: string }>;
  verify(reference: string): Promise<ProviderVerification>;
}
