'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { ApiError, call } from '@/lib/api';

type Action = 'dismiss' | 'warn' | 'suspend' | 'ban';

/**
 * One handler for the four quick actions on a report. Each goes to the
 * admin API, which records it (enforcement history + audit log).
 */
export async function moderate(form: FormData): Promise<void> {
  const action = String(form.get('action')) as Action;
  const reportId = String(form.get('report_id'));
  const userId = String(form.get('user_id'));
  const reason = String(form.get('reason') ?? '').trim();
  const days = Number(form.get('days') ?? 7);

  let error: string | null = null;
  let expired = false;
  try {
    switch (action) {
      case 'dismiss':
        await call(`/admin/reports/${reportId}/dismiss`, { method: 'POST', body: reason ? { note: reason } : {} });
        break;
      case 'warn':
        await call(`/admin/users/${userId}/warn`, { method: 'POST', body: { reason, report_id: reportId } });
        break;
      case 'suspend':
        await call(`/admin/users/${userId}/suspend`, { method: 'POST', body: { reason, days, report_id: reportId } });
        break;
      case 'ban':
        await call(`/admin/users/${userId}/ban`, { method: 'POST', body: { reason, report_id: reportId } });
        break;
      default:
        error = 'Unknown action.';
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) expired = true;
    error = e instanceof ApiError ? e.message : 'The action failed.';
  }
  if (expired)
    redirect(
      `/auth/refresh?next=${encodeURIComponent(`/reports/${reportId}?error=Session refreshed: please repeat the action.`)}`,
    );
  if (error) redirect(`/reports/${reportId}?error=${encodeURIComponent(error)}`);
  revalidatePath('/reports');
  redirect(`/reports?done=${action}`);
}

/** Lifts a ban or suspension (the report itself stays resolved). */
export async function unban(form: FormData): Promise<void> {
  const reportId = String(form.get('report_id'));
  const userId = String(form.get('user_id'));
  const reason = String(form.get('reason') ?? '').trim();
  let error: string | null = null;
  try {
    await call(`/admin/users/${userId}/unban`, { method: 'POST', body: { reason } });
  } catch (e) {
    error = e instanceof ApiError ? e.message : 'The action failed.';
  }
  redirect(`/reports/${reportId}${error ? `?error=${encodeURIComponent(error)}` : '?done=unban'}`);
}
