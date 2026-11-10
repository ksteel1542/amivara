import { HttpStatus, Injectable } from '@nestjs/common';

import { ApiError } from '../../common/api-error';
import { DomainEvents } from '../../common/domain-events';
import { PrismaService } from '../../prisma/prisma.service';
import { PhotosService } from '../media/photos.service';
import { currentAge } from '../users/age';

/** PRD §5.3: daily free like limit (configurable later). */
export const DAILY_LIKE_LIMIT = 50;
/** PRD §6: passed members come back after 30 days. */
export const PASS_TTL_DAYS = 30;

@Injectable()
export class MatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
    private readonly photos: PhotosService,
  ) {}

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

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.like.upsert({
        where: { likerId_likeeId: { likerId, likeeId } },
        create: { likerId, likeeId },
        update: {},
      });
      const mutual = await tx.like.findUnique({ where: { likerId_likeeId: { likerId: likeeId, likeeId: likerId } } });
      if (!mutual) return { matched: false, match_id: null as string | null, created: false };

      const [userAId, userBId] = likerId < likeeId ? [likerId, likeeId] : [likeeId, likerId];
      const existing = await tx.match.findUnique({ where: { userAId_userBId: { userAId, userBId } } });
      // Unmatching is final (PRD 5.4): a later like never quietly re-creates the match.
      if (existing?.unmatchedAt) return { matched: false, match_id: null as string | null, created: false };
      if (existing) return { matched: true, match_id: existing.id as string | null, created: false };
      const match = await tx.match.create({ data: { userAId, userBId } });
      return { matched: true, match_id: match.id as string | null, created: true };
    });

    if (result.created && result.match_id) {
      this.events.emit('match.created', { matchId: result.match_id, userIds: [likerId, likeeId] });
    }
    return { matched: result.matched, match_id: result.match_id };
  }

  /** Active matches, most recent conversation first (PRD 5.4). */
  async list(userId: string) {
    const person = {
      select: {
        id: true,
        dateOfBirth: true,
        ageVerified: true,
        status: true,
        profile: { select: { firstName: true } },
      },
    } as const;
    const matches = await this.prisma.match.findMany({
      where: { unmatchedAt: null, OR: [{ userAId: userId }, { userBId: userId }] },
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 200,
      include: {
        userA: person,
        userB: person,
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { body: true, type: true, senderId: true, createdAt: true },
        },
      },
    });

    // Hide matches with members who have since been banned or deleted.
    const visible = matches.filter((m) => {
      const other = m.userAId === userId ? m.userB : m.userA;
      return other.status === 'ACTIVE' || other.status === 'PAUSED';
    });
    const otherIds = visible.map((m) => (m.userAId === userId ? m.userBId : m.userAId));
    const [photos, unread] = await Promise.all([
      this.photos.viewsForUsers(otherIds),
      this.prisma.message.groupBy({
        by: ['matchId'],
        where: { matchId: { in: visible.map((m) => m.id) }, senderId: { not: userId }, readAt: null, deletedAt: null },
        _count: { _all: true },
      }),
    ]);
    const unreadByMatch = new Map(unread.map((u) => [u.matchId, u._count._all]));

    return visible.map((m) => {
      const other = m.userAId === userId ? m.userB : m.userA;
      const last = m.messages[0];
      const dob = other.dateOfBirth;
      return {
        match_id: m.id,
        matched_at: m.createdAt.toISOString(),
        photos_unlocked: m.photosUnlocked,
        user: {
          user_id: other.id,
          first_name: other.profile?.firstName ?? '',
          age: currentAge({ y: dob.getUTCFullYear(), m: dob.getUTCMonth() + 1, d: dob.getUTCDate() }),
          verified: other.ageVerified,
          photo_url: photos.get(other.id)?.[0]?.url ?? null,
        },
        last_message: last
          ? {
              snippet: last.type === 'IMAGE' ? 'Photo' : (last.body ?? '').slice(0, 80),
              from_me: last.senderId === userId,
              sent_at: last.createdAt.toISOString(),
            }
          : null,
        unread_count: unreadByMatch.get(m.id) ?? 0,
      };
    });
  }

  /**
   * Unmatch (PRD 5.4): archives the match for both members, closes the
   * conversation (messaging checks unmatched_at), and both disappear from
   * each other's discovery for good. The other member gets a silent refresh.
   */
  async unmatch(userId: string, matchId: string): Promise<void> {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, unmatchedAt: null, OR: [{ userAId: userId }, { userBId: userId }] },
    });
    if (!match) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Match not found.');

    const claimed = await this.prisma.match.updateMany({
      where: { id: match.id, unmatchedAt: null },
      data: { unmatchedAt: new Date(), unmatchedById: userId },
    });
    if (claimed.count === 0) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Match not found.');

    const otherUserId = match.userAId === userId ? match.userBId : match.userAId;
    this.events.emit('match.unmatched', { matchId: match.id, byUserId: userId, otherUserId });
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
