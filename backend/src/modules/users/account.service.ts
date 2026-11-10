import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';

import { ApiError } from '../../common/api-error';
import { DomainEvents } from '../../common/domain-events';
import { MessageCipher } from '../../common/message-cipher';
import { PrismaService } from '../../prisma/prisma.service';
import { MEDIA_STORAGE, type MediaStorage } from '../media/media-storage';

/** SECURITY.md §4: a 30-day soft delete, then permanent erasure from the primary database. */
export const DELETION_GRACE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const lower = <T extends string>(v: T) => v.toLowerCase();
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

export interface AccountSettings {
  paused: boolean;
  incognito: boolean;
}

/**
 * Account controls (pause, incognito), the NDPA data export, and
 * self-service deletion with its 30-day purge.
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: MessageCipher,
    private readonly events: DomainEvents,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
  ) {}

  async settings(userId: string): Promise<AccountSettings> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { status: true, preference: { select: { incognito: true } } },
    });
    return { paused: user.status === 'PAUSED', incognito: user.preference?.incognito ?? false };
  }

  /**
   * Pause (PRD §5.6): hidden from discovery, matches and chats carry on.
   * Incognito: only people you've liked can see you in discovery.
   */
  async updateSettings(
    userId: string,
    input: { paused?: boolean; incognito?: boolean },
    member: { ageVerified: boolean },
  ): Promise<AccountSettings> {
    if (input.paused !== undefined) {
      const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { status: true } });
      if (user.status !== 'ACTIVE' && user.status !== 'PAUSED') {
        throw new ApiError(HttpStatus.FORBIDDEN, 'ACCOUNT_SUSPENDED', 'This account is not active.');
      }
      // Conditional: never turns a suspended or banned account active.
      await this.prisma.user.updateMany({
        where: { id: userId, status: input.paused ? 'ACTIVE' : 'PAUSED' },
        data: { status: input.paused ? 'PAUSED' : 'ACTIVE' },
      });
    }
    if (input.incognito !== undefined) {
      // PRD §5.6 makes incognito a Plus feature. Until billing ships, it needs a verified account,
      // the same bar as buying Plus (§5.3a).
      if (input.incognito && !member.ageVerified) {
        throw new ApiError(
          HttpStatus.FORBIDDEN,
          'VERIFICATION_REQUIRED',
          'Verify your identity with Smile ID to use incognito.',
        );
      }
      await this.prisma.preference.update({ where: { userId }, data: { incognito: input.incognito } });
    }
    return this.settings(userId);
  }

  /**
   * NDPA right of access: everything we hold about the member, as JSON.
   * Other people's data is kept to the minimum needed to make sense of it:
   * the first names of matches, and only the member's own messages.
   */
  async export(userId: string): Promise<Record<string, unknown>> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        profile: { include: { photos: { where: { status: 'UPLOADED' }, orderBy: { position: 'asc' } } } },
        preference: true,
        verifications: { orderBy: { createdAt: 'asc' } },
        sessions: { orderBy: { createdAt: 'asc' } },
        likesGiven: { orderBy: { createdAt: 'asc' } },
        passesGiven: { orderBy: { createdAt: 'asc' } },
        blocksMade: { orderBy: { createdAt: 'asc' } },
        reportsMade: { orderBy: { createdAt: 'asc' } },
        enforcements: { orderBy: { createdAt: 'asc' } },
        pushTokens: { select: { platform: true, createdAt: true } },
      },
    });
    const [location] = await this.prisma.$queryRaw<Array<{ lat: number | null; lng: number | null }>>`
      SELECT ST_Y(location::geometry)::float8 AS lat, ST_X(location::geometry)::float8 AS lng
        FROM profiles WHERE user_id = ${userId}::uuid`;
    const matches = await this.prisma.match.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      orderBy: { createdAt: 'asc' },
      include: {
        userA: { select: { id: true, profile: { select: { firstName: true } } } },
        userB: { select: { id: true, profile: { select: { firstName: true } } } },
        messages: { where: { senderId: userId }, orderBy: { createdAt: 'asc' } },
      },
    });
    const p = user.profile;

    return {
      format: 'amivara-export/1',
      generated_at: new Date().toISOString(),
      account: {
        id: user.id,
        phone: user.phoneE164,
        date_of_birth: user.dateOfBirth.toISOString().slice(0, 10),
        status: lower(user.status),
        created_at: iso(user.createdAt),
        phone_verified_at: iso(user.phoneVerifiedAt),
        age_verified: user.ageVerified,
        age_verified_at: iso(user.ageVerifiedAt),
        last_active_at: iso(user.lastActiveAt),
      },
      profile: p && {
        first_name: p.firstName,
        gender: lower(p.gender),
        intent: lower(p.intent),
        bio: p.bio,
        city: p.city,
        height_cm: p.heightCm,
        education: p.education,
        job_title: p.jobTitle,
        religion: p.religion,
        languages: p.languages,
        interests: p.interests,
        prompts: p.prompts,
        // Rounded to ~100 m when stored; the latest point only (there is no history).
        location:
          location && location.lat !== null && location.lng !== null
            ? { latitude: location.lat, longitude: location.lng }
            : null,
        location_updated_at: iso(p.locationUpdatedAt),
        photos: await Promise.all(
          p.photos.map(async (ph) => ({
            position: ph.position,
            uploaded_at: iso(ph.createdAt),
            // Signed, short-lived: download them now.
            url: await this.storage.viewUrl(ph.storageKey),
          })),
        ),
      },
      preferences: user.preference && {
        interested_in: user.preference.interestedIn.map(lower),
        age_min: user.preference.ageMin,
        age_max: user.preference.ageMax,
        max_distance_km: user.preference.maxDistanceKm,
        show_in_discovery: user.preference.showInDiscovery,
        incognito: user.preference.incognito,
      },
      // Smile ID results only: we never hold ID images or the NIN (SECURITY.md §2).
      verifications: user.verifications.map((v) => ({
        type: lower(v.type),
        provider: lower(v.provider),
        status: lower(v.status),
        id_type: v.idType,
        verified_age_band: v.verifiedAgeBand,
        started_at: iso(v.createdAt),
        completed_at: iso(v.completedAt),
      })),
      likes_sent: user.likesGiven.map((l) => ({ user_id: l.likeeId, at: iso(l.createdAt) })),
      passes: user.passesGiven.map((s) => ({ user_id: s.passeeId, at: iso(s.createdAt) })),
      matches: matches.map((m) => {
        const other = m.userAId === userId ? m.userB : m.userA;
        return {
          match_id: m.id,
          with: { user_id: other.id, first_name: other.profile?.firstName ?? null },
          matched_at: iso(m.createdAt),
          unmatched_at: iso(m.unmatchedAt),
          photos_unlocked: m.photosUnlocked,
          messages_sent: m.messages.map((msg) => ({
            id: msg.id,
            type: lower(msg.type),
            body: msg.body ? this.cipher.decrypt(msg.body) : null,
            sent_at: iso(msg.createdAt),
            read_at: iso(msg.readAt),
            deleted_at: iso(msg.deletedAt),
          })),
        };
      }),
      blocks: user.blocksMade.map((b) => ({ user_id: b.blockedId, at: iso(b.createdAt) })),
      reports_made: user.reportsMade.map((r) => ({
        user_id: r.reportedId,
        category: lower(r.category),
        details: r.details,
        status: lower(r.status),
        at: iso(r.createdAt),
      })),
      account_actions: user.enforcements.map((e) => ({
        action: lower(e.action),
        reason: e.reason,
        at: iso(e.createdAt),
        until: iso(e.expiresAt),
      })),
      devices: user.sessions.map((s) => ({
        platform: s.platform,
        device_model: s.deviceModel,
        signed_in_at: iso(s.createdAt),
        last_used_at: iso(s.lastUsedAt),
        signed_out_at: iso(s.revokedAt),
      })),
      push_registrations: user.pushTokens.map((t) => ({ platform: t.platform, registered_at: iso(t.createdAt) })),
    };
  }

  /**
   * Self-service deletion. Immediately: every session revoked and socket
   * closed, push tokens dropped, location scrubbed, out of discovery, every
   * match archived. Signing in again within 30 days restores the account;
   * after that, purgeDue() erases it.
   */
  async delete(userId: string): Promise<{ purge_after: string }> {
    const now = new Date();
    const archived = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { status: true } });
      if (user.status === 'BANNED') {
        throw new ApiError(HttpStatus.FORBIDDEN, 'ACCOUNT_SUSPENDED', 'This account is not active.');
      }
      await tx.user.update({ where: { id: userId }, data: { status: 'PENDING_DELETION', deletedAt: now } });
      await tx.deviceSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
      await tx.pushToken.deleteMany({ where: { userId } });
      // Scrub the PostGIS point (and its geohash) so the member drops out of the spatial index now.
      await tx.$executeRaw`
        UPDATE profiles SET location = NULL, geohash5 = NULL, location_updated_at = NULL WHERE user_id = ${userId}::uuid`;
      const active = await tx.match.findMany({
        where: { unmatchedAt: null, OR: [{ userAId: userId }, { userBId: userId }] },
        select: { id: true, userAId: true, userBId: true },
      });
      await tx.match.updateMany({
        where: { id: { in: active.map((m) => m.id) } },
        data: { unmatchedAt: now, unmatchedById: userId },
      });
      return active;
    });

    this.events.emit('member.deleted', { userId });
    for (const m of archived) {
      this.events.emit('match.unmatched', {
        matchId: m.id,
        byUserId: userId,
        otherUserId: m.userAId === userId ? m.userBId : m.userAId,
      });
    }
    return { purge_after: new Date(now.getTime() + DELETION_GRACE_DAYS * DAY_MS).toISOString() };
  }

  /**
   * Erases accounts whose 30 days are up: photos from S3, then the user row
   * (every table cascades from it). Returns how many were purged.
   */
  async purgeDue(now = new Date(), batch = 50): Promise<number> {
    const due = await this.prisma.user.findMany({
      where: { status: 'PENDING_DELETION', deletedAt: { lte: new Date(now.getTime() - DELETION_GRACE_DAYS * DAY_MS) } },
      select: { id: true },
      take: batch,
    });
    let purged = 0;
    for (const { id } of due) {
      const photos = await this.prisma.profilePhoto.findMany({ where: { userId: id }, select: { storageKey: true } });
      for (const p of photos) {
        await this.storage.delete(p.storageKey).catch((error: unknown) => {
          this.logger.warn(`Purge: could not delete a photo object: ${(error as Error).message}`);
        });
      }
      // Conditional: a member who signed back in at the last second keeps their account.
      const deleted = await this.prisma.user.deleteMany({ where: { id, status: 'PENDING_DELETION' } });
      purged += deleted.count;
    }
    if (purged > 0) this.logger.log(`Purged ${purged} deleted account(s)`);
    return purged;
  }
}
