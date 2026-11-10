import { randomUUID } from 'node:crypto';

import { HttpStatus, Injectable, Logger } from '@nestjs/common';

import { ApiError } from '../../common/api-error';
import { randomToken, sha256Hex } from '../../common/crypto';
import { HasherService } from '../../common/hasher.service';
import type { RequestContext } from '../../common/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { ACCESS_TOKEN_TTL_SECONDS, TokensService } from './tokens.service';

export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

/**
 * Device sessions with rotating refresh tokens (SECURITY.md §3).
 * - The refresh token is opaque and stored only as a SHA-256 hash.
 * - Every refresh replaces the session row; the old token is revoked.
 * - Presenting a token that was already rotated means it leaked (or two
 *   clients share it): every session in that family is revoked.
 */
@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly hasher: HasherService,
  ) {}

  async create(userId: string, ctx: RequestContext): Promise<TokenPair> {
    return this.open(userId, randomUUID(), ctx);
  }

  async refresh(refreshToken: string, ctx: RequestContext): Promise<TokenPair> {
    const session = await this.prisma.deviceSession.findUnique({
      where: { refreshTokenHash: sha256Hex(refreshToken) },
      include: { user: { select: { status: true, deletedAt: true } } },
    });
    if (!session) throw invalidRefresh();

    if (session.revokedAt) {
      if (session.replacedById) {
        const revoked = await this.prisma.deviceSession.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        this.logger.warn(`Refresh token reuse: revoked ${revoked.count} session(s) in family ${session.familyId}`);
        throw new ApiError(HttpStatus.UNAUTHORIZED, 'REFRESH_TOKEN_REUSED', 'Please sign in again.');
      }
      throw invalidRefresh();
    }
    if (session.expiresAt <= new Date()) throw invalidRefresh();
    if (session.user.status === 'BANNED') {
      throw new ApiError(HttpStatus.FORBIDDEN, 'ACCOUNT_SUSPENDED', 'This account is not active.');
    }

    const nextId = randomUUID();
    const pair = this.newPair(session.userId, nextId);
    await this.prisma.$transaction(async (tx) => {
      // Conditional revoke: if a concurrent refresh already rotated this token, abort.
      const claimed = await tx.deviceSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: new Date(), replacedById: nextId },
      });
      if (claimed.count === 0) throw invalidRefresh();
      await tx.deviceSession.create({
        data: {
          id: nextId,
          userId: session.userId,
          familyId: session.familyId,
          refreshTokenHash: sha256Hex(pair.refresh_token),
          platform: ctx.platform ?? session.platform,
          deviceModel: ctx.deviceModel ?? session.deviceModel,
          ipHash: this.hasher.hashOptional('ip', ctx.ip),
          expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
        },
      });
    });
    return pair;
  }

  async revoke(sessionId: string, userId: string): Promise<boolean> {
    const result = await this.prisma.deviceSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count > 0;
  }

  async list(userId: string) {
    return this.prisma.deviceSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: { id: true, platform: true, deviceModel: true, createdAt: true, lastUsedAt: true },
    });
  }

  private async open(userId: string, familyId: string, ctx: RequestContext): Promise<TokenPair> {
    const id = randomUUID();
    const pair = this.newPair(userId, id);
    await this.prisma.deviceSession.create({
      data: {
        id,
        userId,
        familyId,
        refreshTokenHash: sha256Hex(pair.refresh_token),
        platform: ctx.platform,
        deviceModel: ctx.deviceModel,
        ipHash: this.hasher.hashOptional('ip', ctx.ip),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      },
    });
    return pair;
  }

  private newPair(userId: string, sessionId: string): TokenPair {
    return {
      access_token: this.tokens.issueAccess(userId, sessionId),
      refresh_token: randomToken(),
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
    };
  }
}

function invalidRefresh(): ApiError {
  return new ApiError(HttpStatus.UNAUTHORIZED, 'INVALID_REFRESH_TOKEN', 'Please sign in again.');
}
