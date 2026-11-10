import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';

import type { MemberRequest } from '../../common/authenticated-member';
import { Ctx, type RequestContext } from '../../common/request-context';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Public, SignupIdentity, SignupTokenGuard } from '../auth/auth.guards';
import { ageGateSchema, type CompleteOnboardingInput, completeOnboardingSchema } from './onboarding.schemas';
import { OnboardingService } from './onboarding.service';

type Signup = NonNullable<MemberRequest['signup']>;

/**
 * API.md "Onboarding". Authenticated with the signup token from
 * POST /auth/otp/verify (there is no member yet, so not an access token).
 */
@Public()
@UseGuards(SignupTokenGuard)
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  /** Screen 3: 204 if 18+. Under 18: blocks the phone and device for 12 months and returns 403 UNDERAGE. */
  @Post('age-gate')
  @HttpCode(HttpStatus.NO_CONTENT)
  async ageGate(
    @SignupIdentity() signup: Signup,
    @Body(new ZodValidationPipe(ageGateSchema)) body: { date_of_birth: string },
  ): Promise<void> {
    await this.onboarding.ageGate(signup, body.date_of_birth);
  }

  /** Creates the member (user, profile, preferences) and signs them in. */
  @Post('complete')
  @HttpCode(HttpStatus.CREATED)
  async complete(
    @SignupIdentity() signup: Signup,
    @Body(new ZodValidationPipe(completeOnboardingSchema)) body: CompleteOnboardingInput,
    @Ctx() ctx: RequestContext,
  ) {
    return this.onboarding.complete(signup, body, ctx);
  }
}
