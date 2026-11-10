import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

/** Ranking v1 weights (sum = 1.0). See docs/API.md "Discovery". */
export const RANKING_WEIGHTS = {
  distance: 0.4, // closer is better, linear across the viewer's radius
  recency: 0.3, // recent activity, exponential decay with a 72-hour time constant
  ageFit: 0.15, // how centrally each person sits in the other's age range
  completeness: 0.1, // profile completeness (photos, bio, prompts…)
  shuffle: 0.05, // small per-viewer-per-day randomness so feeds aren't static
} as const;

export interface CandidateRow {
  id: string;
  first_name: string;
  age: number;
  dist_m: number;
  score: number;
  bio: string | null;
  intent: string;
  prompts: unknown;
  interests: string[];
  languages: string[];
  height_cm: number | null;
  job_title: string | null;
  education: string | null;
}

export interface ViewerState {
  hasProfile: boolean;
  hasLocation: boolean;
  maxDistanceKm: number;
}

/**
 * The discovery query (PRD §6), in parameterised PostGIS SQL (Prisma has no
 * geography type). Every PRD §6 rule is a hard filter; ranking only orders
 * candidates who passed them all:
 *   1. both active, not deleted; the candidate is Smile ID-verified (unverified
 *      members are never shown, PRD §5.3a) and visible in discovery
 *   2. mutual gender preference          3. mutual age range
 *   4. within BOTH members' radius (ST_DWithin on the GiST index)
 *   5. no block either way; not already liked, passed (for 30 days) or matched
 *   + at least one uploaded, non-rejected photo; never the viewer themself
 */
@Injectable()
export class DiscoveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async viewer(viewerId: string): Promise<ViewerState> {
    const rows = await this.prisma.$queryRaw<Array<{ has_location: boolean; max_distance_km: number }>>`
      SELECT p.location IS NOT NULL AS has_location, pr.max_distance_km::int AS max_distance_km
        FROM profiles p
        JOIN preferences pr ON pr.user_id = p.user_id
       WHERE p.user_id = ${viewerId}::uuid`;
    const row = rows[0];
    return row
      ? { hasProfile: true, hasLocation: row.has_location, maxDistanceKm: row.max_distance_km }
      : { hasProfile: false, hasLocation: false, maxDistanceKm: 0 };
  }

  async candidates(
    viewerId: string,
    opts: { anchor: Date; after?: { score: number; id: string }; limit: number },
  ): Promise<CandidateRow[]> {
    const w = RANKING_WEIGHTS;
    const afterScore = opts.after?.score ?? null;
    const afterId = opts.after?.id ?? null;
    const day = opts.anchor.toISOString().slice(0, 10);

    return this.prisma.$queryRaw<CandidateRow[]>`
      WITH me AS (
        SELECT u.id, u.date_of_birth, p.gender, p.location,
               pr.interested_in, pr.age_min, pr.age_max, pr.max_distance_km,
               date_part('year', age(CURRENT_DATE, u.date_of_birth))::int AS age
          FROM users u
          JOIN profiles p     ON p.user_id = u.id
          JOIN preferences pr ON pr.user_id = u.id
         WHERE u.id = ${viewerId}::uuid AND p.location IS NOT NULL
      ),
      candidates AS (
        SELECT u.id, p.first_name, p.bio, p.intent::text AS intent, p.prompts, p.interests, p.languages,
               p.height_cm::int AS height_cm, p.job_title, p.education, p.completeness_score,
               date_part('year', age(CURRENT_DATE, u.date_of_birth))::int AS age,
               ST_Distance(p.location, me.location)::float8 AS dist_m,
               me.max_distance_km, me.age_min AS my_min, me.age_max AS my_max, me.age AS my_age,
               pr.age_min AS their_min, pr.age_max AS their_max,
               GREATEST(u.last_active_at, p.updated_at) AS active_at
          FROM me
          JOIN profiles p     ON ST_DWithin(p.location, me.location, me.max_distance_km * 1000)
          JOIN users u        ON u.id = p.user_id
          JOIN preferences pr ON pr.user_id = u.id
         WHERE u.id <> me.id
           AND u.status = 'ACTIVE' AND u.deleted_at IS NULL AND u.age_verified
           AND pr.show_me_in_discovery
           -- Incognito members are only shown to people they've liked (PRD §5.6).
           AND (NOT pr.incognito OR EXISTS (SELECT 1 FROM likes il WHERE il.liker_id = u.id AND il.likee_id = me.id))
           AND p.gender = ANY (me.interested_in)
           AND me.gender = ANY (pr.interested_in)
           AND date_part('year', age(CURRENT_DATE, u.date_of_birth)) BETWEEN me.age_min AND me.age_max
           AND me.age BETWEEN pr.age_min AND pr.age_max
           AND ST_DWithin(p.location, me.location, pr.max_distance_km * 1000)
           AND NOT EXISTS (SELECT 1 FROM blocks b
                            WHERE (b.blocker_id = me.id AND b.blocked_id = u.id)
                               OR (b.blocker_id = u.id AND b.blocked_id = me.id))
           AND NOT EXISTS (SELECT 1 FROM likes l WHERE l.liker_id = me.id AND l.likee_id = u.id)
           AND NOT EXISTS (SELECT 1 FROM passes s
                            WHERE s.passer_id = me.id AND s.passee_id = u.id AND s.expires_at > now())
           -- Matched pairs never meet again in discovery, including after an unmatch (PRD 5.4).
           AND NOT EXISTS (SELECT 1 FROM matches m
                            WHERE m.user_a_id = LEAST(me.id, u.id) AND m.user_b_id = GREATEST(me.id, u.id))
           AND EXISTS (SELECT 1 FROM profile_photos ph
                        WHERE ph.user_id = u.id AND ph.status = 'UPLOADED' AND ph.moderation_status <> 'REJECTED')
      ),
      scored AS (
        SELECT c.*,
          ( ${w.distance}::float8 * GREATEST(0, 1 - c.dist_m / (c.max_distance_km * 1000.0))
          + ${w.recency}::float8 * exp(-GREATEST(0, extract(epoch FROM (${opts.anchor}::timestamptz - c.active_at))) / (72 * 3600.0))
          + ${w.ageFit}::float8 * (
              ( GREATEST(0, 1 - abs(c.age - (c.my_min + c.my_max) / 2.0) / ((c.my_max - c.my_min) / 2.0 + 1))
              + GREATEST(0, 1 - abs(c.my_age - (c.their_min + c.their_max) / 2.0) / ((c.their_max - c.their_min) / 2.0 + 1))
              ) / 2.0)
          + ${w.completeness}::float8 * (c.completeness_score / 100.0)
          + ${w.shuffle}::float8 * (('x' || substr(md5(${viewerId} || c.id::text || ${day}), 1, 8))::bit(32)::bigint / 4294967295.0)
          )::float8 AS score
        FROM candidates c
      )
      SELECT id, first_name, age, dist_m, score, bio, intent, prompts, interests, languages,
             height_cm, job_title, education
        FROM scored
       WHERE ${afterScore}::float8 IS NULL OR (score, id) < (${afterScore}::float8, ${afterId}::uuid)
       ORDER BY score DESC, id DESC
       LIMIT ${opts.limit}::int`;
  }
}
