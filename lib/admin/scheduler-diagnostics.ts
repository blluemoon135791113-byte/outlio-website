/**
 * Narrows the raw jsonb from `scheduler_diagnostics()` into something the
 * admin page can render.
 *
 * ⚠️ EVERY FIELD IS TREATED AS ABSENT UNTIL PROVEN OTHERWISE. The RPC returns
 * `Json`, and this panel exists to be read when the scheduler is already
 * misbehaving — the one moment it must not throw. A malformed or missing
 * section degrades to an empty list, never an exception.
 */

export type CronJob = {
  name: string
  schedule: string
  active: boolean
}

export type CronRun = {
  status: string
  message: string | null
  startedAt: string | null
}

export type HttpResponse = {
  statusCode: number | null
  error: string | null
  timedOut: boolean
  createdAt: string | null
}

export type SchedulerDiagnostics = {
  jobs: CronJob[]
  runs: CronRun[]
  http: HttpResponse[]
}

export const EMPTY_DIAGNOSTICS: SchedulerDiagnostics = { jobs: [], runs: [], http: [] }

function rows(raw: unknown, key: string): Record<string, unknown>[] {
  if (typeof raw !== 'object' || raw === null) return []
  const value = (raw as Record<string, unknown>)[key]
  if (!Array.isArray(value)) return []
  return value.filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

export function parseSchedulerDiagnostics(raw: unknown): SchedulerDiagnostics {
  return {
    jobs: rows(raw, 'jobs').map((j) => ({
      name: str(j.jobname) ?? 'unnamed',
      schedule: str(j.schedule) ?? '—',
      // Anything that is not literally `false` is shown as active, because
      // "we could not tell" must not read as "the scheduler is switched off".
      active: j.active !== false,
    })),
    runs: rows(raw, 'recent_job_runs').map((r) => ({
      status: str(r.status) ?? 'unknown',
      message: str(r.return_message),
      startedAt: str(r.start_time),
    })),
    http: rows(raw, 'recent_http').map((h) => ({
      statusCode: typeof h.status_code === 'number' ? h.status_code : null,
      error: str(h.error_msg),
      timedOut: h.timed_out === true,
      createdAt: str(h.created),
    })),
  }
}

/**
 * The one-line verdict on the HTTP responses.
 *
 * A cron job can fire perfectly and still accomplish nothing — a wrong secret
 * gives 401 on every call, which looks identical to success from the scheduler
 * side. This is what tells those apart.
 */
export function httpSummary(http: HttpResponse[]): string {
  if (http.length === 0) return 'No calls recorded yet.'

  const counts = new Map<string, number>()
  for (const h of http) {
    const key = h.timedOut ? 'timed out' : h.error ? 'error' : String(h.statusCode ?? 'unknown')
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return [...counts.entries()].map(([code, n]) => `${n} × ${code}`).join(', ')
}
