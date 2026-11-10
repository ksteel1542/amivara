import { HttpStatus, Injectable } from '@nestjs/common';

import { ApiError } from '../../common/api-error';
import { PrismaService } from '../../prisma/prisma.service';
import { PhotosService } from '../media/photos.service';
import {
  INTERESTS,
  LANGUAGES,
  MAX_BIO,
  MAX_INTERESTS,
  MAX_LANGUAGES,
  MAX_PROMPT_ANSWER,
  MAX_PROMPTS,
  PROMPTS,
} from './catalog';
import { recomputeCompleteness } from './completeness';
import { GeoRepository } from './geo.repository';
import type { LocationInput, UpdateProfileInput } from './profile.schemas';

const INTENT = {
  relationship: 'RELATIONSHIP',
  friendship: 'FRIENDSHIP',
  casual: 'CASUAL',
  not_sure: 'NOT_SURE',
} as const;

type StoredPrompt = { prompt_id: string; answer: string };

@Injectable()
export class ProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly photos: PhotosService,
    private readonly geo: GeoRepository,
  ) {}

  catalog() {
    return {
      prompts: PROMPTS,
      interests: INTERESTS,
      languages: LANGUAGES,
      limits: {
        prompts: MAX_PROMPTS,
        prompt_answer: MAX_PROMPT_ANSWER,
        interests: MAX_INTERESTS,
        languages: MAX_LANGUAGES,
        bio: MAX_BIO,
        photos: { min: 2, max: 6 },
        height_cm: { min: 120, max: 230 },
      },
    };
  }

  /** The member's own, editable profile. */
  async getOwn(userId: string) {
    const profile = await this.prisma.profile.findUnique({ where: { userId } });
    if (!profile) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Profile not found.');
    const [photos, hasLocation] = await Promise.all([this.photos.list(userId), this.geo.hasLocation(userId)]);

    return {
      first_name: profile.firstName,
      gender: profile.gender.toLowerCase(),
      bio: profile.bio,
      intent: profile.intent.toLowerCase(),
      prompts: (Array.isArray(profile.prompts) ? profile.prompts : []) as StoredPrompt[],
      interests: profile.interests,
      languages: profile.languages,
      height_cm: profile.heightCm,
      education: profile.education,
      job_title: profile.jobTitle,
      religion: profile.religion,
      city: profile.city,
      photos,
      has_location: hasLocation,
      completeness: profile.completenessScore,
    };
  }

  async update(userId: string, input: UpdateProfileInput) {
    await this.prisma.profile.update({
      where: { userId },
      data: {
        ...(input.bio !== undefined ? { bio: input.bio } : {}),
        ...(input.intent !== undefined ? { intent: INTENT[input.intent] } : {}),
        ...(input.prompts !== undefined ? { prompts: input.prompts } : {}),
        ...(input.interests !== undefined ? { interests: input.interests } : {}),
        ...(input.languages !== undefined ? { languages: input.languages } : {}),
        ...(input.height_cm !== undefined ? { heightCm: input.height_cm } : {}),
        ...(input.education !== undefined ? { education: input.education } : {}),
        ...(input.job_title !== undefined ? { jobTitle: input.job_title } : {}),
        ...(input.religion !== undefined ? { religion: input.religion } : {}),
      },
    });
    await recomputeCompleteness(this.prisma, userId);
    return this.getOwn(userId);
  }

  async setLocation(userId: string, input: LocationInput): Promise<void> {
    if (!(await this.geo.setLocation(userId, input.lat, input.lng))) {
      throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Profile not found.');
    }
  }
}
