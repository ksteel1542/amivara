import { HttpStatus, Injectable } from '@nestjs/common';

import { ApiError } from '../../common/api-error';
import { DomainEvents } from '../../common/domain-events';
import { MessageCipher } from '../../common/message-cipher';
import { PrismaService } from '../../prisma/prisma.service';
import { currentAge } from '../users/age';
import { EnforcementService } from './enforcement.service';

export const REPORT_CATEGORIES = [
  'fake_profile',
  'underage',
  'harassment',
  'scam',
  'explicit_content',
  'hate',
  'other',
] as const;
export type ReportCategoryInput = (typeof REPORT_CATEGORIES)[number];

/** Messages captured as evidence with each report. */
export const EVIDENCE_MESSAGES = 50;
/** Per reporter per 24 hours: plenty for real reports, a wall against report-bombing. */
export const REPORTS_PER_DAY = 20;

const PRIORITY: Record<ReportCategoryInput, 'CRITICAL' | 'HIGH' | 'NORMAL'> = {
  underage: 'CRITICAL',
  harassment: 'HIGH',
  scam: 'HIGH',
  explicit_content: 'HIGH',
  hate: 'HIGH',
  fake_profile: 'NORMAL',
  other: 'NORMAL',
};

/** What moderators see: frozen when the report is filed (encrypted at rest). */
export interface Evidence {
  captured_at: string;
  profile: {
    first_name: string | null;
    age: number | null;
    bio: string | null;
    prompts: unknown;
    job_title: string | null;
    photo_keys: string[];
    verified: boolean;
    member_since: string;
  };
  match_id: string | null;
  matched_at: string | null;
  /** Oldest first. */
  messages: Array<{ id: string; from: 'reporter' | 'reported'; body: string; sent_at: string; deleted: boolean }>;
}

/**
 * Blocks and reports (PRD §5.6). A block hides both members from each other
 * everywhere: discovery and likes already exclude blocked pairs; here the
 * match is archived (unmatched), which closes the chat live on both sides.
 */
@Injectable()
export class SafetyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: MessageCipher,
    private readonly events: DomainEvents,
    private readonly enforcement: EnforcementService,
  ) {}

  async block(blockerId: string, blockedId: string): Promise<void> {
    if (blockerId === blockedId) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', "You can't block yourself.");
    }
    const target = await this.prisma.user.findUnique({ where: { id: blockedId }, select: { id: true } });
    if (!target) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Member not found.');

    const archived = await this.prisma.$transaction(async (tx) => {
      await tx.block.upsert({
        where: { blockerId_blockedId: { blockerId, blockedId } },
        create: { blockerId, blockedId },
        update: {},
      });
      const [userAId, userBId] = blockerId < blockedId ? [blockerId, blockedId] : [blockedId, blockerId];
      const match = await tx.match.findUnique({ where: { userAId_userBId: { userAId, userBId } } });
      if (!match || match.unmatchedAt) return null;
      await tx.match.update({
        where: { id: match.id },
        data: { unmatchedAt: new Date(), unmatchedById: blockerId },
      });
      return match.id;
    });
    // Same path as an unmatch: open chats close on both sides, the other side's list refreshes silently.
    if (archived) {
      this.events.emit('match.unmatched', { matchId: archived, byUserId: blockerId, otherUserId: blockedId });
    }
  }

  /** Unblocking never restores a match: they'd have to find each other again in discovery. */
  async unblock(blockerId: string, blockedId: string): Promise<void> {
    const result = await this.prisma.block.deleteMany({ where: { blockerId, blockedId } });
    if (result.count === 0) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Block not found.');
  }

  async listBlocks(blockerId: string) {
    const rows = await this.prisma.block.findMany({
      where: { blockerId },
      orderBy: { createdAt: 'desc' },
      include: { blocked: { select: { id: true, profile: { select: { firstName: true } } } } },
    });
    return rows.map((b) => ({
      user_id: b.blocked.id,
      first_name: b.blocked.profile?.firstName ?? null,
      blocked_at: b.createdAt.toISOString(),
    }));
  }

  /**
   * Files a report with an immutable evidence snapshot, then blocks the
   * reported member for the reporter. An underage report suspends the
   * reported account at once, until a moderator reviews it (PRD §5.6).
   */
  async report(
    reporterId: string,
    input: { user_id: string; category: ReportCategoryInput; details?: string; message_id?: string },
  ): Promise<{ report_id: string; priority: string }> {
    if (reporterId === input.user_id) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', "You can't report yourself.");
    }
    const recent = await this.prisma.report.count({
      where: { reporterId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    });
    if (recent >= REPORTS_PER_DAY) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'REPORT_RATE_LIMITED', "You've sent a lot of reports today.");
    }

    const reported = await this.prisma.user.findUnique({
      where: { id: input.user_id },
      include: {
        profile: {
          include: {
            photos: { where: { status: 'UPLOADED' }, orderBy: { position: 'asc' }, select: { storageKey: true } },
          },
        },
      },
    });
    if (!reported) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Member not found.');

    const [userAId, userBId] = reporterId < input.user_id ? [reporterId, input.user_id] : [input.user_id, reporterId];
    const match = await this.prisma.match.findUnique({ where: { userAId_userBId: { userAId, userBId } } });
    if (input.message_id) {
      const pointed = match
        ? await this.prisma.message.count({ where: { id: input.message_id, matchId: match.id } })
        : 0;
      if (!pointed)
        throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'That message is not in your chat.');
    }

    const messages = match
      ? await this.prisma.message.findMany({
          where: { matchId: match.id },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: EVIDENCE_MESSAGES,
        })
      : [];
    const dob = reported.dateOfBirth;
    const evidence: Evidence = {
      captured_at: new Date().toISOString(),
      profile: {
        first_name: reported.profile?.firstName ?? null,
        age: currentAge({ y: dob.getUTCFullYear(), m: dob.getUTCMonth() + 1, d: dob.getUTCDate() }),
        bio: reported.profile?.bio ?? null,
        prompts: reported.profile?.prompts ?? [],
        job_title: reported.profile?.jobTitle ?? null,
        photo_keys: reported.profile?.photos.map((p) => p.storageKey) ?? [],
        verified: reported.ageVerified,
        member_since: reported.createdAt.toISOString(),
      },
      match_id: match?.id ?? null,
      matched_at: match?.createdAt.toISOString() ?? null,
      messages: messages.reverse().map((m) => ({
        id: m.id,
        from: m.senderId === reporterId ? 'reporter' : 'reported',
        body: m.body ? this.cipher.decrypt(m.body) : m.type === 'IMAGE' ? '[photo]' : '',
        sent_at: m.createdAt.toISOString(),
        deleted: m.deletedAt !== null,
      })),
    };

    const priority = PRIORITY[input.category];
    const report = await this.prisma.report.create({
      data: {
        reporterId,
        reportedId: input.user_id,
        category: input.category.toUpperCase() as Uppercase<ReportCategoryInput>,
        details: input.details?.trim() || null,
        messageId: input.message_id,
        matchId: match?.id,
        evidence: this.cipher.encrypt(JSON.stringify(evidence)),
        priority,
      },
    });

    // Reporting also blocks (API.md): the reporter never sees them again.
    await this.block(reporterId, input.user_id);

    if (input.category === 'underage' && reported.status !== 'BANNED' && reported.role === 'MEMBER') {
      await this.enforcement.suspend(input.user_id, {
        actorId: null,
        reason: 'Automatic: underage report, suspended until reviewed',
        reportId: undefined,
      });
    }
    return { report_id: report.id, priority: priority.toLowerCase() };
  }

  decryptEvidence(stored: string): Evidence {
    return JSON.parse(this.cipher.decrypt(stored)) as Evidence;
  }
}
