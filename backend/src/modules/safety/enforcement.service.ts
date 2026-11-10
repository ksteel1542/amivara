import { HttpStatus, Injectable } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma';
import { ApiError } from '../../common/api-error';
import { DomainEvents } from '../../common/domain-events';
import { PrismaService } from '../../prisma/prisma.service';
import { SignupBlocksService } from '../users/signup-blocks.service';

/** A ban blocks the phone and devices "permanently" (until an unban). */
const BAN_BLOCK_UNTIL = new Date('2100-01-01T00:00:00Z');
export const MAX_SUSPEND_DAYS = 90;

interface ActionInput {
  /** The moderator, or null for an automatic action. */
  actorId: string | null;
  reason: string;
  reportId?: string;
}

/**
 * Warnings, suspensions, bans and unbans: the one place that changes a
 * member's standing. Every action is recorded in enforcement_actions, and
 * moderator actions also in the append-only audit_log.
 */
@Injectable()
export class EnforcementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blocks: SignupBlocksService,
    private readonly events: DomainEvents,
  ) {}

  async warn(userId: string, input: ActionInput): Promise<void> {
    await this.target(userId, input.actorId);
    await this.prisma.$transaction(async (tx) => {
      await this.record(tx, userId, 'WARN', input);
      await this.resolveReport(tx, userId, input, 'Warning issued');
    });
    this.events.emit('member.warned', { userId });
  }

  /** Temporary (days) or open-ended (no days: until reviewed, e.g. an underage report). */
  async suspend(userId: string, input: ActionInput & { days?: number }): Promise<void> {
    const user = await this.target(userId, input.actorId);
    if (user.status === 'BANNED') {
      throw new ApiError(HttpStatus.CONFLICT, 'VALIDATION_FAILED', 'This member is already banned.');
    }
    const until = input.days ? new Date(Date.now() + input.days * 24 * 60 * 60 * 1000) : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { status: 'SUSPENDED', suspendedUntil: until } });
      await this.record(tx, userId, 'SUSPEND', input, until);
      await this.resolveReport(tx, userId, input, until ? `Suspended for ${input.days} days` : 'Suspended');
    });
    this.events.emit('member.restricted', { userId, action: 'SUSPEND' });
  }

  /**
   * Permanent ban: every session revoked, push tokens dropped, open sockets
   * closed, and the phone plus every device the member signed in on blocked
   * from creating a new account. All open reports about them are closed.
   */
  async ban(userId: string, input: ActionInput): Promise<void> {
    const user = await this.target(userId, input.actorId);
    const sessions = await this.prisma.deviceSession.findMany({
      where: { userId, deviceHash: { not: null } },
      select: { deviceHash: true },
      distinct: ['deviceHash'],
    });
    const subjects = this.subjectsFor(
      user.phoneE164,
      sessions.map((s) => s.deviceHash!),
    );
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { status: 'BANNED', suspendedUntil: null } });
      await tx.deviceSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
      await tx.pushToken.deleteMany({ where: { userId } });
      await tx.signupBlock.deleteMany({ where: { subject: { in: subjects }, reason: 'BANNED' } });
      await tx.signupBlock.createMany({
        data: subjects.map((subject) => ({ subject, reason: 'BANNED' as const, expiresAt: BAN_BLOCK_UNTIL })),
      });
      await this.record(tx, userId, 'BAN', input);
      await tx.report.updateMany({
        where: { reportedId: userId, status: 'OPEN' },
        data: {
          status: 'ACTIONED',
          resolvedAt: now,
          resolvedById: input.actorId,
          resolution: input.reportId ? 'Banned' : 'Banned (closed with the ban)',
        },
      });
    });
    this.events.emit('member.restricted', { userId, action: 'BAN' });
  }

  /** Lifts a ban or suspension, and the ban's phone/device signup blocks. */
  async unban(userId: string, input: ActionInput): Promise<void> {
    const user = await this.target(userId, input.actorId);
    if (user.status !== 'BANNED' && user.status !== 'SUSPENDED') {
      throw new ApiError(HttpStatus.CONFLICT, 'VALIDATION_FAILED', 'This member is not banned or suspended.');
    }
    const sessions = await this.prisma.deviceSession.findMany({
      where: { userId, deviceHash: { not: null } },
      select: { deviceHash: true },
      distinct: ['deviceHash'],
    });
    const subjects = this.subjectsFor(
      user.phoneE164,
      sessions.map((s) => s.deviceHash!),
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { status: 'ACTIVE', suspendedUntil: null } });
      await tx.signupBlock.deleteMany({ where: { subject: { in: subjects }, reason: 'BANNED' } });
      await this.record(tx, userId, 'UNBAN', input);
    });
  }

  async dismiss(reportId: string, actorId: string, note?: string): Promise<void> {
    const result = await this.prisma.report.updateMany({
      where: { id: reportId, status: 'OPEN' },
      data: { status: 'DISMISSED', resolvedAt: new Date(), resolvedById: actorId, resolution: note ?? 'Dismissed' },
    });
    if (result.count === 0) {
      const exists = await this.prisma.report.count({ where: { id: reportId } });
      throw exists
        ? new ApiError(HttpStatus.CONFLICT, 'VALIDATION_FAILED', 'This report is already resolved.')
        : new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Report not found.');
    }
    await this.audit(actorId, 'report.dismiss', 'report', reportId, { note: note ?? null });
  }

  async audit(
    actorId: string,
    action: string,
    targetType: 'user' | 'report',
    targetId: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: { actorId, action, targetType, targetId, metadata: metadata as Prisma.InputJsonValue },
    });
  }

  /** Same HMAC subjects the signup check uses (SignupBlocksService). */
  private subjectsFor(phoneE164: string, deviceHashes: string[]): string[] {
    const [phone] = this.blocks.subjects(phoneE164);
    const devices = deviceHashes.map((d) => this.blocks.subjects(phoneE164, d)[1]!);
    return [phone!, ...devices];
  }

  /** Staff accounts are never actioned from the console, and nobody actions themselves. */
  private async target(userId: string, actorId: string | null) {
    if (actorId && actorId === userId) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', "You can't take action on your own account.");
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, role: true, phoneE164: true },
    });
    if (!user) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Member not found.');
    if (actorId && user.role !== 'MEMBER') {
      throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Staff accounts are managed by an admin, not here.');
    }
    return user;
  }

  private async record(
    tx: Prisma.TransactionClient,
    userId: string,
    action: 'WARN' | 'SUSPEND' | 'BAN' | 'UNBAN',
    input: ActionInput,
    expiresAt: Date | null = null,
  ): Promise<void> {
    await tx.enforcementAction.create({
      data: { userId, action, reason: input.reason, actorId: input.actorId, reportId: input.reportId, expiresAt },
    });
    if (input.actorId) {
      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: `user.${action.toLowerCase()}`,
          targetType: 'user',
          targetId: userId,
          metadata: {
            reason: input.reason,
            report_id: input.reportId ?? null,
            expires_at: expiresAt?.toISOString() ?? null,
          },
        },
      });
    }
  }

  /** The report the action came from must be about this member and still open. */
  private async resolveReport(
    tx: Prisma.TransactionClient,
    userId: string,
    input: ActionInput,
    resolution: string,
  ): Promise<void> {
    if (!input.reportId) return;
    const result = await tx.report.updateMany({
      where: { id: input.reportId, reportedId: userId, status: 'OPEN' },
      data: { status: 'ACTIONED', resolvedAt: new Date(), resolvedById: input.actorId, resolution },
    });
    if (result.count === 0) {
      throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'No open report about this member with that id.');
    }
  }
}
