import { Body, Controller, Get, HttpCode, HttpStatus, Injectable, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';

import { ApiError } from '../../common/api-error';
import type { AuthenticatedMember } from '../../common/authenticated-member';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentMember, CurrentSessionId } from '../auth/auth.guards';
import { HostsService } from '../hosts/hosts.service';
import { PhotosService } from '../media/photos.service';
import { RealtimeRegistry } from '../messaging/realtime.registry';
import { currentAge } from '../users/age';
import { RequireActiveMember } from '../verification/active-member.guard';
import { CallsService } from './calls.service';

/** Quick Connect invites a Host may send per hour. */
export const HOST_INVITES_PER_HOUR = 20;
/** Quick Connect invites a member can receive per day (from all Hosts). */
export const MEMBER_INVITES_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

const inviteSchema = z.object({ type: z.enum(['voice', 'video']) }).strict();

interface Person {
  id: string;
  dateOfBirth: Date;
  profile: { firstName: string; city: string | null } | null;
}

/**
 * Lower-friction connections with Verified Hosts (17 Nov 2026):
 * - members open a chat with an online Host directly, no mutual like needed
 *   (a HOST_DIRECT match, so chat, calls and gifts work as usual);
 * - online Hosts see newcomers who accept live call invites and ring them
 *   (Quick Connect). The member pays the minutes, after their free preview,
 *   and sees the price before answering. Invites are rate limited both ways
 *   and members can switch them off.
 */
@Injectable()
export class HostConnectService {
  private readonly newcomerMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hosts: HostsService,
    private readonly realtime: RealtimeRegistry,
    private readonly photos: PhotosService,
    private readonly calls: CallsService,
    config: ConfigService<Env, true>,
  ) {
    this.newcomerMs = config.get('NEWCOMER_DAYS', { infer: true }) * DAY_MS;
  }

  /** GET /hosts/online: Verified Hosts with the app open right now. */
  async online(viewerId: string) {
    const hidden = await this.blockedWith(viewerId);
    const hosts = await this.prisma.hostProfile.findMany({
      where: {
        status: 'ACTIVE',
        userId: { notIn: [viewerId, ...hidden] },
        user: { status: 'ACTIVE', ageVerified: true },
      },
      select: {
        user: { select: { id: true, dateOfBirth: true, profile: { select: { firstName: true, city: true } } } },
      },
      take: 500,
    });
    const live = hosts
      .map((h) => h.user)
      .filter((u) => this.realtime.isOnline(u.id))
      .slice(0, 30);
    return { hosts: await this.cards(live, { voice: this.calls.voiceRate, video: this.calls.videoRate }) };
  }

  /** POST /hosts/:hostId/chat: the conversation with a Host, opened if needed. */
  async openChat(memberId: string, hostId: string) {
    const matchId = await this.directMatch(memberId, hostId);
    return { match_id: matchId };
  }

  /** GET /hosts/newcomers (active Hosts): newcomers online now who accept live call invites. */
  async newcomers(hostId: string) {
    if (!(await this.hosts.activeEarner(hostId))) throw this.hostOnly();
    const hidden = await this.blockedWith(hostId);
    const candidates = await this.prisma.user.findMany({
      where: {
        id: { notIn: [hostId, ...hidden] },
        status: 'ACTIVE',
        allowCallInvites: true,
        guidelinesAcceptedAt: { not: null },
        createdAt: { gte: new Date(Date.now() - this.newcomerMs) },
        hostProfile: { is: null },
      },
      orderBy: { lastActiveAt: { sort: 'desc', nulls: 'last' } },
      select: { id: true, dateOfBirth: true, profile: { select: { firstName: true, city: true } } },
      take: 500,
    });
    const online = candidates.filter((u) => this.realtime.isOnline(u.id)).slice(0, 30);
    const invitedToday = new Set(
      (
        await this.prisma.callSession.findMany({
          where: {
            callerId: hostId,
            isInvite: true,
            calleeId: { in: online.map((u) => u.id) },
            createdAt: { gte: new Date(Date.now() - DAY_MS) },
          },
          select: { calleeId: true },
        })
      ).map((c) => c.calleeId),
    );
    const cards = await this.cards(online);
    return { newcomers: cards.map((c) => ({ ...c, invited_today: invitedToday.has(c.user_id) })) };
  }

  /** POST /hosts/newcomers/:userId/call (active Hosts): rings a newcomer. */
  async invite(hostId: string, memberId: string, type: 'VOICE' | 'VIDEO', sessionId?: string) {
    if (!(await this.hosts.activeEarner(hostId))) throw this.hostOnly();
    const member = await this.prisma.user.findUnique({
      where: { id: memberId },
      select: { status: true, allowCallInvites: true, createdAt: true, hostProfile: { select: { userId: true } } },
    });
    if (!member || member.status !== 'ACTIVE' || member.hostProfile) throw this.notFound();
    if (!member.allowCallInvites) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'INVITES_OFF', "They're not taking live call invites right now.");
    }
    if (member.createdAt < new Date(Date.now() - this.newcomerMs) || !this.realtime.isOnline(memberId)) {
      throw new ApiError(HttpStatus.CONFLICT, 'CALLEE_BUSY', "They're not available right now.", { reason: 'offline' });
    }
    const since = (ms: number) => new Date(Date.now() - ms);
    const [byHost, pair, toMember] = await Promise.all([
      this.prisma.callSession.count({
        where: { callerId: hostId, isInvite: true, createdAt: { gte: since(60 * 60_000) } },
      }),
      this.prisma.callSession.count({
        where: { callerId: hostId, calleeId: memberId, isInvite: true, createdAt: { gte: since(DAY_MS) } },
      }),
      this.prisma.callSession.count({
        where: { calleeId: memberId, isInvite: true, createdAt: { gte: since(DAY_MS) } },
      }),
    ]);
    if (byHost >= HOST_INVITES_PER_HOUR || pair > 0 || toMember >= MEMBER_INVITES_PER_DAY) {
      throw new ApiError(
        HttpStatus.TOO_MANY_REQUESTS,
        'INVITE_RATE_LIMITED',
        pair > 0 ? 'You already invited them today.' : 'Too many invites right now. Try again later.',
        {
          reason:
            pair > 0 ? 'already_invited' : byHost >= HOST_INVITES_PER_HOUR ? 'host_hourly_limit' : 'member_daily_limit',
        },
      );
    }
    const matchId = await this.directMatch(memberId, hostId);
    return { call: await this.calls.start(hostId, matchId, type, { sessionId, invite: true }) };
  }

  /** The HOST_DIRECT match between a member and an active Host (created if needed). */
  private async directMatch(memberId: string, hostId: string): Promise<string> {
    if (memberId === hostId) throw this.notFound();
    const [host, member] = await Promise.all([
      this.hosts.activeEarner(hostId),
      this.prisma.user.findUnique({ where: { id: memberId }, select: { status: true } }),
    ]);
    if (!host || !member || (member.status !== 'ACTIVE' && member.status !== 'PAUSED')) throw this.notFound();
    if ((await this.blockedWith(memberId)).includes(hostId)) throw this.notFound();
    const [userAId, userBId] = memberId < hostId ? [memberId, hostId] : [hostId, memberId];
    const existing = await this.prisma.match.findUnique({ where: { userAId_userBId: { userAId, userBId } } });
    if (existing) {
      // Unmatched once means closed for good, as with mutual matches.
      if (existing.unmatchedAt) throw this.notFound();
      return existing.id;
    }
    try {
      const created = await this.prisma.match.create({ data: { userAId, userBId, source: 'HOST_DIRECT' } });
      return created.id;
    } catch {
      // Opened at the same moment from the other side.
      const again = await this.prisma.match.findUnique({ where: { userAId_userBId: { userAId, userBId } } });
      if (!again || again.unmatchedAt) throw this.notFound();
      return again.id;
    }
  }

  private async cards(people: Person[], rates?: { voice: number; video: number }) {
    const photos = await this.photos.viewsForUsers(people.map((p) => p.id));
    return people.map((p) => {
      const dob = p.dateOfBirth;
      return {
        user_id: p.id,
        first_name: p.profile?.firstName ?? '',
        age: currentAge({ y: dob.getUTCFullYear(), m: dob.getUTCMonth() + 1, d: dob.getUTCDate() }),
        city: p.profile?.city ?? null,
        photo_url: photos.get(p.id)?.[0]?.url ?? null,
        online: true,
        ...(rates ? { voice_rate_per_minute: rates.voice, video_rate_per_minute: rates.video } : {}),
      };
    });
  }

  private async blockedWith(userId: string): Promise<string[]> {
    const blocks = await this.prisma.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });
    return blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId));
  }

  private hostOnly(): ApiError {
    return new ApiError(HttpStatus.FORBIDDEN, 'HOST_ONLY', 'Quick Connect is for active Verified Hosts.');
  }

  private notFound(): ApiError {
    return new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Member not found.');
  }
}

/** API.md "Verified Hosts: direct chat and Quick Connect". */
@Controller('hosts')
@RequireActiveMember()
export class HostConnectController {
  constructor(private readonly connect: HostConnectService) {}

  @Get('online')
  online(@CurrentMember() m: AuthenticatedMember) {
    return this.connect.online(m.id);
  }

  @Get('newcomers')
  newcomers(@CurrentMember() m: AuthenticatedMember) {
    return this.connect.newcomers(m.id);
  }

  @Post(':hostId/chat')
  @HttpCode(HttpStatus.OK)
  chat(@CurrentMember() m: AuthenticatedMember, @Param('hostId', new ParseUUIDPipe()) hostId: string) {
    return this.connect.openChat(m.id, hostId);
  }

  @Post('newcomers/:userId/call')
  @HttpCode(HttpStatus.CREATED)
  invite(
    @CurrentMember() m: AuthenticatedMember,
    @CurrentSessionId() sessionId: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body(new ZodValidationPipe(inviteSchema)) body: z.infer<typeof inviteSchema>,
  ) {
    return this.connect.invite(m.id, userId, body.type === 'video' ? 'VIDEO' : 'VOICE', sessionId);
  }
}
