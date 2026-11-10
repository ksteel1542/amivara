import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { ApiError } from '../../common/api-error';
import type { AuthenticatedMember } from '../../common/authenticated-member';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentMember } from '../auth/auth.guards';
import { PhotosService } from '../media/photos.service';
import { EnforcementService, MAX_SUSPEND_DAYS } from '../safety/enforcement.service';
import { SafetyService } from '../safety/safety.service';
import { currentAge } from '../users/age';
import { RequireStaff } from './staff.guard';

const queueQuery = z
  .object({
    status: z.enum(['open', 'actioned', 'dismissed']).default('open'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
const reason = z.string().trim().min(3).max(1000);
const warnSchema = z.object({ reason, report_id: z.string().uuid().optional() }).strict();
const suspendSchema = z
  .object({ reason, days: z.number().int().min(1).max(MAX_SUSPEND_DAYS), report_id: z.string().uuid().optional() })
  .strict();
const unbanSchema = z.object({ reason }).strict();
const dismissSchema = z.object({ note: z.string().trim().max(1000).optional() }).strict();

const age = (dob: Date) => currentAge({ y: dob.getUTCFullYear(), m: dob.getUTCMonth() + 1, d: dob.getUTCDate() });

/**
 * Moderation API for the admin console (API.md "Admin"). Staff only; every
 * action and every evidence view is written to the append-only audit log.
 */
@Controller('admin')
@RequireStaff()
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enforcement: EnforcementService,
    private readonly safety: SafetyService,
    private readonly photos: PhotosService,
  ) {}

  @Get('me')
  async me(@CurrentMember() staff: AuthenticatedMember) {
    const profile = await this.prisma.profile.findUnique({ where: { userId: staff.id }, select: { firstName: true } });
    return { id: staff.id, role: staff.role.toLowerCase(), first_name: profile?.firstName ?? null };
  }

  /** The review queue: critical (underage) first, then oldest first. */
  @Get('reports')
  async queue(@Query(new ZodValidationPipe(queueQuery)) query: z.infer<typeof queueQuery>) {
    const status = query.status.toUpperCase() as 'OPEN' | 'ACTIONED' | 'DISMISSED';
    const [rows, counts] = await Promise.all([
      this.prisma.report.findMany({
        where: { status },
        orderBy: status === 'OPEN' ? [{ priority: 'asc' }, { createdAt: 'asc' }] : [{ resolvedAt: 'desc' }],
        take: query.limit,
        include: {
          reporter: { select: { id: true, profile: { select: { firstName: true } } } },
          reported: {
            select: {
              id: true,
              status: true,
              ageVerified: true,
              dateOfBirth: true,
              profile: { select: { firstName: true } },
            },
          },
        },
      }),
      this.prisma.report.groupBy({ by: ['priority'], where: { status: 'OPEN' }, _count: { _all: true } }),
    ]);
    const reportedIds = [...new Set(rows.map((r) => r.reportedId))];
    const [openAbout, photos] = await Promise.all([
      this.prisma.report.groupBy({
        by: ['reportedId'],
        where: { reportedId: { in: reportedIds }, status: 'OPEN' },
        _count: { _all: true },
      }),
      this.photos.viewsForUsers(reportedIds),
    ]);
    const count = (p: string) => counts.find((c) => c.priority === p)?._count._all ?? 0;
    return {
      counts: { critical: count('CRITICAL'), high: count('HIGH'), normal: count('NORMAL') },
      reports: rows.map((r) => ({
        id: r.id,
        category: r.category.toLowerCase(),
        priority: r.priority.toLowerCase(),
        status: r.status.toLowerCase(),
        details: r.details,
        created_at: r.createdAt.toISOString(),
        resolved_at: r.resolvedAt?.toISOString() ?? null,
        reporter: { user_id: r.reporter.id, first_name: r.reporter.profile?.firstName ?? null },
        reported: {
          user_id: r.reported.id,
          first_name: r.reported.profile?.firstName ?? null,
          age: age(r.reported.dateOfBirth),
          status: r.reported.status.toLowerCase(),
          verified: r.reported.ageVerified,
          photo_url: photos.get(r.reported.id)?.[0]?.url ?? null,
          open_reports: openAbout.find((o) => o.reportedId === r.reported.id)?._count._all ?? 0,
        },
      })),
    };
  }

  /** One report with its frozen evidence, the live profile and the member's history. Audited. */
  @Get('reports/:id')
  async report(@CurrentMember() staff: AuthenticatedMember, @Param('id', new ParseUUIDPipe()) id: string) {
    const r = await this.prisma.report.findUnique({
      where: { id },
      include: {
        reporter: { select: { id: true, profile: { select: { firstName: true } } } },
        reported: {
          select: {
            id: true,
            status: true,
            suspendedUntil: true,
            ageVerified: true,
            dateOfBirth: true,
            createdAt: true,
            profile: { select: { firstName: true, bio: true, prompts: true, jobTitle: true } },
          },
        },
      },
    });
    if (!r) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Report not found.');

    const [photos, history, others] = await Promise.all([
      this.photos.viewsForUsers([r.reportedId]),
      this.prisma.enforcementAction.findMany({
        where: { userId: r.reportedId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.report.findMany({
        where: { reportedId: r.reportedId, id: { not: r.id } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, category: true, status: true, createdAt: true },
      }),
    ]);
    await this.enforcement.audit(staff.id, 'report.view', 'report', r.id);

    const evidence = this.safety.decryptEvidence(r.evidence);
    return {
      id: r.id,
      category: r.category.toLowerCase(),
      priority: r.priority.toLowerCase(),
      status: r.status.toLowerCase(),
      details: r.details,
      message_id: r.messageId,
      created_at: r.createdAt.toISOString(),
      resolved_at: r.resolvedAt?.toISOString() ?? null,
      resolution: r.resolution,
      reporter: { user_id: r.reporter.id, first_name: r.reporter.profile?.firstName ?? null },
      reported: {
        user_id: r.reported.id,
        first_name: r.reported.profile?.firstName ?? null,
        age: age(r.reported.dateOfBirth),
        status: r.reported.status.toLowerCase(),
        suspended_until: r.reported.suspendedUntil?.toISOString() ?? null,
        verified: r.reported.ageVerified,
        member_since: r.reported.createdAt.toISOString(),
        bio: r.reported.profile?.bio ?? null,
        job_title: r.reported.profile?.jobTitle ?? null,
        prompts: r.reported.profile?.prompts ?? [],
        photos: (photos.get(r.reported.id) ?? []).map((p) => p.url),
      },
      evidence,
      history: history.map((h) => ({
        action: h.action.toLowerCase(),
        reason: h.reason,
        automatic: h.actorId === null,
        created_at: h.createdAt.toISOString(),
        expires_at: h.expiresAt?.toISOString() ?? null,
      })),
      other_reports: others.map((o) => ({
        id: o.id,
        category: o.category.toLowerCase(),
        status: o.status.toLowerCase(),
        created_at: o.createdAt.toISOString(),
      })),
    };
  }

  @Post('reports/:id/dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  async dismiss(
    @CurrentMember() staff: AuthenticatedMember,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(dismissSchema)) body: z.infer<typeof dismissSchema>,
  ): Promise<void> {
    await this.enforcement.dismiss(id, staff.id, body.note);
  }

  @Post('users/:id/warn')
  @HttpCode(HttpStatus.NO_CONTENT)
  async warn(
    @CurrentMember() staff: AuthenticatedMember,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(warnSchema)) body: z.infer<typeof warnSchema>,
  ): Promise<void> {
    await this.enforcement.warn(id, { actorId: staff.id, reason: body.reason, reportId: body.report_id });
  }

  @Post('users/:id/suspend')
  @HttpCode(HttpStatus.NO_CONTENT)
  async suspend(
    @CurrentMember() staff: AuthenticatedMember,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(suspendSchema)) body: z.infer<typeof suspendSchema>,
  ): Promise<void> {
    await this.enforcement.suspend(id, {
      actorId: staff.id,
      reason: body.reason,
      reportId: body.report_id,
      days: body.days,
    });
  }

  @Post('users/:id/ban')
  @HttpCode(HttpStatus.NO_CONTENT)
  async ban(
    @CurrentMember() staff: AuthenticatedMember,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(warnSchema)) body: z.infer<typeof warnSchema>,
  ): Promise<void> {
    await this.enforcement.ban(id, { actorId: staff.id, reason: body.reason, reportId: body.report_id });
  }

  @Post('users/:id/unban')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unban(
    @CurrentMember() staff: AuthenticatedMember,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(unbanSchema)) body: z.infer<typeof unbanSchema>,
  ): Promise<void> {
    await this.enforcement.unban(id, { actorId: staff.id, reason: body.reason });
  }
}
