import { createHmac, timingSafeEqual } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ApiError } from '../../common/api-error';
import type { Env } from '../../config/env';

/** Smile ID job types used by AMIVARA. */
export const SMILE_JOB_TYPE = {
  BIOMETRIC_KYC: 1, // NIN checked against NIMC + SmartSelfie liveness + face match
  DOCUMENT_VERIFICATION: 6,
} as const;

const BASE_URL = {
  sandbox: 'https://testapi.smileidentity.com/v1',
  production: 'https://api.smileidentity.com/v1',
} as const;

/** Callbacks whose signature timestamp is older than this are refused (replay protection). */
export const CALLBACK_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** The subset of a Smile ID result (callback or job_status) that the decision needs. */
export interface SmileResult {
  ResultCode?: string;
  ResultText?: string;
  SmileJobID?: string;
  PartnerParams?: { user_id?: string; job_id?: string; job_type?: number | string };
  Actions?: Record<string, string>;
  /** Returned with "Return Personal Info" (Biometric KYC). Format varies by ID authority. */
  DOB?: string;
  IDType?: string;
  Country?: string;
}

export interface JobStatus {
  jobComplete: boolean;
  jobSuccess: boolean;
  result: SmileResult | null;
}

export interface SignedParams {
  partner_id: string;
  timestamp: string;
  signature: string;
}

/**
 * Smile ID REST client (server side only: the API key never leaves the server).
 *
 * Signature scheme: base64(HMAC-SHA256(api_key, timestamp + partner_id + "sid_request")).
 * The same scheme signs our requests and authenticates Smile ID's callbacks.
 */
@Injectable()
export class SmileIdClient {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get configured(): boolean {
    return Boolean(this.partnerId && this.apiKey);
  }

  get environment(): 'sandbox' | 'production' {
    return this.config.get('SMILE_ID_ENVIRONMENT', { infer: true });
  }

  get callbackUrl(): string | undefined {
    return this.config.get('SMILE_ID_CALLBACK_URL', { infer: true });
  }

  private get partnerId(): string | undefined {
    return this.config.get('SMILE_ID_PARTNER_ID', { infer: true });
  }

  private get apiKey(): string | undefined {
    return this.config.get('SMILE_ID_API_KEY', { infer: true });
  }

  sign(timestamp: string = new Date().toISOString()): SignedParams {
    const { partnerId, apiKey } = this.require();
    return { partner_id: partnerId, timestamp, signature: computeSignature(apiKey, partnerId, timestamp) };
  }

  /** Authenticates a callback: correct signature, and a timestamp that is recent and not in the future. */
  verifyCallback(signature: unknown, timestamp: unknown, now = Date.now()): boolean {
    if (!this.configured || typeof signature !== 'string' || typeof timestamp !== 'string') return false;
    const at = Date.parse(timestamp);
    if (Number.isNaN(at) || at > now + CLOCK_SKEW_MS || now - at > CALLBACK_MAX_AGE_MS) return false;

    const expected = Buffer.from(computeSignature(this.apiKey!, this.partnerId!, timestamp), 'base64');
    const given = Buffer.from(signature, 'base64');
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  /** POST /job_status: used by the poller when a callback is late or lost. */
  async jobStatus(userId: string, jobId: string): Promise<JobStatus> {
    const signed = this.sign();
    const response = await fetch(`${BASE_URL[this.environment]}/job_status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...signed, user_id: userId, job_id: jobId, image_links: false, history: false }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Smile ID job_status returned HTTP ${response.status}`);

    const body = (await response.json()) as {
      job_complete?: boolean;
      job_success?: boolean;
      result?: SmileResult | string;
      signature?: string;
      timestamp?: string;
    };
    if (!this.verifyCallback(body.signature, body.timestamp)) {
      throw new Error('Smile ID job_status response failed signature verification');
    }
    return {
      jobComplete: body.job_complete === true,
      jobSuccess: body.job_success === true,
      result: typeof body.result === 'object' && body.result !== null ? body.result : null,
    };
  }

  private require(): { partnerId: string; apiKey: string } {
    if (!this.partnerId || !this.apiKey) {
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'VERIFICATION_UNAVAILABLE',
        'Identity verification is not available right now. Please try again later.',
      );
    }
    return { partnerId: this.partnerId, apiKey: this.apiKey };
  }
}

export function computeSignature(apiKey: string, partnerId: string, timestamp: string): string {
  return createHmac('sha256', apiKey)
    .update(timestamp, 'utf8')
    .update(partnerId, 'utf8')
    .update('sid_request', 'utf8')
    .digest('base64');
}
