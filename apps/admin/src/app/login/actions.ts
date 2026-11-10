'use server';

import { redirect } from 'next/navigation';

import { ApiError, call } from '@/lib/api';
import { challenge, clearTokens, setChallenge, storeTokens } from '@/lib/session';

/** Step 1: send a code to the moderator's phone (the same OTP sign-in as the app). */
export async function requestCode(form: FormData): Promise<void> {
  const phone = String(form.get('phone') ?? '').trim();
  try {
    const res = await call<{ challenge_id: string }>('/auth/otp/request', {
      method: 'POST',
      body: { phone },
      token: null,
    });
    await setChallenge(res.challenge_id);
  } catch (e) {
    redirect(`/login?error=${encodeURIComponent(e instanceof ApiError ? e.message : 'Could not send a code.')}`);
  }
  redirect('/login?step=code');
}

/** Step 2: verify, then make sure this account is staff before letting it in. */
export async function verifyCode(form: FormData): Promise<void> {
  const challengeId = await challenge();
  if (!challengeId) redirect('/login?error=Your%20code%20expired.%20Start%20again.');
  let failure: string | null = null;
  try {
    const res = await call<{ status: string; access_token?: string; refresh_token?: string; expires_in?: number }>(
      '/auth/otp/verify',
      { method: 'POST', body: { challenge_id: challengeId, code: String(form.get('code') ?? '').trim() }, token: null },
    );
    if (res.status !== 'signed_in' || !res.access_token || !res.refresh_token) {
      failure = 'not-staff';
    } else {
      await storeTokens({
        access_token: res.access_token,
        refresh_token: res.refresh_token,
        expires_in: res.expires_in ?? 900,
      });
      try {
        await call('/admin/me', { token: res.access_token });
      } catch {
        // Signed in, but not a moderator: don't keep the session.
        await call('/auth/logout', { method: 'POST', token: res.access_token }).catch(() => undefined);
        await clearTokens();
        failure = 'not-staff';
      }
    }
  } catch (e) {
    failure = e instanceof ApiError ? e.message : 'Could not sign in.';
  }
  if (failure) redirect(`/login?step=code&error=${encodeURIComponent(failure)}`);
  redirect('/');
}
