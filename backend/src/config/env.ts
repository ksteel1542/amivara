import { z } from 'zod';

/**
 * Environment contract for the API. Validated once at boot by ConfigModule.
 * Secrets are optional in development and test, and required in staging/production.
 */
const base = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  AWS_REGION: z.string().default('af-south-1'),
  S3_MEDIA_BUCKET: z.string().optional(),
  CLOUDFRONT_MEDIA_DOMAIN: z.string().optional(),
  SMILE_ID_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
  SMILE_ID_PARTNER_ID: z.string().optional(),
  SMILE_ID_API_KEY: z.string().optional(),
  SMILE_ID_CALLBACK_URL: z.string().url().optional(),
});

const REQUIRED_IN_DEPLOYED_ENVS = [
  'REDIS_URL',
  'S3_MEDIA_BUCKET',
  'SMILE_ID_PARTNER_ID',
  'SMILE_ID_API_KEY',
  'SMILE_ID_CALLBACK_URL',
] as const;

export const envSchema = base.superRefine((env, ctx) => {
  const deployed = env.NODE_ENV === 'staging' || env.NODE_ENV === 'production';
  if (!deployed) return;

  for (const key of REQUIRED_IN_DEPLOYED_ENVS) {
    if (!env[key]) {
      ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required in ${env.NODE_ENV}` });
    }
  }
  if (env.NODE_ENV === 'production' && env.SMILE_ID_ENVIRONMENT !== 'production') {
    ctx.addIssue({
      code: 'custom',
      path: ['SMILE_ID_ENVIRONMENT'],
      message: 'Production must use the Smile ID production environment',
    });
  }
  if (env.AWS_REGION !== 'af-south-1') {
    ctx.addIssue({
      code: 'custom',
      path: ['AWS_REGION'],
      message: 'Deployed environments must run in af-south-1 (ARCHITECTURE.md §6.1)',
    });
  }
});

export type Env = z.infer<typeof envSchema>;

const DB_PARTS = ['DB_HOST', 'DB_USERNAME', 'DB_PASSWORD', 'DB_NAME'] as const;

/**
 * On ECS the database credentials arrive as separate variables (DB_HOST,
 * DB_PORT, DB_NAME from Terraform; DB_USERNAME / DB_PASSWORD injected from the
 * RDS-managed secret), because RDS rotates that secret itself. Build the
 * Prisma connection string from them when DATABASE_URL isn't set directly.
 * TLS is required (the RDS parameter group sets rds.force_ssl = 1).
 */
export function resolveDatabaseUrl(raw: Record<string, unknown>): string | undefined {
  if (typeof raw.DATABASE_URL === 'string' && raw.DATABASE_URL.length > 0) return raw.DATABASE_URL;
  if (!DB_PARTS.every((k) => typeof raw[k] === 'string' && (raw[k] as string).length > 0)) return undefined;

  const user = encodeURIComponent(raw.DB_USERNAME as string);
  const password = encodeURIComponent(raw.DB_PASSWORD as string);
  const port = typeof raw.DB_PORT === 'string' && raw.DB_PORT ? raw.DB_PORT : '5432';
  const db = encodeURIComponent(raw.DB_NAME as string);
  return `postgresql://${user}:${password}@${raw.DB_HOST as string}:${port}/${db}?schema=public&sslmode=require`;
}

/**
 * Used as ConfigModule's `validate` hook. Throws a readable error listing every problem.
 * When DATABASE_URL is built from DB_* parts, it is also written to process.env,
 * because the Prisma client reads env("DATABASE_URL") directly.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const databaseUrl = resolveDatabaseUrl(raw);
  if (databaseUrl && raw.DATABASE_URL !== databaseUrl) {
    process.env.DATABASE_URL = databaseUrl;
  }
  const result = envSchema.safeParse({ ...raw, DATABASE_URL: databaseUrl });
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
