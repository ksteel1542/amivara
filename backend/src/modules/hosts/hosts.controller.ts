import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';

import { ApiError } from '../../common/api-error';
import type { AuthenticatedMember } from '../../common/authenticated-member';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentMember } from '../auth/auth.guards';
import { RequireActiveMember } from '../verification/active-member.guard';
import { HostsService } from './hosts.service';
import { buildIcebreakers } from './icebreakers';

/** Icebreaker requests per Host per hour. */
export const ICEBREAKERS_PER_HOUR = 60;

/** API.md "Hosts": the opt-in Verified Host mode and its earnings view. */
@Controller('me/host')
@RequireActiveMember()
export class HostController {
  constructor(private readonly hosts: HostsService) {}

  @Get()
  async get(@CurrentMember() member: AuthenticatedMember) {
    return { host: await this.hosts.view(member.id) };
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async optIn(@CurrentMember() member: AuthenticatedMember) {
    return { host: await this.hosts.optIn(member.id) };
  }

  @Post('pause')
  @HttpCode(HttpStatus.OK)
  async pause(@CurrentMember() member: AuthenticatedMember) {
    return { host: await this.hosts.pause(member.id) };
  }

  @Get('earnings')
  earnings(@CurrentMember() member: AuthenticatedMember) {
    return this.hosts.earnings(member.id);
  }
}

/** One-tap conversation starters for Hosts (MONETIZATION_PLAN.md 3d). */
@Controller('matches')
@RequireActiveMember()
export class IcebreakersController {
  private readonly recent = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly hosts: HostsService,
  ) {}

  @Get(':id/icebreakers')
  async icebreakers(@CurrentMember() member: AuthenticatedMember, @Param('id', new ParseUUIDPipe()) id: string) {
    if (!(await this.hosts.activeEarner(member.id))) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'HOST_ONLY', 'Conversation starters are for Verified Hosts.');
    }
    this.limit(member.id);
    const match = await this.prisma.match.findFirst({
      where: { id, unmatchedAt: null, OR: [{ userAId: member.id }, { userBId: member.id }] },
      select: { id: true, userAId: true, userBId: true },
    });
    const otherId = match && (match.userAId === member.id ? match.userBId : match.userAId);
    const [them, me] = await Promise.all([
      otherId
        ? this.prisma.profile.findFirst({
            where: { userId: otherId, user: { status: { in: ['ACTIVE', 'PAUSED'] } } },
            select: { firstName: true, city: true, interests: true, prompts: true },
          })
        : null,
      this.prisma.profile.findUnique({ where: { userId: member.id }, select: { interests: true } }),
    ]);
    if (!match || !them)
      throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'This conversation is no longer available.');

    const day = new Date().toISOString().slice(0, 10);
    const suggestions = buildIcebreakers(
      {
        firstName: them.firstName,
        city: them.city,
        interests: them.interests,
        prompts: Array.isArray(them.prompts) ? (them.prompts as Array<{ prompt_id: string; answer: string }>) : [],
      },
      me?.interests ?? [],
      `${match.id}:${day}`,
    );
    return { icebreakers: suggestions.map((text) => ({ text })) };
  }

  private limit(userId: string): void {
    const now = Date.now();
    const hits = (this.recent.get(userId) ?? []).filter((t) => now - t < 60 * 60 * 1000);
    if (hits.length >= ICEBREAKERS_PER_HOUR) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'ICEBREAKER_RATE_LIMITED', 'Please try again later.', {
        retry_after: 60,
      });
    }
    hits.push(now);
    this.recent.set(userId, hits);
    if (this.recent.size > 50_000) this.recent.clear();
  }
}
