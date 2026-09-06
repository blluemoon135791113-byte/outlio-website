import {
  httpSummary,
  type SchedulerDiagnostics,
} from '@/lib/admin/scheduler-diagnostics'

/**
 * The scheduler's own machinery, for when the heartbeat says something is
 * wrong and the next question is "why".
 *
 * ⚠️ COLLAPSED BY DEFAULT, and a native `<details>` so it costs no client JS.
 * On a healthy day this is noise; the panel above already answers "is it
 * alive". This is only opened when that answer was no.
 */
export function SchedulerInternals({ diagnostics }: { diagnostics: SchedulerDiagnostics }) {
  const { jobs, runs, http } = diagnostics
  const lastRun = runs[0]
  const failing = runs.filter((r) => r.status !== 'succeeded')

  return (
    <details className="group rounded-[var(--radius-lg)] border border-border">
      <summary className="cursor-pointer list-none px-4 py-2.5 text-sm font-medium text-ink transition-colors duration-150 hover:bg-surface-muted">
        Scheduler internals
        <span className="ml-2 font-normal text-muted">
          {jobs.length === 0 ? 'no cron job registered' : httpSummary(http)}
        </span>
      </summary>

      <div className="space-y-4 border-t border-border px-4 py-3">
        {/*
          The single most useful line: a job that is absent is a completely
          different problem from one that is present and erroring, and the
          fixes have nothing in common.
        */}
        {jobs.length === 0 ? (
          <p className="text-sm text-danger">
            No pg_cron job is registered. Apply{' '}
            <code>supabase/migrations/0118_pg_cron_tick.sql</code> and store the
            secret in Vault — see the migration header.
          </p>
        ) : (
          <ul className="space-y-1">
            {jobs.map((job) => (
              <li key={job.name} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <code className="font-medium text-ink">{job.name}</code>
                <span className="text-muted">{job.schedule}</span>
                {job.active ? null : (
                  <span className="font-medium text-danger">disabled</span>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-1 text-sm">
          <p className="font-medium text-ink">Last cron run</p>
          {lastRun ? (
            <p className={lastRun.status === 'succeeded' ? 'text-muted' : 'text-danger'}>
              {lastRun.status}
              {lastRun.startedAt ? ` — ${lastRun.startedAt}` : ''}
              {/*
                The database's own error text, shown verbatim. A paraphrase of
                "relation vault.decrypted_secrets does not exist" is worse than
                useless — it is the exact string worth searching for.
              */}
              {lastRun.message && lastRun.status !== 'succeeded' ? (
                <span className="mt-1 block break-words font-mono text-xs">
                  {lastRun.message}
                </span>
              ) : null}
            </p>
          ) : (
            <p className="text-muted">Nothing recorded yet.</p>
          )}
          {failing.length > 0 ? (
            <p className="text-danger">
              {failing.length} of the last {runs.length} runs did not succeed.
            </p>
          ) : null}
        </div>

        <div className="space-y-1 text-sm">
          <p className="font-medium text-ink">Recent responses from /api/cron</p>
          <p className="text-muted">{httpSummary(http)}</p>
          {/*
            ⚠️ 401 IS THE FAILURE NOBODY SPOTS. The job fires exactly on time and
            is refused every time, which looks like a working scheduler from
            every angle except this one.
          */}
          {http.some((h) => h.statusCode === 401) ? (
            <p className="text-danger">
              A 401 means the secret in Vault does not match <code>CRON_SECRET</code>{' '}
              in Vercel. The job is firing correctly and being refused every time.
            </p>
          ) : null}
          {http.some((h) => h.timedOut) ? (
            <p className="text-warning">
              A call timed out. <code>pg_net</code>&rsquo;s default is 5 seconds and a
              tick takes 6–13, so check <code>timeout_milliseconds</code> on the job.
            </p>
          ) : null}
        </div>
      </div>
    </details>
  )
}
