import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { z } from 'zod';

import type { AuthenticatedMember } from '../../common/authenticated-member';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentMember } from '../auth/auth.guards';
import { MAX_PHOTOS, PhotosService } from './photos.service';

const uploadUrlSchema = z.object({ content_type: z.enum(['image/jpeg', 'image/webp']) }).strict();
const orderSchema = z.object({ photo_ids: z.array(z.string().uuid()).min(1).max(MAX_PHOTOS) }).strict();

/**
 * Profile photos (API.md "Media"). Flow: POST upload-url → the app POSTs the
 * file straight to S3 → POST photos/:id/confirm. Photos are never public:
 * responses carry short-lived signed URLs.
 */
@Controller('media')
export class MediaController {
  constructor(private readonly photos: PhotosService) {}

  @Post('upload-url')
  @HttpCode(HttpStatus.CREATED)
  uploadUrl(
    @CurrentMember() member: AuthenticatedMember,
    @Body(new ZodValidationPipe(uploadUrlSchema)) body: z.infer<typeof uploadUrlSchema>,
  ) {
    return this.photos.requestUpload(member.id, body.content_type);
  }

  @Post('photos/:id/confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(@CurrentMember() member: AuthenticatedMember, @Param('id', new ParseUUIDPipe()) id: string) {
    return { photos: await this.photos.confirm(member.id, id) };
  }

  @Get('photos')
  async list(@CurrentMember() member: AuthenticatedMember) {
    return { photos: await this.photos.list(member.id) };
  }

  @Put('photos/order')
  async reorder(
    @CurrentMember() member: AuthenticatedMember,
    @Body(new ZodValidationPipe(orderSchema)) body: z.infer<typeof orderSchema>,
  ) {
    return { photos: await this.photos.reorder(member.id, body.photo_ids) };
  }

  @Put('photos/:id/primary')
  async makePrimary(@CurrentMember() member: AuthenticatedMember, @Param('id', new ParseUUIDPipe()) id: string) {
    return { photos: await this.photos.makePrimary(member.id, id) };
  }

  @Delete('photos/:id')
  async remove(@CurrentMember() member: AuthenticatedMember, @Param('id', new ParseUUIDPipe()) id: string) {
    return { photos: await this.photos.remove(member.id, id) };
  }
}
