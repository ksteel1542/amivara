import { validateEnv } from './env';

const DB = 'postgresql://amivara:amivara@localhost:5432/amivara';

describe('validateEnv', () => {
  it('accepts a minimal development environment and applies defaults', () => {
    const env = validateEnv({ DATABASE_URL: DB });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.AWS_REGION).toBe('af-south-1');
    expect(env.SMILE_ID_ENVIRONMENT).toBe('sandbox');
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('requires Smile ID and infrastructure secrets in staging', () => {
    expect(() => validateEnv({ NODE_ENV: 'staging', DATABASE_URL: DB })).toThrow(/SMILE_ID_API_KEY is required/);
  });

  it('refuses the Smile ID sandbox in production', () => {
    const complete = {
      NODE_ENV: 'production',
      DATABASE_URL: DB,
      REDIS_URL: 'redis://cache:6379',
      S3_MEDIA_BUCKET: 'amivara-prod-media',
      SMILE_ID_PARTNER_ID: '1234',
      SMILE_ID_API_KEY: 'secret',
      SMILE_ID_CALLBACK_URL: 'https://api.amivara.com/v1/verification/webhook',
      SMILE_ID_ENVIRONMENT: 'sandbox',
    };
    expect(() => validateEnv(complete)).toThrow(/Smile ID production environment/);
    expect(validateEnv({ ...complete, SMILE_ID_ENVIRONMENT: 'production' }).NODE_ENV).toBe('production');
  });

  it('refuses deployed environments outside af-south-1', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'staging',
        DATABASE_URL: DB,
        REDIS_URL: 'redis://cache:6379',
        S3_MEDIA_BUCKET: 'b',
        SMILE_ID_PARTNER_ID: '1',
        SMILE_ID_API_KEY: 'k',
        SMILE_ID_CALLBACK_URL: 'https://example.test/cb',
        AWS_REGION: 'eu-west-1',
      }),
    ).toThrow(/af-south-1/);
  });
});
