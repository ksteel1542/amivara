import { detectImageType, S3MediaStorage, UPLOAD_URL_TTL_SECONDS } from './media-storage';

describe('S3MediaStorage.presignUpload (offline signing)', () => {
  const storage = new S3MediaStorage({
    bucket: 'amivara-staging-media-123456789012',
    region: 'af-south-1',
    credentials: { accessKeyId: 'AKIAEXAMPLEEXAMPLE00', secretAccessKey: 'example-secret-key' },
  });

  it('returns a POST policy that pins the key, the content type and the size limit', async () => {
    const upload = await storage.presignUpload('photos/u1/p1.jpg', 'image/jpeg', 1_500_000);

    expect(upload.url).toBe('https://amivara-staging-media-123456789012.s3.af-south-1.amazonaws.com/');
    expect(upload.expiresIn).toBe(UPLOAD_URL_TTL_SECONDS);
    expect(upload.fields).toMatchObject({ key: 'photos/u1/p1.jpg', 'Content-Type': 'image/jpeg' });
    expect(upload.fields['X-Amz-Signature']).toMatch(/^[0-9a-f]{64}$/);

    const policy = JSON.parse(Buffer.from(upload.fields.Policy, 'base64').toString('utf8')) as {
      expiration: string;
      conditions: unknown[];
    };
    expect(policy.conditions).toEqual(
      expect.arrayContaining([
        ['content-length-range', 1, 1_500_000],
        ['eq', '$Content-Type', 'image/jpeg'],
        { key: 'photos/u1/p1.jpg' },
        { bucket: 'amivara-staging-media-123456789012' },
      ]),
    );
    const ttl = (Date.parse(policy.expiration) - Date.now()) / 1000;
    expect(ttl).toBeGreaterThan(UPLOAD_URL_TTL_SECONDS - 30);
    expect(ttl).toBeLessThanOrEqual(UPLOAD_URL_TTL_SECONDS);
  });

  it('serves photos through S3 presigned GETs when CloudFront signing is not configured', async () => {
    const url = await storage.viewUrl('photos/u1/p1.jpg');
    expect(url).toContain('/photos/u1/p1.jpg?');
    expect(url).toContain('X-Amz-Signature=');
  });
});

describe('detectImageType', () => {
  const bytes = (...b: number[]) => Uint8Array.from(b);
  const ascii = (s: string) => Uint8Array.from(Buffer.from(s, 'latin1'));

  it('recognises JPEG and WebP by signature', () => {
    expect(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(detectImageType(ascii('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '))).toBe('image/webp');
  });

  it('rejects other files whatever their claimed type', () => {
    expect(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBeNull(); // PNG
    expect(detectImageType(ascii('<svg xmlns='))).toBeNull();
    expect(detectImageType(ascii('GIF89a'))).toBeNull();
    expect(detectImageType(new Uint8Array())).toBeNull();
  });
});
