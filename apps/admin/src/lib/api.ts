import { redirect } from 'next/navigation';

import { accessToken, deviceId } from './session';

/** The API as seen from the console's server (internal ALB in AWS). */
export const API_BASE_URL = process.env.ADMIN_API_URL ?? 'http://localhost:4000/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** One call to the API with the moderator's token. Throws ApiError on any non-2xx. */
export async function call<T>(
  path: string,
  init: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  const token = init.token === null ? undefined : (init.token ?? (await accessToken()));
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: init.method ?? 'GET',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'X-Device-Id': await deviceId(),
      'X-Platform': 'web',
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  if (!res.ok) {
    throw new ApiError(res.status, json.error?.code ?? 'ERROR', json.error?.message ?? 'Something went wrong.');
  }
  return json as T;
}

/**
 * For Server Components: an expired access token goes through /auth/refresh
 * (which can set cookies) and comes back; anything else unauthenticated
 * goes to sign-in.
 */
export async function load<T>(path: string, returnTo: string): Promise<T> {
  if (!(await accessToken())) redirect(`/auth/refresh?next=${encodeURIComponent(returnTo)}`);
  try {
    return await call<T>(path);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect(`/auth/refresh?next=${encodeURIComponent(returnTo)}`);
    // Members (not staff) get a 404 from the admin API.
    if (e instanceof ApiError && e.status === 404 && path === '/admin/me') redirect('/login?error=not-staff');
    throw e;
  }
}
