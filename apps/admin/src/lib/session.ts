import { randomUUID } from 'node:crypto';

import { cookies } from 'next/headers';

/**
 * The moderator's API tokens live in httpOnly, Secure, SameSite=Strict
 * cookies: browser scripts never see them, and the console only ever calls
 * the API from the server.
 */
export const COOKIE = {
  access: 'amv_admin_at',
  refresh: 'amv_admin_rt',
  device: 'amv_admin_dev',
  challenge: 'amv_admin_ch',
} as const;

const base = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
};

export async function accessToken(): Promise<string | undefined> {
  return (await cookies()).get(COOKIE.access)?.value;
}

export async function refreshToken(): Promise<string | undefined> {
  return (await cookies()).get(COOKIE.refresh)?.value;
}

/** A stable per-browser device id (X-Device-Id), so sessions and OTP limits work as on the phone app. */
export async function deviceId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(COOKIE.device)?.value;
  if (existing) return existing;
  const id = `admin-${randomUUID()}`;
  try {
    jar.set(COOKIE.device, id, { ...base, maxAge: 60 * 60 * 24 * 365 });
  } catch {
    // Rendering (read-only cookies): sign-in, a Server Action, sets it for real.
  }
  return id;
}

/** Only from Server Actions and Route Handlers (cookies are read-only while rendering). */
export async function storeTokens(tokens: { access_token: string; refresh_token: string; expires_in: number }) {
  const jar = await cookies();
  jar.set(COOKIE.access, tokens.access_token, { ...base, maxAge: tokens.expires_in });
  // Console sessions are short on purpose: a moderator signs in again after 12 hours.
  jar.set(COOKIE.refresh, tokens.refresh_token, { ...base, maxAge: 60 * 60 * 12 });
}

export async function clearTokens() {
  const jar = await cookies();
  jar.delete(COOKIE.access);
  jar.delete(COOKIE.refresh);
  jar.delete(COOKIE.challenge);
}

export async function setChallenge(id: string) {
  (await cookies()).set(COOKIE.challenge, id, { ...base, maxAge: 5 * 60 });
}

export async function challenge(): Promise<string | undefined> {
  return (await cookies()).get(COOKIE.challenge)?.value;
}
