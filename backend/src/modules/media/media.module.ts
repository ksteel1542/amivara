import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env';
import { LocalDiskMediaStorage } from './local-disk-storage';
import { LocalMediaController } from './local-media.controller';
import { MediaController } from './media.controller';
import { MEDIA_STORAGE, type MediaStorage, S3MediaStorage, UnconfiguredMediaStorage } from './media-storage';
import { PhotosService } from './photos.service';

/**
 * Profile photos in the private S3 media bucket (af-south-1), served through
 * CloudFront signed URLs. Automated moderation and the SmartSelfie face match
 * arrive in later sprints; until then new photos stay `moderation_status: pending`.
 */
@Module({
  controllers: [MediaController, LocalMediaController],
  providers: [
    PhotosService,
    {
      provide: MEDIA_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): MediaStorage => {
        const bucket = config.get('S3_MEDIA_BUCKET', { infer: true });
        const localDir = config.get('MEDIA_LOCAL_DIR', { infer: true });
        if (!bucket && localDir) {
          // Development without S3/MinIO: photos on disk, served by LocalMediaController.
          const base =
            config.get('MEDIA_LOCAL_BASE_URL', { infer: true }) ??
            `http://localhost:${config.get('PORT', { infer: true })}/v1`;
          return new LocalDiskMediaStorage(localDir, base, config.get('HASH_PEPPER', { infer: true }));
        }
        if (!bucket) return new UnconfiguredMediaStorage();
        return new S3MediaStorage({
          bucket,
          region: config.get('AWS_REGION', { infer: true }),
          endpoint: config.get('S3_ENDPOINT', { infer: true }),
          cloudFrontDomain: config.get('CLOUDFRONT_MEDIA_DOMAIN', { infer: true }),
          signingKeyPairId: config.get('MEDIA_SIGNING_KEY_PAIR_ID', { infer: true }),
          signingPrivateKeyPem: config.get('MEDIA_SIGNING_PRIVATE_KEY_PEM', { infer: true }),
        });
      },
    },
  ],
  exports: [PhotosService, MEDIA_STORAGE],
})
export class MediaModule {}
