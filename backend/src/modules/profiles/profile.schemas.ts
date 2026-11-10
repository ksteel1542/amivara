import { z } from 'zod';

import {
  INTEREST_IDS,
  LANGUAGE_CODES,
  MAX_BIO,
  MAX_INTERESTS,
  MAX_LANGUAGES,
  MAX_PROMPT_ANSWER,
  MAX_PROMPTS,
  PROMPT_IDS,
} from './catalog';

const unique = <T>(list: T[]) => new Set(list).size === list.length;
/** A trimmed optional text field where null (or an empty string) clears it. */
const clearable = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v === '' ? null : v));

/**
 * PATCH /v1/profiles/me. Every field is optional; unknown fields are rejected.
 * The database enforces the same limits with CHECK constraints.
 */
export const updateProfileSchema = z
  .object({
    bio: clearable(MAX_BIO),
    intent: z.enum(['relationship', 'friendship', 'casual', 'not_sure']),
    prompts: z
      .array(
        z.object({
          prompt_id: z.string().refine((id) => PROMPT_IDS.has(id), 'Unknown prompt'),
          answer: z.string().trim().min(1, 'Write an answer').max(MAX_PROMPT_ANSWER),
        }),
      )
      .max(MAX_PROMPTS, `At most ${MAX_PROMPTS} prompts`)
      .refine((list) => unique(list.map((p) => p.prompt_id)), 'Each prompt can only be answered once'),
    interests: z
      .array(z.string().refine((id) => INTEREST_IDS.has(id), 'Unknown interest'))
      .max(MAX_INTERESTS, `At most ${MAX_INTERESTS} interests`)
      .refine(unique, 'No duplicates'),
    languages: z
      .array(z.string().refine((code) => LANGUAGE_CODES.has(code), 'Unknown language'))
      .max(MAX_LANGUAGES, `At most ${MAX_LANGUAGES} languages`)
      .refine(unique, 'No duplicates'),
    height_cm: z.number().int().min(120, 'Minimum 120 cm').max(230, 'Maximum 230 cm').nullable(),
    education: clearable(100),
    job_title: clearable(100),
    religion: clearable(50),
  })
  .partial()
  .strict();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** PUT /v1/profiles/me/location. */
export const locationSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy_m: z.number().min(0).max(100_000).optional(),
  })
  .strict()
  .refine((p) => !(p.lat === 0 && p.lng === 0), 'Location unavailable');

export type LocationInput = z.infer<typeof locationSchema>;
