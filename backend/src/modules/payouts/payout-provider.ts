import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ApiError } from '../../common/api-error';
import type { Env } from '../../config/env';

export interface Bank {
  code: string;
  name: string;
}

export type TransferOutcome = 'pending' | 'success' | 'failed' | 'reversed';

/**
 * Where Host payouts go out (MONETIZATION_PLAN.md M7/M8). Swappable: Paystack
 * Transfers today. Tests use a fake, so they never touch a real bank.
 */
export interface PayoutProvider {
  readonly configured: boolean;
  /** Nigerian banks (and OPay and other wallets with NUBANs) that can receive transfers. */
  listBanks(): Promise<Bank[]>;
  /** The account holder's name for a 10-digit NUBAN, or null when the account doesn't exist. */
  resolveAccount(accountNumber: string, bankCode: string): Promise<{ accountName: string } | null>;
  /** Registers the account with the provider; returns its recipient code. */
  createRecipient(input: { name: string; accountNumber: string; bankCode: string }): Promise<string>;
  /** Starts a transfer. Throws only when the provider refused it outright (nothing was sent). */
  transfer(input: { amountKobo: number; recipientCode: string; reference: string; reason: string }): Promise<{
    outcome: TransferOutcome;
    transferCode: string | null;
  }>;
  /** The transfer's current state, looked up by our reference. */
  verifyTransfer(
    reference: string,
  ): Promise<{ outcome: TransferOutcome; transferCode: string | null; reason: string | null }>;
}

export const PAYOUT_PROVIDER = Symbol('PAYOUT_PROVIDER');

/** Paystack refused the transfer itself (bad recipient, insufficient balance…): safe to give the coins back. */
export class TransferRefused extends Error {}

const BASE_URL = 'https://api.paystack.co';
const TIMEOUT_MS = 15_000;
const BANKS_TTL_MS = 24 * 60 * 60 * 1000;

const outcomeOf = (status: string | undefined): TransferOutcome =>
  status === 'success' ? 'success' : status === 'failed' ? 'failed' : status === 'reversed' ? 'reversed' : 'pending';

/**
 * Paystack Transfers: list banks, resolve an account, create a transfer
 * recipient, initiate and verify transfers. Server side only. Transfers need
 * "OTP for transfers" turned off in the Paystack dashboard; a transfer that
 * asks for an OTP stays pending and is flagged in the logs.
 */
@Injectable()
export class PaystackPayouts implements PayoutProvider {
  private readonly logger = new Logger(PaystackPayouts.name);
  private banks?: { at: number; list: Bank[] };

  constructor(private readonly config: ConfigService<Env, true>) {}

  get configured(): boolean {
    return Boolean(this.config.get('PAYSTACK_SECRET_KEY', { infer: true }));
  }

  async listBanks(): Promise<Bank[]> {
    if (this.banks && Date.now() - this.banks.at < BANKS_TTL_MS) return this.banks.list;
    const res = await this.call<Array<{ code?: string; name?: string; active?: boolean; is_deleted?: boolean }>>(
      'GET',
      '/bank?country=nigeria&currency=NGN&perPage=200',
    );
    const list = (res.data ?? [])
      .filter((b) => b.code && b.name && b.active !== false && !b.is_deleted)
      .map((b) => ({ code: b.code!, name: b.name! }))
      .sort((a, b) => a.name.localeCompare(b.name));
    this.banks = { at: Date.now(), list };
    return list;
  }

  async resolveAccount(accountNumber: string, bankCode: string): Promise<{ accountName: string } | null> {
    const res = await this.call<{ account_name?: string }>(
      'GET',
      `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
      undefined,
      { allowClientError: true },
    );
    if (!res.ok || !res.data?.account_name) return null;
    return { accountName: res.data.account_name };
  }

  async createRecipient(input: { name: string; accountNumber: string; bankCode: string }): Promise<string> {
    const res = await this.call<{ recipient_code?: string }>('POST', '/transferrecipient', {
      type: 'nuban',
      name: input.name,
      account_number: input.accountNumber,
      bank_code: input.bankCode,
      currency: 'NGN',
    });
    if (!res.data?.recipient_code) throw this.unavailable('transferrecipient returned no code');
    return res.data.recipient_code;
  }

  async transfer(input: { amountKobo: number; recipientCode: string; reference: string; reason: string }) {
    const res = await this.call<{ status?: string; transfer_code?: string }>(
      'POST',
      '/transfer',
      {
        source: 'balance',
        amount: input.amountKobo,
        recipient: input.recipientCode,
        reference: input.reference,
        reason: input.reason,
        currency: 'NGN',
      },
      { allowClientError: true },
    );
    if (!res.ok) throw new TransferRefused(res.message ?? `HTTP ${res.status}`);
    if (res.data?.status === 'otp') {
      this.logger.warn('Paystack transfer is waiting for an OTP: turn off "OTP for transfers" in the dashboard');
    }
    return { outcome: outcomeOf(res.data?.status), transferCode: res.data?.transfer_code ?? null };
  }

  async verifyTransfer(reference: string) {
    const res = await this.call<{ status?: string; transfer_code?: string; reason?: string; failures?: unknown }>(
      'GET',
      `/transfer/verify/${encodeURIComponent(reference)}`,
    );
    return {
      outcome: outcomeOf(res.data?.status),
      transferCode: res.data?.transfer_code ?? null,
      reason: typeof res.data?.reason === 'string' ? res.data.reason.slice(0, 120) : null,
    };
  }

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    opts: { allowClientError?: boolean } = {},
  ): Promise<{ ok: boolean; status: number; message?: string; data?: T }> {
    const key = this.config.get('PAYSTACK_SECRET_KEY', { infer: true });
    if (!key) throw this.unavailable('no secret key');
    const route = `${method} ${path.split('?')[0]!.split('/').slice(0, 3).join('/')}`; // no account numbers in logs
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw this.unavailable(`${route}: ${(error as Error).message}`);
    }
    const json = (await res.json().catch(() => null)) as { status?: boolean; message?: string; data?: T } | null;
    if (res.ok && json?.status) return { ok: true, status: res.status, data: json.data };
    if (opts.allowClientError && res.status >= 400 && res.status < 500) {
      this.logger.warn(`Paystack ${route}: HTTP ${res.status} ${json?.message ?? ''}`);
      return { ok: false, status: res.status, message: json?.message };
    }
    throw this.unavailable(`${route}: HTTP ${res.status} ${json?.message ?? ''}`);
  }

  private unavailable(detail: string): ApiError {
    this.logger.warn(`Paystack payouts: ${detail}`);
    return new ApiError(
      HttpStatus.BAD_GATEWAY,
      'PAYMENT_PROVIDER_ERROR',
      "We couldn't reach the payment provider. Please try again.",
    );
  }
}
