import { Body, Controller, Get, HttpStatus, Patch } from '@nestjs/common';
import { z } from 'zod';

import { ApiError } from '../../common/api-error';
import type { AuthenticatedMember } from '../../common/authenticated-member';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentMember } from '../auth/auth.guards';

/** PRD §4 / §6: nobody can look for anyone under 18; the database CHECK says the same. */
export const AGE_FLOOR = 18;
export const AGE_CEILING = 99;
export const DISTANCE_KM = { min: 1, max: 300 } as const;

const GENDERS = ['woman', 'man', 'non_binary'] as const;
const age = z.number().int().min(AGE_FLOOR).max(AGE_CEILING);

const preferencesSchema = z
  .object({
    interested_in: z
      .array(z.enum(GENDERS))
      .min(1, 'Choose at least one')
      .max(GENDERS.length)
      .refine((l) => new Set(l).size === l.length, 'No repeats')
      .optional(),
    age_min: age.optional(),
    age_max: age.optional(),
    max_distance_km: z.number().int().min(DISTANCE_KM.min).max(DISTANCE_KM.max).optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, 'Nothing to change');

type PreferencesInput = z.infer<typeof preferencesSchema>;
type Gender = 'WOMAN' | 'MAN' | 'NON_BINARY';

function view(p: { interestedIn: Gender[]; ageMin: number; ageMax: number; maxDistanceKm: number }) {
  return {
    interested_in: p.interestedIn.map((g) => g.toLowerCase()),
    age_min: p.ageMin,
    age_max: p.ageMax,
    max_distance_km: p.maxDistanceKm,
  };
}

/**
 * Discovery preferences (API.md "Account & Profile"): who you want to see,
 * the age range and the radius. Interests and languages are profile fields
 * (PATCH /profiles/me), because other members see them.
 */
@Controller('me/preferences')
export class PreferencesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get(@CurrentMember() member: AuthenticatedMember) {
    return view(await this.prisma.preference.findUniqueOrThrow({ where: { userId: member.id } }));
  }

  @Patch()
  async update(
    @CurrentMember() member: AuthenticatedMember,
    @Body(new ZodValidationPipe(preferencesSchema)) body: PreferencesInput,
  ) {
    const current = await this.prisma.preference.findUniqueOrThrow({ where: { userId: member.id } });
    const ageMin = body.age_min ?? current.ageMin;
    const ageMax = body.age_max ?? current.ageMax;
    if (ageMin > ageMax) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'The youngest age must not be above the oldest.',
        {
          fields: [{ path: 'age_min', message: 'Must not be above age_max' }],
        },
      );
    }
    const updated = await this.prisma.preference.update({
      where: { userId: member.id },
      data: {
        ageMin,
        ageMax,
        ...(body.interested_in ? { interestedIn: body.interested_in.map((g) => g.toUpperCase() as Gender) } : {}),
        ...(body.max_distance_km !== undefined ? { maxDistanceKm: body.max_distance_km } : {}),
      },
    });
    return view(updated);
  }
}
