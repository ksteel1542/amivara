import { createHmac, timingSafeEqual } from 'node:crypto';

import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ApiError } from '../../common/api-error';
import type { Env } from '../../config/env';
import type { CheckoutRequest, PaymentProvider, ProviderVerification } from './payment-provider';

const BASE_URL = 'https://api.paystack.co';
const TIMEOUT_MS = 15_000;

/** Card, bank (direct debit), USSD and bank transfer. OPay wallet users pay by bank transfer. */
export const PAYSTACK_CHANNELS = ['card', 'bank', 'ussd', 'bank_transfer'] as const;

/** The parts of Paystack's verify-transaction `data` we read. */
interface PaystackTransaction {
  id?: number | string;
  status?: string;
  reference?: string;
  amount?: number;
  currency?: string;
  channel?: string;
  paid_at?: string | null;
  gateway_response?: string | null;
}

/** x-paystack-signature: hex HMAC-SHA512 of the raw request body, keyed with the secret key. */
export function paystackSignature(rawBody: Buffer | string, secretKey: string): string {
  return createHmac('sha512', secretKey).update(rawBody).digest('hex');
}

/**
 * Paystack REST client (server side only: the secret key never leaves the server).
 * Uses transaction/initialize, transaction/verify/:reference and webhook signatures.
 */
@Injectable()
export class PaystackClient implements PaymentProvider {
  readonly name = 'paystack' as const;
  private readonly logger = new Logger(PaystackClient.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  get configured(): boolean {
    return Boolean(this.secretKey);
  }

  private get secretKey(): string | undefined {
    return this.config.get('PAYSTACK_SECRET_KEY', { infer: true });
  }

  /** Constant-time check of a webhook's x-paystack-signature header. */
  verifySignature(rawBody: Buffer | undefined, signature: unknown): boolean {
    const key = this.secretKey;
    if (!key || !rawBody || typeof signature !== 'string' || !/^[0-9a-f]{128}$/i.test(signature)) return false;
    const expected = Buffer.from(paystackSignature(rawBody, key), 'hex');
    const given = Buffer.from(signature, 'hex');
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  async startCheckout(request: CheckoutRequest): Promise<{ checkoutUrl: string }> {
    const callback = this.config.get('PAYSTACK_CALLBACK_URL', { infer: true });
    const data = await this.call<{ authorization_url?: string }>('POST', '/transaction/initialize', {
      email: request.email,
      amount: request.amountKobo,
      currency: 'NGN',
      reference: request.reference,
      channels: PAYSTACK_CHANNELS,
      ...(callback ? { callback_url: callback } : {}),
      metadata: request.metadata,
    });
    if (!data.authorization_url) throw this.providerError('initialize returned no authorization_url');
    return { checkoutUrl: data.authorization_url };
  }

  async verify(reference: string): Promise<ProviderVerification> {
    const tx = await this.call<PaystackTransaction>('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
    if (tx.reference && tx.reference !== reference) throw this.providerError('verify returned another reference');
    const status = tx.status ?? '';
    return {
      // "success" is final; "failed" and "reversed" are final failures. Anything else
      // (ongoing, pending, abandoned, queued) may still be paid.
      outcome: status === 'success' ? 'succeeded' : status === 'failed' || status === 'reversed' ? 'failed' : 'pending',
      amountKobo: Number(tx.amount ?? 0),
      currency: tx.currency ?? '',
      providerTransactionId: tx.id !== undefined ? String(tx.id) : null,
      channel: tx.channel ? tx.channel.slice(0, 32) : null,
      paidAt: tx.paid_at ? new Date(tx.paid_at) : null,
      reason: tx.gateway_response ? tx.gateway_response.slice(0, 64) : null,
    };
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const key = this.secretKey;
    if (!key) {
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'PAYMENTS_UNAVAILABLE',
        'Top-ups are not available right now.',
      );
    }
    const route = `${method} ${path.split('/').slice(0, 3).join('/')}`; // no reference in logs
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw this.providerError(`${route}: ${(error as Error).message}`);
    }
    const json = (await res.json().catch(() => null)) as { status?: boolean; message?: string; data?: T } | null;
    if (!res.ok || !json?.status || json.data === undefined) {
      throw this.providerError(`${route}: HTTP ${res.status} ${json?.message ?? ''}`);
    }
    return json.data;
  }

  private providerError(detail: string): ApiError {
    this.logger.warn(`Paystack: ${detail}`);
    return new ApiError(
      HttpStatus.BAD_GATEWAY,
      'PAYMENT_PROVIDER_ERROR',
      "We couldn't reach the payment provider. Please try again.",
    );
  }
}
