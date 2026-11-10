import { Controller, Get, HttpStatus } from '@nestjs/common';

import { ApiError } from '../../common/api-error';
import type { AuthenticatedMember } from '../../common/authenticated-member';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentMember } from '../auth/auth.guards';
import { currentAge } from './age';

const lower = <T extends string>(v: T) => v.toLowerCase();

/** API.md "Account & Profile": GET /me. Never returns the date of birth or phone in full. */
@Controller('me')
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async me(@CurrentMember() member: AuthenticatedMember) {
    const user = await this.prisma.user.findUnique({
      where: { id: member.id },
      include: {
        profile: { select: { firstName: true, gender: true, intent: true, city: true, bio: true } },
        preference: { select: { interestedIn: true, ageMin: true, ageMax: true, maxDistanceKm: true } },
      },
    });
    if (!user || !user.profile || !user.preference) {
      throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Account not found.');
    }

    const dob = user.dateOfBirth;
    const age = currentAge({ y: dob.getUTCFullYear(), m: dob.getUTCMonth() + 1, d: dob.getUTCDate() });

    return {
      id: user.id,
      status: lower(user.status),
      phone_last4: user.phoneE164.slice(-4),
      age,
      verification: {
        phone: user.phoneVerifiedAt !== null,
        age_verified: user.ageVerified,
        // PRD §5.3a: browse-only until Smile ID passes.
        can_like_and_message: user.ageVerified,
      },
      profile: {
        first_name: user.profile.firstName,
        gender: lower(user.profile.gender),
        intent: lower(user.profile.intent),
        city: user.profile.city,
        bio: user.profile.bio,
      },
      preferences: {
        interested_in: user.preference.interestedIn.map(lower),
        age_min: user.preference.ageMin,
        age_max: user.preference.ageMax,
        max_distance_km: user.preference.maxDistanceKm,
      },
    };
  }
}
