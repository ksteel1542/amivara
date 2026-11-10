import { z } from 'zod';

export const requestOtpSchema = z.object({
  phone: z.string().min(5).max(32),
  channel: z.enum(['sms', 'whatsapp']).default('sms'),
});

export const verifyOtpSchema = z.object({
  challenge_id: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const refreshSchema = z.object({
  refresh_token: z.string().min(20).max(200),
});

export type RequestOtpInput = z.infer<typeof requestOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
