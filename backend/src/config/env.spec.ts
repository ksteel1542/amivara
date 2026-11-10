import { resolveDatabaseUrl, validateEnv } from './env';

const DB = 'postgresql://amivara:amivara@localhost:5432/amivara';

describe('validateEnv', () => {
  it('accepts a minimal development environment and applies defaults', () => {
    const env = validateEnv({ DATABASE_URL: DB });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.AWS_REGION).toBe('af-south-1');
    expect(env.SMILE_ID_ENVIRONMENT).toBe('sandbox');
  });

  describe('DATABASE_URL from ECS-injected DB_* parts', () => {
    const parts = {
      DB_HOST: 'amivara-staging-postgres.abc.af-south-1.rds.amazonaws.com',
      DB_PORT: '5432',
      DB_NAME: 'amivara',
      DB_USERNAME: 'amivara_admin',
      DB_PASSWORD: 'p@ss/w:rd?#&',
    };
    const original = process.env.DATABASE_URL;
    afterEach(() => {
      // Assigning undefined to process.env stores the string "undefined".
      if (original === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = original;
    });

    it('builds a TLS connection string and URL-encodes the RDS-generated password', () => {
      expect(resolveDatabaseUrl(parts)).toBe(
        'postgresql://amivara_admin:p%40ss%2Fw%3Ard%3F%23%26@amivara-staging-postgres.abc.af-south-1.rds.amazonaws.com:5432/amivara?schema=public&sslmode=require',
      );
    });

    it('prefers an explicit DATABASE_URL', () => {
      expect(resolveDatabaseUrl({ ...parts, DATABASE_URL: DB })).toBe(DB);
    });

    it('returns undefined when a part is missing', () => {
      expect(resolveDatabaseUrl({ ...parts, DB_PASSWORD: '' })).toBeUndefined();
    });

    it('exposes the built URL to Prisma through process.env', () => {
      const env = validateEnv(parts);
      expect(env.DATABASE_URL).toContain('sslmode=require');
      expect(process.env.DATABASE_URL).toBe(env.DATABASE_URL);
    });
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
