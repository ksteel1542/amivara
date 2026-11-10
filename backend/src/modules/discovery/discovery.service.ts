import { HttpStatus, Injectable } from '@nestjs/common';

import { ApiError } from '../../common/api-error';
import { PhotosService } from '../media/photos.service';
import { PROMPTS } from '../profiles/catalog';
import { decodeCursor, encodeCursor } from './cursor';
import { DiscoveryRepository } from './discovery.repository';
import { distanceLabel } from './distance';

const PROMPT_TEXT = new Map<string, string>(PROMPTS.map((p) => [p.id, p.text]));

export interface DiscoveryCard {
  user_id: string;
  first_name: string;
  age: number;
  verified: true;
  distance: { km: number; label: string };
  intent: string;
  bio: string | null;
  prompts: Array<{ prompt_id: string; prompt: string; answer: string }>;
  interests: string[];
  languages: string[];
  height_cm: number | null;
  job_title: string | null;
  education: string | null;
  photos: Array<{ id: string; url: string }>;
}

@Injectable()
export class DiscoveryService {
  constructor(
    private readonly repo: DiscoveryRepository,
    private readonly photos: PhotosService,
  ) {}

  async feed(viewerId: string, opts: { cursor?: string; limit: number }) {
    const viewer = await this.repo.viewer(viewerId);
    if (!viewer.hasProfile) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Profile not found.');
    if (!viewer.hasLocation) {
      throw new ApiError(HttpStatus.CONFLICT, 'LOCATION_REQUIRED', 'Share your location to see people near you.');
    }

    const cursor = opts.cursor ? decodeCursor(opts.cursor) : undefined;
    const anchor = new Date(cursor?.anchor ?? Date.now());
    const rows = await this.repo.candidates(viewerId, {
      anchor,
      after: cursor ? { score: cursor.score, id: cursor.id } : undefined,
      limit: opts.limit + 1, // one extra tells us whether there is a next page
    });

    const page = rows.slice(0, opts.limit);
    const photos = await this.photos.viewsForUsers(page.map((r) => r.id));
    const last = page.at(-1);

    return {
      cards: page.map((r): DiscoveryCard => ({
        user_id: r.id,
        first_name: r.first_name,
        age: r.age,
        verified: true, // only Smile ID-verified adults are ever shown (PRD §5.3a)
        distance: distanceLabel(r.dist_m, viewerId, r.id),
        intent: r.intent.toLowerCase(),
        bio: r.bio,
        prompts: (Array.isArray(r.prompts) ? (r.prompts as Array<{ prompt_id: string; answer: string }>) : []).map(
          (p) => ({ prompt_id: p.prompt_id, prompt: PROMPT_TEXT.get(p.prompt_id) ?? '', answer: p.answer }),
        ),
        interests: r.interests,
        languages: r.languages,
        height_cm: r.height_cm,
        job_title: r.job_title,
        education: r.education,
        photos: photos.get(r.id) ?? [],
      })),
      next_cursor:
        rows.length > opts.limit && last
          ? encodeCursor({ anchor: anchor.getTime(), score: last.score, id: last.id })
          : null,
      radius_km: viewer.maxDistanceKm,
    };
  }
}
