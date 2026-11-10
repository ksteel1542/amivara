import { HttpStatus, Injectable } from '@nestjs/common';

import { Prisma } from '../../../generated/prisma';
import { ApiError } from '../../common/api-error';
import type { RequestContext } from '../../common/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionsService, type TokenPair } from '../auth/sessions.service';
import { currentAge, MAXIMUM_AGE, MINIMUM_AGE, parseIsoDate } from './age';
import type { CompleteOnboardingInput } from './onboarding.schemas';
import { SignupBlocksService } from './signup-blocks.service';

type Signup = { phoneE164: string; deviceHash?: string };

const GENDER = { woman: 'WOMAN', man: 'MAN', non_binary: 'NON_BINARY' } as const;
const INTENT = {
  relationship: 'RELATIONSHIP',
  friendship: 'FRIENDSHIP',
  casual: 'CASUAL',
  not_sure: 'NOT_SURE',
} as const;

/**
 * Turns a phone-verified signup into a member (PRD §5.1, UI_WIREFRAMES Screens 3 and 3x).
 * No user row exists until onboarding completes, so an under-18 attempt leaves
 * nothing behind except the HMAC-only signup block.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly blocks: SignupBlocksService,
  ) {}

  /** Screen 3: checks the date of birth before the member fills in anything else. */
  async ageGate(signup: Signup, dateOfBirth: string): Promise<void> {
    await this.assertNotBlocked(signup);
    await this.assertAdult(signup, dateOfBirth);
  }

  async complete(signup: Signup, input: CompleteOnboardingInput, ctx: RequestContext): Promise<TokenPair> {
    await this.assertNotBlocked(signup);
    const age = await this.assertAdult(signup, input.date_of_birth);

    const ageMin = Math.max(MINIMUM_AGE, age - 5);
    const ageMax = Math.min(99, Math.max(ageMin, age + 5));

    let userId: string;
    try {
      userId = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            phoneE164: signup.phoneE164,
            phoneVerifiedAt: new Date(),
            dateOfBirth: new Date(`${input.date_of_birth}T00:00:00Z`),
            profile: {
              create: {
                firstName: input.first_name,
                gender: GENDER[input.gender],
                intent: INTENT[input.intent],
              },
            },
            preference: {
              create: {
                interestedIn: input.interested_in.map((g) => GENDER[g]),
                ageMin,
                ageMax,
              },
            },
            verifications: {
              create: { type: 'PHONE_OTP', provider: 'INTERNAL', status: 'PASSED', completedAt: new Date() },
            },
          },
          select: { id: true },
        });
        return user.id;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'PHONE_ALREADY_REGISTERED',
          'This number already has an account. Sign in instead.',
        );
      }
      throw error;
    }

    return this.sessions.create(userId, ctx);
  }

  private async assertNotBlocked(signup: Signup): Promise<void> {
    if (await this.blocks.isBlocked(this.blocks.subjects(signup.phoneE164, signup.deviceHash))) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'SIGNUP_BLOCKED', "You can't create an account right now.");
    }
  }

  /** Returns the age; blocks the phone and device and throws UNDERAGE if under 18. */
  private async assertAdult(signup: Signup, dateOfBirth: string): Promise<number> {
    const birth = parseIsoDate(dateOfBirth);
    if (!birth) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Enter a real date of birth.', {
        fields: [{ path: 'date_of_birth', message: 'Invalid date' }],
      });
    }
    const age = currentAge(birth);
    if (age < 0 || age > MAXIMUM_AGE) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Check your date of birth.', {
        fields: [{ path: 'date_of_birth', message: 'Out of range' }],
      });
    }
    if (age < MINIMUM_AGE) {
      await this.blocks.blockUnderage(this.blocks.subjects(signup.phoneE164, signup.deviceHash));
      throw new ApiError(HttpStatus.FORBIDDEN, 'UNDERAGE', 'AMIVARA is for adults aged 18 and over.');
    }
    return age;
  }
}
