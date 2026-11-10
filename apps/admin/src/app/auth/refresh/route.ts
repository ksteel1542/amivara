import { type NextRequest, NextResponse } from 'next/server';

import { call } from '@/lib/api';
import { clearTokens, refreshToken, storeTokens } from '@/lib/session';

/** Rotates the refresh token (cookies can only be written here or in actions), then returns to the page. */
export async function GET(request: NextRequest) {
  const next = request.nextUrl.searchParams.get('next') ?? '/';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const token = await refreshToken();
  if (token) {
    try {
      const pair = await call<{ access_token: string; refresh_token: string; expires_in: number }>('/auth/refresh', {
        method: 'POST',
        body: { refresh_token: token },
        token: null,
      });
      await storeTokens(pair);
      return NextResponse.redirect(new URL(safeNext, request.url));
    } catch {
      // Expired, revoked or reused: sign in again.
    }
  }
  await clearTokens();
  return NextResponse.redirect(new URL('/login', request.url));
}
