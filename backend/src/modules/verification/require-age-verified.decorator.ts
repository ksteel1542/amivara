import { applyDecorators, UseGuards } from '@nestjs/common';

import { AgeVerifiedGuard } from './age-verified.guard';

/**
 * Marks a route as requiring a Smile ID-verified adult (API.md gate ✅).
 * Use on likes, Super Likes, rewind, messaging, conversations and Plus purchase.
 */
export const RequireAgeVerified = (): MethodDecorator & ClassDecorator => applyDecorators(UseGuards(AgeVerifiedGuard));
