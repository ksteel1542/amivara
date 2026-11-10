import type { Metadata } from 'next';
import Link from 'next/link';

import { load } from '@/lib/api';
import { CATEGORY_LABEL, type ReportDetail, when } from '@/lib/types';

import { moderate, unban } from '../actions';

export const metadata: Metadata = { title: 'Report' };
export const dynamic = 'force-dynamic';

/**
 * One report: the flagged profile (live), what was reported, and the
 * conversation exactly as it stood when the report was filed (the evidence
 * snapshot cannot change). Opening this page is written to the audit log.
 */
export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  const { id } = await params;
  const { error, done } = await searchParams;
  const r = await load<ReportDetail>(`/admin/reports/${id}`, `/reports/${id}`);
  const p = r.reported;
  const open = r.status === 'open';
  const restricted = p.status === 'banned' || p.status === 'suspended';

  return (
    <>
      <p>
        <Link href="/reports">← Back to the queue</Link>
      </p>
      <h1>
        {CATEGORY_LABEL[r.category] ?? r.category} <span className={`pill pill--${r.priority}`}>{r.priority}</span>
      </h1>
      <p className="muted">
        Filed {when(r.created_at)} by {r.reporter.first_name ?? 'a member'} · status <strong>{r.status}</strong>
        {r.resolution && ` · ${r.resolution}`}
      </p>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      {done === 'unban' && (
        <p role="status" className="notice">
          Member reinstated.
        </p>
      )}

      <div className="detail">
        <section className="card" aria-labelledby="profile-h">
          <h2 id="profile-h">
            {p.first_name ?? 'Unknown'}, {p.age} {p.verified && <span className="badge">✓ verified</span>}
          </h2>
          <p className="muted">
            Account {p.status}
            {p.suspended_until && ` until ${when(p.suspended_until)}`} · member since {when(p.member_since)}
          </p>
          {p.photos.length > 0 && (
            <div className="photos">
              {p.photos.map((url, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={url}
                  src={url}
                  alt={`Photo ${i + 1} of ${p.first_name ?? 'the member'}`}
                  width={120}
                  height={150}
                />
              ))}
            </div>
          )}
          {p.job_title && <p>{p.job_title}</p>}
          {p.bio && <p className="bio">{p.bio}</p>}
          {p.prompts.map((q, i) => (
            <p key={i}>
              <small className="muted">{q.prompt_id}</small>
              <br />
              {q.answer}
            </p>
          ))}

          <h3>Reported because</h3>
          <p>{r.details ?? <span className="muted">No details given.</span>}</p>

          {r.history.length > 0 && (
            <>
              <h3>Enforcement history</h3>
              <ul className="history">
                {r.history.map((h, i) => (
                  <li key={i}>
                    <strong>{h.action}</strong> {when(h.created_at)}
                    {h.automatic && ' (automatic)'} · {h.reason}
                    {h.expires_at && ` · until ${when(h.expires_at)}`}
                  </li>
                ))}
              </ul>
            </>
          )}
          {r.other_reports.length > 0 && (
            <>
              <h3>Other reports about this member</h3>
              <ul className="history">
                {r.other_reports.map((o) => (
                  <li key={o.id}>
                    <Link href={`/reports/${o.id}`}>{CATEGORY_LABEL[o.category] ?? o.category}</Link> · {o.status} ·{' '}
                    {when(o.created_at)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="card" aria-labelledby="chat-h">
          <h2 id="chat-h">Message context</h2>
          <p className="muted">
            Snapshot taken {when(r.evidence.captured_at)}
            {r.evidence.matched_at ? ` · matched ${when(r.evidence.matched_at)}` : ' · they were not matched'}.
          </p>
          {r.evidence.messages.length === 0 ? (
            <p className="empty">No messages between them.</p>
          ) : (
            <ol className="transcript">
              {r.evidence.messages.map((m) => (
                <li key={m.id} className={`msg msg--${m.from}${m.id === r.message_id ? ' msg--flagged' : ''}`}>
                  <span className="who">
                    {m.from === 'reported' ? (p.first_name ?? 'Reported') : 'Reporter'}
                    {m.id === r.message_id && ' · reported message'}
                  </span>
                  <span className="body">{m.body}</span>
                  <time dateTime={m.sent_at}>
                    {when(m.sent_at)}
                    {m.deleted && ' · deleted later'}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {open ? (
        <form action={moderate} className="card actions" aria-labelledby="actions-h">
          <h2 id="actions-h">Decision</h2>
          <input type="hidden" name="report_id" value={r.id} />
          <input type="hidden" name="user_id" value={p.user_id} />
          <label>
            Reason (kept in the member&apos;s history and the audit log; required except to dismiss)
            <textarea name="reason" rows={2} maxLength={1000} placeholder="e.g. Asked for money in chat" />
          </label>
          <label className="inline">
            Suspension length
            <select name="days" defaultValue="7">
              <option value="1">1 day</option>
              <option value="3">3 days</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
            </select>
          </label>
          <div className="buttons">
            <button type="submit" name="action" value="dismiss" className="btn">
              Dismiss report
            </button>
            <button type="submit" name="action" value="warn" className="btn">
              Issue warning
            </button>
            <button type="submit" name="action" value="suspend" className="btn btn--warning">
              Temporary suspend
            </button>
            <button type="submit" name="action" value="ban" className="btn btn--danger">
              Permanent ban
            </button>
          </div>
          <p className="muted small">
            A permanent ban signs the member out everywhere, closes their chats and blocks their phone number and
            devices from creating a new account.
          </p>
        </form>
      ) : (
        restricted && (
          <form action={unban} className="card actions" aria-labelledby="reinstate-h">
            <h2 id="reinstate-h">Reinstate</h2>
            <input type="hidden" name="report_id" value={r.id} />
            <input type="hidden" name="user_id" value={p.user_id} />
            <label>
              Reason
              <textarea
                name="reason"
                rows={2}
                minLength={3}
                maxLength={1000}
                required
                placeholder="e.g. Appeal upheld"
              />
            </label>
            <div className="buttons">
              <button type="submit" className="btn">
                Lift {p.status === 'banned' ? 'ban' : 'suspension'}
              </button>
            </div>
          </form>
        )
      )}
    </>
  );
}
