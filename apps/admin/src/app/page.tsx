const QUEUES = [
  { name: 'Underage reports', target: 'Resolve in under 1 hour, 24/7', priority: 'critical' },
  { name: 'Safety reports', target: 'Resolve in under 24 hours', priority: 'high' },
  { name: 'Verification reviews', target: 'Smile ID manual review, DOB mismatches', priority: 'high' },
  { name: 'Photo moderation', target: 'Flagged by automated screening', priority: 'normal' },
] as const;

export default function OverviewPage() {
  return (
    <>
      <h1>Overview</h1>
      <p className="muted">Moderation queues. Live counts arrive with the admin API (Stage 4, sprints 7–8).</p>
      <div className="grid">
        {QUEUES.map((q) => (
          <section key={q.name} className={`card card--${q.priority}`}>
            <h2>{q.name}</h2>
            <p className="count" aria-label="Open items">
              —
            </p>
            <p className="muted">{q.target}</p>
          </section>
        ))}
      </div>
    </>
  );
}
