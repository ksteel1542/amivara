import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Put } from '@nestjs/common';

import type { AuthenticatedMember } from '../../common/authenticated-member';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentMember } from '../auth/auth.guards';
import { type LocationInput, locationSchema, type UpdateProfileInput, updateProfileSchema } from './profile.schemas';
import { ProfileViewService } from './profile-view.service';
import { ProfilesService } from './profiles.service';

/** API.md "Profiles": your own profile, the catalogue, and other members' full profiles. */
@Controller('profiles')
export class ProfilesController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly views: ProfileViewService,
  ) {}

  /** Prompts, interests, languages and limits for the profile editor. */
  @Get('catalog')
  catalog() {
    return this.profiles.catalog();
  }

  @Get('me')
  me(@CurrentMember() member: AuthenticatedMember) {
    return this.profiles.getOwn(member.id);
  }

  @Patch('me')
  update(
    @CurrentMember() member: AuthenticatedMember,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileInput,
  ) {
    return this.profiles.update(member.id, body);
  }

  /** Stores the location rounded to ~100 m. The point is never returned. */
  @Put('me/location')
  @HttpCode(HttpStatus.NO_CONTENT)
  async location(
    @CurrentMember() member: AuthenticatedMember,
    @Body(new ZodValidationPipe(locationSchema)) body: LocationInput,
  ): Promise<void> {
    await this.profiles.setLocation(member.id, body);
  }

  /** Another member's full profile. Declared last, after the fixed `catalog` and `me` paths. */
  @Get(':userId')
  view(@CurrentMember() member: AuthenticatedMember, @Param('userId', new ParseUUIDPipe()) userId: string) {
    return this.views.view(member.id, userId);
  }
}
