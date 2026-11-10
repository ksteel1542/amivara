import { z } from 'zod';

const gender = z.enum(['woman', 'man', 'non_binary']);

export const ageGateSchema = z.object({
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
});

export const completeOnboardingSchema = z.object({
  first_name: z
    .string()
    .trim()
    .min(1, 'Enter your first name')
    .max(50)
    // Letters in any script (Yoruba, Igbo and Hausa letters included), spaces, hyphens, apostrophes.
    .regex(/^[\p{L}\p{M}][\p{L}\p{M}' ʼ-]*$/u, 'Use letters only'),
  date_of_birth: ageGateSchema.shape.date_of_birth,
  gender,
  interested_in: z
    .array(gender)
    .min(1, 'Choose at least one')
    .max(3)
    .refine((list) => new Set(list).size === list.length, 'No duplicates'),
  intent: z.enum(['relationship', 'friendship', 'casual', 'not_sure']),
});

export type CompleteOnboardingInput = z.infer<typeof completeOnboardingSchema>;
