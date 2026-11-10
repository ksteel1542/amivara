import Link from 'next/link';

import { load } from '@/lib/api';
import type { Queue } from '@/lib/types';

export const dynamic = 'force-dynamic';

const QUEUES = [
  { key: 'critical', name: 'Underage reports', target: 'Resolve in under 1 hour, 24/7' },
  { key: 'high', name: 'Safety reports', target: 'Harassment, scams, explicit content, hate: under 24 hours' },
  { key: 'normal', name: 'Other reports', target: 'Fake profiles and other: under 24 hours' },
] as const;

export default async function OverviewPage() {
  const [me, queue] = await Promise.all([
    load<{ first_name: string | null; role: string }>('/admin/me', '/'),
    load<Queue>('/admin/reports?status=open&limit=1', '/'),
  ]);
  return (
    <>
      <h1>Overview</h1>
      <p className="muted">
        Signed in as {me.first_name ?? 'moderator'} ({me.role.replace('_', ' ')}). Open reports by priority.
      </p>
      <div className="grid">
        {QUEUES.map((q) => (
          <section key={q.key} className={`card card--${q.key}`}>
            <h2>{q.name}</h2>
            <p className="count" aria-label="Open items">
              {queue.counts[q.key]}
            </p>
            <p className="muted">{q.target}</p>
          </section>
        ))}
      </div>
      <p>
        <Link href="/reports" className="btn btn--primary">
          Open the review queue
        </Link>
      </p>
    </>
  );
}
