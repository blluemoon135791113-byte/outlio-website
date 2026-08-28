import { isActiveJob } from '@/lib/jobs/progress'
import type { DashboardJob } from '@/lib/jobs/dashboard-types'

/**
 * How much a run produced, in its own unit.
 *
 * ⚠️ AN ACCOUNT RUN IS NOT A LEAD RUN WITH ZERO LEADS. Reading `leads_kept`
 * for every job renders a successful ingest of 25 companies as "0 leads kept"
 * — a run that worked, displayed as one that produced nothing.
 */
export function jobYield(job: DashboardJob): string {
  if (job.kind === 'account_list') {
    const n = job.accounts_created + job.accounts_matched
    return `${n.toLocaleString()} compan${n === 1 ? 'y' : 'ies'}`
  }
  return `${job.leads_kept.toLocaleString()} lead${job.leads_kept === 1 ? '' : 's'}`
}

/**
 * What a run is called in the history.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  NOT THE SAVED FILENAME.                                                 ║
 * ║                                                                          ║
 * ║  LinkedIn names a saved page after its own chrome, and the browser turns ║
 * ║  the pipes into underscores: "Tech Leads 3 _ Lead Lists _ Sales          ║
 * ║  Navigator". Two thirds of that is the same on every file a user will    ║
 * ║  ever save, so it distinguishes nothing while filling the widest line on ║
 * ║  the row. A run identifies itself by WHERE it came from and WHAT it      ║
 * ║  produced.                                                               ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * The source is read, never guessed: `capture_session_id` is set by the
 * extension path and NULL for an upload (migration 0032). There is no third
 * state to fall back on.
 */
export function jobSource(job: DashboardJob): 'Browser' | 'HTML' {
  return job.capture_session_id ? 'Browser' : 'HTML'
}

export function jobLabel(job: DashboardJob) {
  /*
   * ⚠️ THE COUNT MUST NOT BE STATED AS FINAL WHILE THE RUN IS STILL GOING.
   * `jobYield` reads the KEPT totals, which are only written when the job
   * finishes — printing them mid-run would show "0 leads" for a run that is
   * working. An active run is named by its size instead.
   */
  if (isActiveJob(job)) {
    return `${jobSource(job)} · ${job.file_count.toLocaleString()} file${job.file_count === 1 ? '' : 's'}`
  }
  return `${jobSource(job)} · ${jobYield(job)}`
}
