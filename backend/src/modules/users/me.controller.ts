import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { ApiError } from '../../common/api-error';
import type { AuthenticatedMember } from '../../common/authenticated-member';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentMember } from '../auth/auth.guards';
import { UNVERIFIED_DAILY_MESSAGES } from '../messaging/messaging.service';
import { currentAge } from './age';

const lower = <T extends string>(v: T) => v.toLowerCase();

/** API.md "Account & Profile": GET /me (never the date of birth or phone in full) and guidelines acceptance. */
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
      email: user.email,
      phone_last4: user.phoneE164?.slice(-4) ?? null,
      age,
      verification: {
        email: user.emailVerifiedAt !== null,
        phone: user.phoneVerifiedAt !== null,
        age_verified: user.ageVerified,
        // Progressive trust (Nov 2026): everyone can like, match and send text messages
        // (unverified: capped per day). Media and calls need a passed Smile ID check.
        can_like_and_message: true,
        unlimited_chat: user.ageVerified,
      },
      capabilities: {
        like: true,
        text_chat: true,
        text_chat_daily_limit: user.ageVerified ? null : UNVERIFIED_DAILY_MESSAGES,
        chat_photos: user.ageVerified,
        voice_calls: user.ageVerified,
        video_calls: user.ageVerified,
      },
      guidelines_accepted: user.guidelinesAcceptedAt !== null,
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

  /** The community guidelines screen right after sign-up: accepted once, idempotent. */
  @Post('guidelines/accept')
  @HttpCode(HttpStatus.NO_CONTENT)
  async acceptGuidelines(@CurrentMember() member: AuthenticatedMember): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id: member.id, guidelinesAcceptedAt: null },
      data: { guidelinesAcceptedAt: new Date() },
    });
  }
}
