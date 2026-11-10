import { randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CountryCode } from 'libphonenumber-js';

import type { Prisma } from '../../../generated/prisma';
import { ApiError } from '../../common/api-error';
import { randomOtp, safeEqualHex } from '../../common/crypto';
import { HasherService } from '../../common/hasher.service';
import type { RequestContext } from '../../common/request-context';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { OTP_SENDER, type OtpChannelName, type OtpSender } from './otp-sender';
import { maskPhone, normalizeMobile, parseCountries } from './phone';

/** SECURITY.md §2 and UI_WIREFRAMES.md Screen 2. */
export const OTP_POLICY = {
  codeTtlSeconds: 5 * 60,
  maxAttempts: 5,
  lockoutSeconds: 15 * 60,
  firstResendSeconds: 60,
  laterResendSeconds: 120,
  window10m: 10 * 60,
  window24h: 24 * 60 * 60,
  perPhone: { in10m: 3, in24h: 10 },
  perDevice: { in10m: 3, in24h: 10 },
  // Generous: Nigerian carriers put many subscribers behind one CGNAT address.
  perIp: { in10m: 30, in24h: 200 },
} as const;

export interface OtpRequestResult {
  challengeId: string;
  channel: OtpChannelName;
  expiresIn: number;
  resendIn: number;
}

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly countries: CountryCode[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: HasherService,
    @Inject(OTP_SENDER) private readonly sender: OtpSender,
    config: ConfigService<Env, true>,
  ) {
    this.countries = parseCountries(config.get('PHONE_COUNTRIES', { infer: true }));
  }

  normalize(phone: string): string {
    return normalizeMobile(phone, this.countries);
  }

  async request(phoneInput: string, channel: OtpChannelName, ctx: RequestContext): Promise<OtpRequestResult> {
    const phone = this.normalize(phoneInput);
    const ipHash = this.hasher.hashOptional('ip', ctx.ip);
    const deviceHash = this.hasher.hashOptional('device', ctx.deviceId);
    const now = Date.now();

    await this.enforceLimits(phone, ipHash, deviceHash, now);

    const id = randomUUID();
    const code = randomOtp();
    await this.prisma.otpChallenge.create({
      data: {
        id,
        phoneE164: phone,
        channel: channel === 'whatsapp' ? 'WHATSAPP' : 'SMS',
        codeHash: this.codeHash(id, code),
        expiresAt: new Date(now + OTP_POLICY.codeTtlSeconds * 1000),
        ipHash,
        deviceHash,
      },
    });

    try {
      await this.sender.send(phone, code, channel);
    } catch (error) {
      // Burn the challenge so an undelivered code can never be used.
      await this.prisma.otpChallenge.update({ where: { id }, data: { consumedAt: new Date() } });
      this.logger.error(`OTP delivery failed for ${maskPhone(phone)} via ${channel}: ${(error as Error).message}`);
      throw new ApiError(
        HttpStatus.BAD_GATEWAY,
        'OTP_DELIVERY_FAILED',
        'We could not send your code. Try again or use another channel.',
      );
    }

    const recent = await this.countSince({ phoneE164: phone }, now - OTP_POLICY.window10m * 1000);
    return {
      challengeId: id,
      channel,
      expiresIn: OTP_POLICY.codeTtlSeconds,
      resendIn: recent >= 2 ? OTP_POLICY.laterResendSeconds : OTP_POLICY.firstResendSeconds,
    };
  }

  /** Checks the code. Returns the verified phone number; throws on any failure. */
  async verify(challengeId: string, code: string): Promise<string> {
    const challenge = await this.prisma.otpChallenge.findUnique({ where: { id: challengeId } });
    const now = new Date();

    if (!challenge || challenge.consumedAt || challenge.expiresAt <= now) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'OTP_EXPIRED', 'This code has expired. Request a new one.');
    }
    if (challenge.attempts >= OTP_POLICY.maxAttempts) {
      throw lockedError(OTP_POLICY.lockoutSeconds);
    }

    if (!/^\d{6}$/.test(code) || !safeEqualHex(this.codeHash(challenge.id, code), challenge.codeHash)) {
      // Conditional increment: concurrent guesses cannot exceed the cap.
      const bumped = await this.prisma.otpChallenge.updateMany({
        where: { id: challenge.id, attempts: { lt: OTP_POLICY.maxAttempts }, consumedAt: null },
        data: { attempts: { increment: 1 } },
      });
      const attemptsLeft = Math.max(0, OTP_POLICY.maxAttempts - challenge.attempts - 1);
      if (bumped.count === 0 || attemptsLeft === 0) throw lockedError(OTP_POLICY.lockoutSeconds);
      throw new ApiError(HttpStatus.BAD_REQUEST, 'OTP_INVALID', "That code isn't right.", {
        attempts_left: attemptsLeft,
      });
    }

    // Single use, even under concurrent requests.
    const consumed = await this.prisma.otpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: now },
    });
    if (consumed.count === 0) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'OTP_EXPIRED', 'This code has already been used. Request a new one.');
    }
    return challenge.phoneE164;
  }

  private codeHash(challengeId: string, code: string): string {
    return this.hasher.hash('otp', `${challengeId}:${code}`);
  }

  private async enforceLimits(phone: string, ipHash?: string, deviceHash?: string, now = Date.now()): Promise<void> {
    const since10m = now - OTP_POLICY.window10m * 1000;
    const since24h = now - OTP_POLICY.window24h * 1000;

    // Lockout after too many wrong codes on any recent challenge for this phone.
    const locked = await this.prisma.otpChallenge.findFirst({
      where: {
        phoneE164: phone,
        attempts: { gte: OTP_POLICY.maxAttempts },
        createdAt: { gte: new Date(now - OTP_POLICY.lockoutSeconds * 1000) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (locked) {
      throw lockedError(secondsUntil(locked.createdAt.getTime() + OTP_POLICY.lockoutSeconds * 1000, now));
    }

    // Resend cooldown (60s, then 120s).
    const last = await this.prisma.otpChallenge.findFirst({
      where: { phoneE164: phone },
      orderBy: { createdAt: 'desc' },
    });
    if (last) {
      const recentCount = await this.countSince({ phoneE164: phone }, since10m);
      const cooldown = recentCount >= 2 ? OTP_POLICY.laterResendSeconds : OTP_POLICY.firstResendSeconds;
      const readyAt = last.createdAt.getTime() + cooldown * 1000;
      if (readyAt > now) throw rateLimited(secondsUntil(readyAt, now));
    }

    const checks: Array<[Prisma.OtpChallengeWhereInput, { in10m: number; in24h: number }]> = [
      [{ phoneE164: phone }, OTP_POLICY.perPhone],
    ];
    if (deviceHash) checks.push([{ deviceHash }, OTP_POLICY.perDevice]);
    if (ipHash) checks.push([{ ipHash }, OTP_POLICY.perIp]);

    for (const [where, limit] of checks) {
      if ((await this.countSince(where, since10m)) >= limit.in10m) {
        throw rateLimited(await this.retryAfter(where, since10m, OTP_POLICY.window10m, now));
      }
      if ((await this.countSince(where, since24h)) >= limit.in24h) {
        throw rateLimited(await this.retryAfter(where, since24h, OTP_POLICY.window24h, now));
      }
    }
  }

  private countSince(where: Prisma.OtpChallengeWhereInput, sinceMs: number): Promise<number> {
    return this.prisma.otpChallenge.count({ where: { ...where, createdAt: { gte: new Date(sinceMs) } } });
  }

  /** When the oldest request in the window falls out of it. */
  private async retryAfter(
    where: Prisma.OtpChallengeWhereInput,
    sinceMs: number,
    windowSeconds: number,
    now: number,
  ): Promise<number> {
    const oldest = await this.prisma.otpChallenge.findFirst({
      where: { ...where, createdAt: { gte: new Date(sinceMs) } },
      orderBy: { createdAt: 'asc' },
    });
    return oldest ? secondsUntil(oldest.createdAt.getTime() + windowSeconds * 1000, now) : windowSeconds;
  }
}

function secondsUntil(targetMs: number, now: number): number {
  return Math.max(1, Math.ceil((targetMs - now) / 1000));
}

function rateLimited(retryAfter: number): ApiError {
  return new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'OTP_RATE_LIMITED', 'Too many tries. Please wait a moment.', {
    retry_after: retryAfter,
  });
}

function lockedError(retryAfter: number): ApiError {
  return new ApiError(
    HttpStatus.TOO_MANY_REQUESTS,
    'OTP_LOCKED',
    'Too many wrong codes. Please wait before trying again.',
    {
      retry_after: retryAfter,
    },
  );
}
