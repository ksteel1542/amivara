import { type NextRequest, NextResponse } from 'next/server';

import { call } from '@/lib/api';
import { clearTokens } from '@/lib/session';

export async function POST(request: NextRequest) {
  await call('/auth/logout', { method: 'POST' }).catch(() => undefined);
  await clearTokens();
  return NextResponse.redirect(new URL('/login', request.url), 303);
}
