import type { Metadata } from 'next';
import Link from 'next/link';

import { load } from '@/lib/api';
import { CATEGORY_LABEL, type Queue, when } from '@/lib/types';

export const metadata: Metadata = { title: 'Reports' };
export const dynamic = 'force-dynamic';

const TABS = [
  { status: 'open', label: 'Open' },
  { status: 'actioned', label: 'Actioned' },
  { status: 'dismissed', label: 'Dismissed' },
] as const;

const DONE: Record<string, string> = {
  dismiss: 'Report dismissed.',
  warn: 'Warning issued.',
  suspend: 'Member suspended.',
  ban: 'Member banned: sessions revoked, phone and devices blocked.',
};

/** The review queue: underage (critical) first, then oldest first (PRD §9: under 1 h / under 24 h). */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; done?: string }>;
}) {
  const params = await searchParams;
  const status = TABS.find((t) => t.status === params.status)?.status ?? 'open';
  const queue = await load<Queue>(`/admin/reports?status=${status}`, `/reports?status=${status}`);

  return (
    <>
      <h1>Reports</h1>
      {params.done && DONE[params.done] && (
        <p role="status" className="notice">
          {DONE[params.done]}
        </p>
      )}
      <p className="muted">
        Open: <strong>{queue.counts.critical}</strong> critical · <strong>{queue.counts.high}</strong> high ·{' '}
        <strong>{queue.counts.normal}</strong> normal
      </p>
      <nav className="tabs" aria-label="Report status">
        {TABS.map((t) => (
          <Link
            key={t.status}
            href={`/reports?status=${t.status}`}
            aria-current={t.status === status ? 'page' : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {queue.reports.length === 0 ? (
        <p className="empty">{status === 'open' ? 'The queue is clear.' : 'Nothing here.'}</p>
      ) : (
        <div className="table-wrap">
          <table className="queue">
            <thead>
              <tr>
                <th scope="col">Priority</th>
                <th scope="col">Reported member</th>
                <th scope="col">Reason</th>
                <th scope="col">Reported by</th>
                <th scope="col">Filed</th>
              </tr>
            </thead>
            <tbody>
              {queue.reports.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className={`pill pill--${r.priority}`}>{r.priority}</span>
                  </td>
                  <td>
                    <Link href={`/reports/${r.id}`} className="member">
                      {r.reported.photo_url ? (
                        // Signed CloudFront URLs: a plain <img>, never cached or optimised by Next.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.reported.photo_url} alt="" width={40} height={40} />
                      ) : (
                        <span className="avatar" aria-hidden="true" />
                      )}
                      <span>
                        {r.reported.first_name ?? 'Unknown'}, {r.reported.age}
                        {r.reported.verified && <span className="badge"> ✓ verified</span>}
                        <br />
                        <small className="muted">
                          {r.reported.status}
                          {r.reported.open_reports > 1 && ` · ${r.reported.open_reports} open reports`}
                        </small>
                      </span>
                    </Link>
                  </td>
                  <td>
                    {CATEGORY_LABEL[r.category] ?? r.category}
                    {r.details && <div className="muted clamp">{r.details}</div>}
                  </td>
                  <td>{r.reporter.first_name ?? 'Unknown'}</td>
                  <td>{when(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
