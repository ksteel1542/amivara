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

  const deployedSecrets = {
    REDIS_URL: 'redis://cache:6379',
    S3_MEDIA_BUCKET: 'amivara-media',
    SMILE_ID_PARTNER_ID: '1234',
    SMILE_ID_API_KEY: 'secret',
    SMILE_ID_CALLBACK_URL: 'https://api.amivara.com/v1/verification/webhook',
    JWT_PRIVATE_KEY_PEM: '-----BEGIN PRIVATE KEY-----',
    JWT_PUBLIC_KEY_PEM: '-----BEGIN PUBLIC KEY-----',
    HASH_PEPPER: 'p'.repeat(32),
    MESSAGE_ENC_KEY: Buffer.alloc(32, 7).toString('base64'),
  };

  it('requires the JWT keys and hashing pepper in staging', () => {
    const { HASH_PEPPER: _pepper, ...withoutPepper } = deployedSecrets;
    expect(() => validateEnv({ NODE_ENV: 'staging', DATABASE_URL: DB, ...withoutPepper })).toThrow(
      /HASH_PEPPER is required/,
    );
    expect(validateEnv({ NODE_ENV: 'staging', DATABASE_URL: DB, ...deployedSecrets }).OTP_PROVIDER).toBe('console');
  });

  it('rejects a short hashing pepper', () => {
    expect(() => validateEnv({ DATABASE_URL: DB, HASH_PEPPER: 'too-short' })).toThrow(/HASH_PEPPER/);
  });

  it('refuses the Smile ID sandbox and the console OTP sender in production', () => {
    const complete = {
      NODE_ENV: 'production',
      DATABASE_URL: DB,
      ...deployedSecrets,
      SMILE_ID_ENVIRONMENT: 'production',
    };
    expect(() => validateEnv({ ...complete, SMILE_ID_ENVIRONMENT: 'sandbox' })).toThrow(
      /Smile ID production environment/,
    );
    // Only the console sender exists until a provider is chosen, so production cannot boot yet.
    expect(() => validateEnv(complete)).toThrow(/real SMS\/WhatsApp OTP provider/);
  });

  it('refuses deployed environments outside af-south-1', () => {
    expect(() =>
      validateEnv({ NODE_ENV: 'staging', DATABASE_URL: DB, ...deployedSecrets, AWS_REGION: 'eu-west-1' }),
    ).toThrow(/af-south-1/);
  });
});
