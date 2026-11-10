import { randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';

import { ApiError } from '../../common/api-error';
import { PrismaService } from '../../prisma/prisma.service';
import { recomputeCompleteness } from '../profiles/completeness';
import { detectImageType, MEDIA_STORAGE, type MediaStorage } from './media-storage';

/** PRD §5.1: 2–6 photos. */
export const MAX_PHOTOS = 6;
export const MIN_PHOTOS = 2;
/** Server-side cap. The app compresses to ≤ 300 KB before uploading; this leaves headroom. */
export const MAX_PHOTO_BYTES = 1_500_000;
/** Upload URLs that were never used stop holding a slot after this long. */
export const PENDING_UPLOAD_TTL_MS = 60 * 60 * 1000;

export type PhotoContentType = 'image/jpeg' | 'image/webp';

export interface PhotoView {
  id: string;
  position: number;
  is_primary: boolean;
  url: string;
  moderation_status: 'pending' | 'approved' | 'rejected';
}

@Injectable()
export class PhotosService {
  private readonly logger = new Logger(PhotosService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
  ) {}

  /** Reserves a photo and returns a presigned POST for a direct-to-S3 upload. */
  async requestUpload(userId: string, contentType: PhotoContentType) {
    await this.sweepStalePending(userId);

    const used = await this.prisma.profilePhoto.count({ where: { userId } });
    if (used >= MAX_PHOTOS) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'PHOTO_LIMIT',
        `You can have up to ${MAX_PHOTOS} photos. Remove one first.`,
      );
    }

    const id = randomUUID();
    const key = `photos/${userId}/${id}.${contentType === 'image/webp' ? 'webp' : 'jpg'}`;
    const upload = await this.storage.presignUpload(key, contentType, MAX_PHOTO_BYTES);
    await this.prisma.profilePhoto.create({ data: { id, userId, storageKey: key, contentType } });

    return {
      photo_id: id,
      upload: { method: 'POST', url: upload.url, fields: upload.fields, file_field: 'file' },
      max_bytes: MAX_PHOTO_BYTES,
      expires_in: upload.expiresIn,
    };
  }

  /** Verifies the uploaded object, then gives the photo the next free slot. */
  async confirm(userId: string, photoId: string): Promise<PhotoView[]> {
    const photo = await this.prisma.profilePhoto.findFirst({ where: { id: photoId, userId } });
    if (!photo) throw notFound();
    if (photo.status === 'UPLOADED') return this.list(userId); // idempotent

    const object = await this.storage.head(photo.storageKey);
    if (!object) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'UPLOAD_NOT_FOUND',
        "We didn't receive your photo. Try uploading it again.",
      );
    }

    const detected = object.size > 0 ? detectImageType(await this.storage.readPrefix(photo.storageKey, 16)) : null;
    if (object.size > MAX_PHOTO_BYTES || detected === null || detected !== photo.contentType) {
      await this.discard(photo.id, photo.storageKey);
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'INVALID_IMAGE',
        'That file is not a supported photo. Use a JPEG or WebP image.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const taken = await tx.profilePhoto.count({ where: { userId, status: 'UPLOADED' } });
      if (taken >= MAX_PHOTOS) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'PHOTO_LIMIT',
          `You can have up to ${MAX_PHOTOS} photos. Remove one first.`,
        );
      }
      await tx.profilePhoto.update({
        where: { id: photo.id },
        data: { status: 'UPLOADED', position: taken, sizeBytes: object.size, uploadedAt: new Date() },
      });
    });
    await recomputeCompleteness(this.prisma, userId);
    return this.list(userId);
  }

  async list(userId: string): Promise<PhotoView[]> {
    const photos = await this.prisma.profilePhoto.findMany({
      where: { userId, status: 'UPLOADED' },
      orderBy: { position: 'asc' },
    });
    return Promise.all(
      photos.map(async (p) => ({
        id: p.id,
        position: p.position ?? 0,
        is_primary: p.position === 0,
        url: await this.storage.viewUrl(p.storageKey),
        moderation_status: p.moderationStatus.toLowerCase() as PhotoView['moderation_status'],
      })),
    );
  }

  /** Approved-or-pending photos for several members at once (discovery cards), in order, with signed URLs. */
  async viewsForUsers(userIds: string[]): Promise<Map<string, Array<{ id: string; url: string }>>> {
    const result = new Map<string, Array<{ id: string; url: string }>>();
    if (userIds.length === 0) return result;
    const photos = await this.prisma.profilePhoto.findMany({
      where: { userId: { in: userIds }, status: 'UPLOADED', moderationStatus: { not: 'REJECTED' } },
      orderBy: [{ userId: 'asc' }, { position: 'asc' }],
      select: { id: true, userId: true, storageKey: true },
    });
    for (const p of photos) {
      const list = result.get(p.userId) ?? [];
      list.push({ id: p.id, url: await this.storage.viewUrl(p.storageKey) });
      result.set(p.userId, list);
    }
    return result;
  }

  /** Sets the full order. `photoIds` must list every uploaded photo exactly once; the first becomes primary. */
  async reorder(userId: string, photoIds: string[]): Promise<PhotoView[]> {
    const current = await this.prisma.profilePhoto.findMany({
      where: { userId, status: 'UPLOADED' },
      select: { id: true },
    });
    const currentIds = new Set(current.map((p) => p.id));
    if (
      photoIds.length !== currentIds.size ||
      new Set(photoIds).size !== photoIds.length ||
      !photoIds.every((id) => currentIds.has(id))
    ) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'List every one of your photos exactly once.', {
        fields: [{ path: 'photo_ids', message: 'Must contain each uploaded photo exactly once' }],
      });
    }
    await this.applyOrder(userId, photoIds);
    return this.list(userId);
  }

  async makePrimary(userId: string, photoId: string): Promise<PhotoView[]> {
    const order = await this.uploadedOrder(userId);
    if (!order.includes(photoId)) throw notFound();
    await this.applyOrder(userId, [photoId, ...order.filter((id) => id !== photoId)]);
    return this.list(userId);
  }

  async remove(userId: string, photoId: string): Promise<PhotoView[]> {
    const photo = await this.prisma.profilePhoto.findFirst({ where: { id: photoId, userId } });
    if (!photo) throw notFound();

    if (photo.status === 'UPLOADED') {
      const count = await this.prisma.profilePhoto.count({ where: { userId, status: 'UPLOADED' } });
      // Once a member has reached the minimum, they can't drop below it (upload a replacement first).
      if (count === MIN_PHOTOS) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'MIN_PHOTOS',
          `Keep at least ${MIN_PHOTOS} photos. Add a new one before removing this.`,
        );
      }
    }
    await this.discard(photo.id, photo.storageKey);
    await this.applyOrder(userId, await this.uploadedOrder(userId));
    await recomputeCompleteness(this.prisma, userId);
    return this.list(userId);
  }

  private async uploadedOrder(userId: string): Promise<string[]> {
    const photos = await this.prisma.profilePhoto.findMany({
      where: { userId, status: 'UPLOADED' },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    return photos.map((p) => p.id);
  }

  /**
   * Rewrites positions 0..n-1. The unique (user_id, position) index is checked
   * row by row, so positions are cleared first inside the same transaction.
   */
  private async applyOrder(userId: string, ids: string[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.profilePhoto.updateMany({ where: { userId, status: 'UPLOADED' }, data: { position: null } });
      for (const [position, id] of ids.entries()) {
        await tx.profilePhoto.update({ where: { id }, data: { position } });
      }
    });
  }

  private async sweepStalePending(userId: string): Promise<void> {
    const stale = await this.prisma.profilePhoto.findMany({
      where: { userId, status: 'PENDING_UPLOAD', createdAt: { lt: new Date(Date.now() - PENDING_UPLOAD_TTL_MS) } },
      select: { id: true, storageKey: true },
    });
    for (const p of stale) await this.discard(p.id, p.storageKey);
  }

  private async discard(id: string, key: string): Promise<void> {
    await this.prisma.profilePhoto.delete({ where: { id } });
    try {
      await this.storage.delete(key);
    } catch (error) {
      // The row is gone, so the object is unreachable; a bucket lifecycle sweep can collect it.
      this.logger.warn(`Could not delete media object for photo ${id}: ${(error as Error).message}`);
    }
  }
}

function notFound(): ApiError {
  return new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Photo not found.');
}
