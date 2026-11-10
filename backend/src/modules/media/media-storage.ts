import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl as getCloudFrontSignedUrl } from '@aws-sdk/cloudfront-signer';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl as getS3SignedUrl } from '@aws-sdk/s3-request-presigner';
import { HttpStatus } from '@nestjs/common';

import { ApiError } from '../../common/api-error';

export interface PresignedUpload {
  /** POST target (multipart/form-data). */
  url: string;
  /** Form fields to send before the file part (named "file"). */
  fields: Record<string, string>;
  expiresIn: number;
}

export interface StoredObject {
  size: number;
  contentType: string | undefined;
}

/** The private media bucket. Implemented by S3 in deployed envs, faked in tests. */
export interface MediaStorage {
  presignUpload(key: string, contentType: string, maxBytes: number): Promise<PresignedUpload>;
  head(key: string): Promise<StoredObject | null>;
  /** First `bytes` bytes of the object, for file-signature checks. */
  readPrefix(key: string, bytes: number): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  /** Short-lived URL to display the object (CloudFront signed URL, or S3 presigned GET in dev). */
  viewUrl(key: string): Promise<string>;
}

export const MEDIA_STORAGE = Symbol('MEDIA_STORAGE');

export const UPLOAD_URL_TTL_SECONDS = 10 * 60;
export const VIEW_URL_TTL_SECONDS = 60 * 60;

export interface S3MediaStorageOptions {
  bucket: string;
  region: string;
  /** Local S3-compatible endpoint (e.g. MinIO) for development. */
  endpoint?: string;
  /** media.<domain>: when set with the signing key, photos are served through CloudFront. */
  cloudFrontDomain?: string;
  signingKeyPairId?: string;
  signingPrivateKeyPem?: string;
  /** Explicit credentials (tests). Deployed envs use the ECS task role. */
  credentials?: S3ClientConfig['credentials'];
}

export class S3MediaStorage implements MediaStorage {
  private readonly s3: S3Client;

  constructor(private readonly options: S3MediaStorageOptions) {
    this.s3 = new S3Client({
      region: options.region,
      ...(options.endpoint ? { endpoint: options.endpoint, forcePathStyle: true } : {}),
      ...(options.credentials ? { credentials: options.credentials } : {}),
    });
  }

  async presignUpload(key: string, contentType: string, maxBytes: number): Promise<PresignedUpload> {
    // Presigned POST (not PUT) so S3 itself enforces the size limit and content type.
    const { url, fields } = await createPresignedPost(this.s3, {
      Bucket: this.options.bucket,
      Key: key,
      Conditions: [
        ['content-length-range', 1, maxBytes],
        ['eq', '$Content-Type', contentType],
      ],
      Fields: { 'Content-Type': contentType },
      Expires: UPLOAD_URL_TTL_SECONDS,
    });
    return { url, fields, expiresIn: UPLOAD_URL_TTL_SECONDS };
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const out = await this.s3.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: key }));
      return { size: out.ContentLength ?? 0, contentType: out.ContentType };
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || (error as Error).name === 'NotFound') return null;
      throw error;
    }
  }

  async readPrefix(key: string, bytes: number): Promise<Uint8Array> {
    const out = await this.s3.send(
      new GetObjectCommand({ Bucket: this.options.bucket, Key: key, Range: `bytes=0-${bytes - 1}` }),
    );
    return out.Body ? out.Body.transformToByteArray() : new Uint8Array();
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
  }

  async viewUrl(key: string): Promise<string> {
    const { cloudFrontDomain, signingKeyPairId, signingPrivateKeyPem } = this.options;
    const expires = new Date(Date.now() + VIEW_URL_TTL_SECONDS * 1000);
    if (cloudFrontDomain && signingKeyPairId && signingPrivateKeyPem) {
      return getCloudFrontSignedUrl({
        url: `https://${cloudFrontDomain}/${key}`,
        keyPairId: signingKeyPairId,
        privateKey: signingPrivateKeyPem,
        dateLessThan: expires.toISOString(),
      });
    }
    return getS3SignedUrl(this.s3, new GetObjectCommand({ Bucket: this.options.bucket, Key: key }), {
      expiresIn: VIEW_URL_TTL_SECONDS,
    });
  }
}

/** Used when S3_MEDIA_BUCKET is not configured (local dev without storage). */
export class UnconfiguredMediaStorage implements MediaStorage {
  private fail(): never {
    throw new ApiError(
      HttpStatus.SERVICE_UNAVAILABLE,
      'MEDIA_UNAVAILABLE',
      'Photo uploads are not available right now.',
    );
  }
  presignUpload(): Promise<PresignedUpload> {
    this.fail();
  }
  head(): Promise<StoredObject | null> {
    this.fail();
  }
  readPrefix(): Promise<Uint8Array> {
    this.fail();
  }
  delete(): Promise<void> {
    this.fail();
  }
  viewUrl(): Promise<string> {
    this.fail();
  }
}

/** Accepts only real JPEG or WebP files, by their first bytes rather than their claimed type. */
export function detectImageType(prefix: Uint8Array): 'image/jpeg' | 'image/webp' | null {
  if (prefix.length >= 3 && prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff) return 'image/jpeg';
  const ascii = (from: number, to: number) => String.fromCharCode(...prefix.slice(from, to));
  if (prefix.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}
