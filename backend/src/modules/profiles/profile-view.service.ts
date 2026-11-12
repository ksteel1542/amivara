import { HttpStatus, Injectable } from '@nestjs/common';

import { ApiError } from '../../common/api-error';
import { PrismaService } from '../../prisma/prisma.service';
import { distanceLabel } from '../discovery/distance';
import { PhotosService } from '../media/photos.service';
import { currentAge } from '../users/age';
import { PROMPTS } from './catalog';

const PROMPT_TEXT = new Map<string, string>(PROMPTS.map((p) => [p.id, p.text]));

/**
 * Another member's full profile (API.md "Account & Profile": GET /profiles/:userId).
 * Same shape as a discovery card, plus `match_id` when you're matched.
 *
 * Visible only when you could meet them: not blocked either way, not an ended
 * match, and they're a verified member in good standing (a paused member stays
 * visible to an active match only). Anything else is the same 404, so the
 * endpoint can't be used to probe who exists or who blocked you. Distance is
 * the same coarse, per-pair-jittered label as discovery; never coordinates.
 */
@Injectable()
export class ProfileViewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly photos: PhotosService,
  ) {}

  async view(viewerId: string, targetId: string) {
    const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Profile not found.');
    if (viewerId === targetId) throw notFound();

    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      include: { profile: true },
    });
    if (!target?.profile || target.deletedAt || !target.ageVerified) throw notFound();

    const [userAId, userBId] = viewerId < targetId ? [viewerId, targetId] : [targetId, viewerId];
    const [blocked, match] = await Promise.all([
      this.prisma.block.count({
        where: {
          OR: [
            { blockerId: viewerId, blockedId: targetId },
            { blockerId: targetId, blockedId: viewerId },
          ],
        },
      }),
      this.prisma.match.findUnique({ where: { userAId_userBId: { userAId, userBId } } }),
    ]);
    if (blocked > 0 || match?.unmatchedAt) throw notFound();
    const activeMatch = match && !match.unmatchedAt ? match : null;
    const visible = target.status === 'ACTIVE' || (target.status === 'PAUSED' && activeMatch !== null);
    if (!visible) throw notFound();

    const [distanceRow] = await this.prisma.$queryRaw<Array<{ dist_m: number | null }>>`
      SELECT ST_Distance(a.location, b.location)::float8 AS dist_m
        FROM profiles a, profiles b
       WHERE a.user_id = ${viewerId}::uuid AND b.user_id = ${targetId}::uuid`;
    const photos = await this.photos.viewsForUsers([targetId]);
    const p = target.profile;
    const dob = target.dateOfBirth;

    return {
      user_id: target.id,
      first_name: p.firstName,
      age: currentAge({ y: dob.getUTCFullYear(), m: dob.getUTCMonth() + 1, d: dob.getUTCDate() }),
      verified: true as const,
      distance:
        distanceRow?.dist_m !== null && distanceRow?.dist_m !== undefined
          ? distanceLabel(distanceRow.dist_m, viewerId, targetId)
          : null,
      intent: p.intent.toLowerCase(),
      bio: p.bio,
      prompts: (Array.isArray(p.prompts) ? (p.prompts as Array<{ prompt_id: string; answer: string }>) : []).map(
        (q) => ({ prompt_id: q.prompt_id, prompt: PROMPT_TEXT.get(q.prompt_id) ?? '', answer: q.answer }),
      ),
      interests: p.interests,
      languages: p.languages,
      height_cm: p.heightCm,
      job_title: p.jobTitle,
      education: p.education,
      photos: photos.get(targetId) ?? [],
      match_id: activeMatch?.id ?? null,
    };
  }
}
