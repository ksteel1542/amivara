import { HttpStatus, Injectable } from '@nestjs/common';

import { ApiError } from '../../common/api-error';
import { PrismaService } from '../../prisma/prisma.service';

/** PRD §5.3: daily free like limit (configurable later). */
export const DAILY_LIKE_LIMIT = 50;
/** PRD §6: passed members come back after 30 days. */
export const PASS_TTL_DAYS = 30;

@Injectable()
export class MatchingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Passing only affects the passer's own stack, so it's open to unverified (browse-only) members. */
  async pass(passerId: string, passeeId: string): Promise<void> {
    await this.assertTarget(passerId, passeeId, { mustBeVerified: false });
    const expiresAt = new Date(Date.now() + PASS_TTL_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.pass.upsert({
      where: { passerId_passeeId: { passerId, passeeId } },
      create: { passerId, passeeId, expiresAt },
      update: { expiresAt, createdAt: new Date() },
    });
  }

  /**
   * Likes are behind @RequireAgeVerified(). A like in the other direction
   * creates the match in the same transaction (PRD §5.4: matches are always mutual).
   */
  async like(
    likerId: string,
    likeeId: string,
    isSuper: boolean,
  ): Promise<{ matched: boolean; match_id: string | null }> {
    if (isSuper) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'PLUS_REQUIRED', 'Super Likes come with AMIVARA Plus.');
    }
    await this.assertTarget(likerId, likeeId, { mustBeVerified: true });

    const today = await this.prisma.like.count({
      where: { likerId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    });
    if (today >= DAILY_LIKE_LIMIT) {
      throw new ApiError(
        HttpStatus.TOO_MANY_REQUESTS,
        'DAILY_LIKE_LIMIT',
        `You've used today's ${DAILY_LIKE_LIMIT} likes. More tomorrow.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.like.upsert({
        where: { likerId_likeeId: { likerId, likeeId } },
        create: { likerId, likeeId },
        update: {},
      });
      const mutual = await tx.like.findUnique({ where: { likerId_likeeId: { likerId: likeeId, likeeId: likerId } } });
      if (!mutual) return { matched: false, match_id: null };

      const [userAId, userBId] = likerId < likeeId ? [likerId, likeeId] : [likeeId, likerId];
      const match = await tx.match.upsert({
        where: { userAId_userBId: { userAId, userBId } },
        create: { userAId, userBId },
        update: {},
      });
      return { matched: true, match_id: match.id };
    });
  }

  private async assertTarget(actorId: string, targetId: string, opts: { mustBeVerified: boolean }): Promise<void> {
    if (actorId === targetId) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', "You can't do that to your own profile.");
    }
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { status: true, deletedAt: true, ageVerified: true },
    });
    const blocked = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: actorId, blockedId: targetId },
          { blockerId: targetId, blockedId: actorId },
        ],
      },
      select: { blockerId: true },
    });
    // Same answer for "doesn't exist", "blocked" and "not active": nothing to learn from probing.
    if (
      !target ||
      target.deletedAt ||
      target.status !== 'ACTIVE' ||
      blocked ||
      (opts.mustBeVerified && !target.ageVerified)
    ) {
      throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'This profile is no longer available.');
    }
  }
}
