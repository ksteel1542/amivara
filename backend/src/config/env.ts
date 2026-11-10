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

/** Used as ConfigModule's `validate` hook. Throws a readable error listing every problem. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
