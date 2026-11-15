import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { ApiError } from '../../common/api-error';
import { Public } from '../auth/auth.guards';
import { LocalDiskMediaStorage } from './local-disk-storage';
import { MAX_PHOTO_BYTES } from './photos.service';
import { MEDIA_STORAGE, type MediaStorage } from './media-storage';

interface UploadedPart {
  buffer: Buffer;
  size: number;
}

/**
 * Stand-in for the S3 bucket when MEDIA_LOCAL_DIR is set (development only).
 * Public routes, like S3's: each request carries its own signed token. With
 * any other storage these answer 404.
 */
@Controller('media/local')
export class LocalMediaController {
  constructor(@Inject(MEDIA_STORAGE) private readonly storage: MediaStorage) {}

  private local(): LocalDiskMediaStorage {
    if (!(this.storage instanceof LocalDiskMediaStorage)) {
      throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found.');
    }
    return this.storage;
  }

  /** Same contract as an S3 presigned POST: form fields first, the file part named "file". 204 on success. */
  @Public()
  @Post('upload')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES + 1, files: 1, fields: 10 } }))
  async upload(@Body() fields: Record<string, unknown>, @UploadedFile() file: UploadedPart | undefined): Promise<void> {
    const storage = this.local();
    const grant = storage.readUploadToken(fields.token);
    if (!grant) throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Upload link is invalid or expired.');
    if (fields['Content-Type'] !== grant.contentType) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Content type does not match the upload link.');
    }
    if (!file || file.size < 1 || file.size > grant.maxBytes) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'The file is missing or too large.');
    }
    // The photo's real type is checked from its bytes on confirm (detectImageType).
    await storage.write(grant.key, file.buffer, grant.contentType);
  }

  @Public()
  @Get('file')
  async file(
    @Query('key') key: unknown,
    @Query('exp') exp: unknown,
    @Query('sig') sig: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const storage = this.local();
    if (!storage.checkView(key, exp, sig)) throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Link expired.');
    const object = await storage.read(key);
    if (!object) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found.');
    res.setHeader('Content-Type', object.contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(object.bytes);
  }
}
