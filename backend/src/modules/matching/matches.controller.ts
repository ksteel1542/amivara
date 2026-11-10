import { Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe } from '@nestjs/common';

import type { AuthenticatedMember } from '../../common/authenticated-member';
import { CurrentMember } from '../auth/auth.guards';
import { RequireAgeVerified } from '../verification/require-age-verified.decorator';
import { MatchingService } from './matching.service';

/** API.md "Discovery & Matching": the matches list and unmatch. Matches only exist between verified members. */
@Controller('matches')
@RequireAgeVerified()
export class MatchesController {
  constructor(private readonly matching: MatchingService) {}

  @Get()
  async list(@CurrentMember() member: AuthenticatedMember) {
    return { matches: await this.matching.list(member.id) };
  }

  /** Final for both members: the match, the conversation and each other in discovery all disappear. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unmatch(
    @CurrentMember() member: AuthenticatedMember,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.matching.unmatch(member.id, id);
  }
}
