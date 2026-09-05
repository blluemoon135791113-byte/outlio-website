import type { SchedulerHealth } from '@/lib/admin/scheduler-health'

/**
 * The answer to "is the scheduler alive?".
 *
 * A Server Component: there is nothing interactive here, and the value is only
 * true as of the request that rendered it.
 */

const TONE: Record<SchedulerHealth['level'], { dot: string; text: string }> = {
  healthy: { dot: 'bg-success', text: 'text-ink' },
  delayed: { dot: 'bg-warning', text: 'text-ink' },
  stale: { dot: 'bg-danger', text: 'text-danger' },
  never: { dot: 'bg-danger', text: 'text-danger' },
}

export function SchedulerStatus({
  health,
  lastJobs,
}: {
  health: SchedulerHealth
  /** The per-job detail of the most recent tick, if there was one. */
  lastJobs: { name: string; ok: boolean; detail: string }[]
}) {
  const tone = TONE[health.level]

  return (
    <div className="space-y-3">
      <p className={`flex items-center gap-2 text-sm font-medium ${tone.text}`}>
        <span
          aria-hidden="true"
          className={`inline-block size-2 shrink-0 rounded-full ${tone.dot}`}
        />
        {health.label}
      </p>

      {/*
        `role="status"` rather than `alert`: this renders on load, and an alert
        that fires on every page view trains people to ignore it.
      */}
      <p role="status" className="text-sm leading-relaxed text-muted">
        {health.detail}
      </p>

      {lastJobs.length > 0 ? (
        <ul className="divide-y divide-border overflow-hidden rounded-[var(--radius-lg)] border border-border">
          {lastJobs.map((job) => (
            <li key={job.name} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
              <code className="text-sm font-medium text-ink">{job.name}</code>
              <span className="min-w-0 flex-1 text-sm text-muted">{job.detail}</span>
              {/*
                Only failures are labelled. Marking every success "ok" turns the
                list into a wall of green that hides the one red line in it.
              */}
              {job.ok ? null : (
                <span className="text-sm font-medium text-danger">failed</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
