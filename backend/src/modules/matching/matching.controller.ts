import { Controller, HttpCode, NotImplementedException, Post } from '@nestjs/common';

import { RequireAgeVerified } from '../verification/require-age-verified.decorator';

/**
 * Likes, passes and matches (API.md "Discovery & Matching").
 * The verification gate is wired now so it can't be forgotten later.
 */
@Controller('matching')
export class MatchingController {
  @Post('likes')
  @HttpCode(201)
  @RequireAgeVerified()
  like(): never {
    throw new NotImplementedException('Likes arrive in Stage 4, sprint 5');
  }

  /** Passing only affects the member's own stack, so it is allowed before verification. */
  @Post('passes')
  @HttpCode(201)
  pass(): never {
    throw new NotImplementedException('Passes arrive in Stage 4, sprint 5');
  }
}
