/** Shapes returned by the admin API (docs/API.md "Admin"). */

export type Priority = 'critical' | 'high' | 'normal';
export type ReportStatus = 'open' | 'actioned' | 'dismissed';

export interface QueueItem {
  id: string;
  category: string;
  priority: Priority;
  status: ReportStatus;
  details: string | null;
  created_at: string;
  resolved_at: string | null;
  reporter: { user_id: string; first_name: string | null };
  reported: {
    user_id: string;
    first_name: string | null;
    age: number;
    status: string;
    verified: boolean;
    photo_url: string | null;
    open_reports: number;
  };
}

export interface Queue {
  counts: Record<Priority, number>;
  reports: QueueItem[];
}

export interface ReportDetail {
  id: string;
  category: string;
  priority: Priority;
  status: ReportStatus;
  details: string | null;
  message_id: string | null;
  created_at: string;
  resolved_at: string | null;
  resolution: string | null;
  reporter: { user_id: string; first_name: string | null };
  reported: {
    user_id: string;
    first_name: string | null;
    age: number;
    status: string;
    suspended_until: string | null;
    verified: boolean;
    member_since: string;
    bio: string | null;
    job_title: string | null;
    prompts: Array<{ prompt_id?: string; answer?: string }>;
    photos: string[];
  };
  evidence: {
    captured_at: string;
    profile: { first_name: string | null; age: number | null; bio: string | null; verified: boolean };
    match_id: string | null;
    matched_at: string | null;
    messages: Array<{ id: string; from: 'reporter' | 'reported'; body: string; sent_at: string; deleted: boolean }>;
  };
  history: Array<{ action: string; reason: string; automatic: boolean; created_at: string; expires_at: string | null }>;
  other_reports: Array<{ id: string; category: string; status: string; created_at: string }>;
}

export const CATEGORY_LABEL: Record<string, string> = {
  fake_profile: 'Fake profile',
  underage: 'Underage suspicion',
  harassment: 'Harassment',
  scam: 'Scam or money request',
  explicit_content: 'Explicit content without consent',
  hate: 'Hate',
  other: 'Other',
};

export const when = (iso: string) =>
  new Date(iso).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' });
