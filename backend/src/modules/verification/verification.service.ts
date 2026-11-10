import { randomUUID } from 'node:crypto';

import { HttpStatus, Injectable, Logger } from '@nestjs/common';

import { ApiError } from '../../common/api-error';
import { PrismaService } from '../../prisma/prisma.service';
import { decide, MAX_FAILED_ATTEMPTS, type Outcome } from './decision';
import { SMILE_JOB_TYPE, SmileIdClient, type SmileResult } from './smile-id.client';

export type VerificationMethod = 'biometric_kyc';

/** Sessions that never produced a result expire after this long. */
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
/** At most this many sessions per member per day (abuse and cost control). */
export const MAX_SESSIONS_PER_DAY = 5;

const KYC_TYPES = ['BIOMETRIC_KYC', 'DOCUMENT_VERIFICATION'] as const;

/**
 * Smile ID identity and age assurance (PRD §7, ARCHITECTURE.md §5):
 * 1. POST /verification/sessions  → our job ids + a server-made signature
 * 2. the app runs the Smile ID SDK (SmartSelfie + NIN), which submits to Smile ID
 * 3. Smile ID calls POST /verification/webhook (or the poller asks job_status)
 * 4. applyResult() decides once, idempotently, and unlocks liking and chatting.
 */
@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly smile: SmileIdClient,
  ) {}

  async createSession(userId: string, method: VerificationMethod = 'biometric_kyc') {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { ageVerified: true } });
    if (user.ageVerified) {
      throw new ApiError(HttpStatus.CONFLICT, 'ALREADY_VERIFIED', "You're already verified.");
    }
    const latest = await this.latest(userId);
    if (latest?.status === 'MANUAL_REVIEW') {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'UNDER_REVIEW',
        "We're taking a closer look at your verification. Usually within 24 hours.",
      );
    }
    const today = await this.prisma.verification.count({
      where: { userId, type: { in: [...KYC_TYPES] }, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    });
    if (today >= MAX_SESSIONS_PER_DAY) {
      throw new ApiError(
        HttpStatus.TOO_MANY_REQUESTS,
        'VERIFICATION_RATE_LIMITED',
        'Too many verification attempts today. Please try again tomorrow.',
        {
          retry_after: 24 * 60 * 60,
        },
      );
    }

    const signed = this.smile.sign(); // throws VERIFICATION_UNAVAILABLE if Smile ID is not configured
    const failures = await this.failures(userId);
    const jobId = randomUUID();

    // Only one open session at a time: older ones can no longer complete.
    await this.prisma.verification.updateMany({
      where: { userId, status: 'PENDING', type: { in: [...KYC_TYPES] } },
      data: { status: 'EXPIRED', completedAt: new Date(), failureReason: 'superseded' },
    });
    const row = await this.prisma.verification.create({
      data: {
        userId,
        type: 'BIOMETRIC_KYC',
        provider: 'SMILE_ID',
        status: 'PENDING',
        providerJobId: jobId,
        idType: 'NIN_V2',
        attempt: failures + 1,
      },
    });

    return {
      verification_id: row.id,
      environment: this.smile.environment,
      callback_url: this.smile.callbackUrl ?? null,
      partner_params: { user_id: userId, job_id: jobId, job_type: SMILE_JOB_TYPE.BIOMETRIC_KYC },
      id_info: { country: 'NG', id_type: 'NIN_V2' },
      ...signed,
      attempts_left: Math.max(0, MAX_FAILED_ATTEMPTS - failures),
    };
  }

  /** Smile ID callback. Authenticated by signature; safe to receive more than once. */
  async handleCallback(body: SmileResult & { signature?: unknown; timestamp?: unknown }): Promise<{ status: string }> {
    if (!this.smile.verifyCallback(body.signature, body.timestamp)) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'INVALID_SIGNATURE', 'Invalid signature.');
    }
    const jobId = body.PartnerParams?.job_id;
    const userId = body.PartnerParams?.user_id;
    if (typeof jobId !== 'string' || typeof userId !== 'string') return { status: 'ignored' };

    const row = await this.prisma.verification.findUnique({ where: { providerJobId: jobId } });
    if (!row || row.userId !== userId) {
      this.logger.warn(`Callback for unknown job ${jobId}`);
      return { status: 'ignored' };
    }
    return { status: await this.applyResult(row.id, body) };
  }

  /** Member-facing status, used by the app while it waits on screen 5d. */
  async status(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { ageVerified: true, phoneVerifiedAt: true },
    });
    const latest = await this.latest(userId);
    const failures = await this.failures(userId);
    return {
      phone: user.phoneVerifiedAt !== null,
      age_verified: user.ageVerified,
      latest: latest
        ? {
            verification_id: latest.id,
            status: latest.status.toLowerCase(),
            reason: latest.failureReason,
            created_at: latest.createdAt.toISOString(),
          }
        : null,
      attempts_left: user.ageVerified ? 0 : Math.max(0, MAX_FAILED_ATTEMPTS - failures),
    };
  }

  /**
   * Applies a Smile ID result exactly once: only a PENDING row can change.
   * Returns the resulting status (or "already_processed").
   */
  async applyResult(verificationId: string, result: SmileResult): Promise<string> {
    const row = await this.prisma.verification.findUniqueOrThrow({
      where: { id: verificationId },
      include: { user: { select: { id: true, dateOfBirth: true } } },
    });
    if (row.status !== 'PENDING') return 'already_processed';

    const dob = row.user.dateOfBirth;
    const outcome: Outcome = decide(result, {
      declaredDob: { y: dob.getUTCFullYear(), m: dob.getUTCMonth() + 1, d: dob.getUTCDate() },
      previousFailures: await this.failures(row.userId),
    });
    if (outcome.status === 'PENDING') return 'pending';

    const now = new Date();
    const applied = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.verification.updateMany({
        where: { id: row.id, status: 'PENDING' },
        data: {
          status: outcome.status,
          providerRef: result.SmileJobID ?? null,
          resultCode: result.ResultCode?.slice(0, 16) ?? null,
          resultText: result.ResultText?.slice(0, 255) ?? null,
          verifiedAgeBand: 'ageBand' in outcome ? (outcome.ageBand ?? null) : null,
          verifiedAdult:
            outcome.status === 'PASSED'
              ? true
              : outcome.status === 'FAILED' && outcome.reason === 'UNDERAGE'
                ? false
                : null,
          dobMatches:
            outcome.status === 'PASSED'
              ? true
              : 'reason' in outcome && outcome.reason === 'DOB_MISMATCH'
                ? false
                : null,
          failureReason: 'reason' in outcome ? outcome.reason : null,
          completedAt: now,
        },
      });
      if (claimed.count === 0) return false; // a concurrent callback or poll got there first

      if (outcome.status === 'PASSED') {
        await tx.user.update({ where: { id: row.userId }, data: { ageVerified: true, ageVerifiedAt: now } });
      }
      if (outcome.status === 'FAILED' && outcome.reason === 'UNDERAGE') {
        // SECURITY.md §1: an ID showing under 18 bans the account at once and ends every session.
        // Purging the remaining data is handled by the account-deletion pipeline (Stage 5).
        await tx.user.update({ where: { id: row.userId }, data: { status: 'BANNED', ageVerified: false } });
        await tx.deviceSession.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: now } });
      }
      return true;
    });

    if (!applied) return 'already_processed';
    this.logger.log(`Verification ${row.id}: ${outcome.status}${'reason' in outcome ? ` (${outcome.reason})` : ''}`);
    return outcome.status.toLowerCase();
  }

  /**
   * Fallback for late or lost callbacks: asks Smile ID about open sessions,
   * and expires sessions that never completed. Safe to run on every instance.
   */
  async pollPending(
    olderThanMs = 2 * 60 * 1000,
    limit = 25,
  ): Promise<{ checked: number; resolved: number; expired: number }> {
    const now = Date.now();
    const expired = await this.prisma.verification.updateMany({
      where: { status: 'PENDING', provider: 'SMILE_ID', createdAt: { lt: new Date(now - SESSION_TTL_MS) } },
      data: { status: 'EXPIRED', completedAt: new Date(), failureReason: 'no_result' },
    });
    if (!this.smile.configured) return { checked: 0, resolved: 0, expired: expired.count };

    const open = await this.prisma.verification.findMany({
      where: { status: 'PENDING', provider: 'SMILE_ID', createdAt: { lt: new Date(now - olderThanMs) } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    let resolved = 0;
    for (const row of open) {
      if (!row.providerJobId) continue;
      try {
        const job = await this.smile.jobStatus(row.userId, row.providerJobId);
        if (job.jobComplete && job.result) {
          const status = await this.applyResult(row.id, job.result);
          if (status !== 'pending' && status !== 'already_processed') resolved++;
        }
      } catch (error) {
        this.logger.warn(`job_status failed for verification ${row.id}: ${(error as Error).message}`);
      }
    }
    return { checked: open.length, resolved, expired: expired.count };
  }

  private latest(userId: string) {
    return this.prisma.verification.findFirst({
      where: { userId, type: { in: [...KYC_TYPES] } },
      orderBy: { createdAt: 'desc' },
    });
  }

  private failures(userId: string): Promise<number> {
    return this.prisma.verification.count({ where: { userId, type: { in: [...KYC_TYPES] }, status: 'FAILED' } });
  }
}
