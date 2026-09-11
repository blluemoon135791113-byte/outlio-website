import 'server-only'

/**
 * The background tick — R10.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  NOTHING IN THIS PRODUCT HAD A TRIGGER.                                  ║
 * ║                                                                           ║
 * ║  The R0 audit found that EVERY background worker was written, tested and ║
 * ║  never invoked: no cron, no `after()`, no vercel.json. The consequences   ║
 * ║  were not subtle —                                                        ║
 * ║                                                                           ║
 * ║    • a launched campaign never sent a single email                        ║
 * ║    • replies were never fetched, so stop-on-reply could not fire and the  ║
 * ║      unified Inbox was permanently empty                                  ║
 * ║    • outbound webhooks never delivered                                    ║
 * ║    • a flow that hit a WAIT step never resumed                            ║
 * ║    • stale claims were never reaped, so a crashed worker's rows would sit ║
 * ║      claimed forever                                                      ║
 * ║                                                                           ║
 * ║  Every one of those has passing tests, because the tests call the worker  ║
 * ║  directly. Correctness was never the problem. Reachability was.           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ ONE FAILING JOB MUST NEVER STOP THE OTHERS. A workspace with a broken
 * mailbox would otherwise block webhook delivery and flow resumption for every
 * other customer on the same tick. Each step is isolated and its error is
 * recorded, not thrown.
 */
import { deliverPendingWebhooks, pruneDeliveryLog } from '@/lib/api/webhooks'
import { advanceRun, claimWaitingRuns } from '@/lib/flows/engine'
import { registerAllActions } from '@/lib/flows/actions'
import { reapExpiredClaims, runSendWorker } from '@/lib/email/send'
import { advanceSequences } from '@/lib/email/sequence-runner'
import { syncWorkspaceReplies } from '@/lib/email/reply-sync'
import { syncContactEvidenceToCrm } from '@/lib/crm/evidence-bridge'
import { rollupWorkspace } from '@/lib/crm/metrics'
import { claimAndProcessOne } from '@/lib/worker/process-job'
import { createAdminClient } from '@/lib/supabase/admin'

export type TickResult = {
  /** Per job: what it did, or why it could not. */
  jobs: Record<string, { ok: boolean; detail: string }>
  startedAt: string
  durationMs: number
}

/**
 * ⚠️ BOUNDED, BECAUSE A TICK RUNS INSIDE A REQUEST. Every job takes a limit,
 * and whatever is left is picked up by the next tick. An unbounded loop would
 * be killed mid-flight by the platform's function timeout, which is the exact
 * situation the claim-and-reap design exists to survive — but leaving work for
 * the next tick is cheaper than relying on that every time.
 */
const LIMITS = {
  emailsPerTick: 25,
  flowRunsPerTick: 20,
  webhooksPerTick: 20,
  /** Mailboxes to sync per tick, oldest sync first. */
  mailboxesPerTick: 10,
  /*
   * Workspaces whose research evidence is copied into the CRM per tick. Lower
   * than the others because each one is several batched queries, and this job
   * is catch-up work with no deadline — a workspace missed on one tick is
   * picked up on the next.
   */
  evidenceWorkspacesPerTick: 5,
  /*
   * Workspaces whose reporting aggregate is recomputed per tick. Each one is a
   * single `crm_rollup_activity_metrics` call covering a 7-day range, so this
   * is the most expensive per-workspace job here — but at a 5-minute tick,
   * five per tick still gives every workspace a turn 1,440 times a day.
   */
  reportingWorkspacesPerTick: 5,
}

/*
 * ⚠️ THE TICK RUNS INSIDE A 60-SECOND FUNCTION (`maxDuration` on the route).
 *
 * Measured on production before these existed: a quarter of scheduled runs
 * failed, and every one of them took 61-62 seconds while every success took
 * 6-13. They were not flaky, they were hitting the wall. One unreachable IMAP
 * host or one customer webhook endpoint that accepts a connection and never
 * answers is enough, because nothing here had a timeout.
 *
 * Being killed at the wall is the worst available outcome: every job ordered
 * AFTER the hung one is skipped with no record that it was skipped, and the
 * heartbeat row is never written either, so the tick leaves no trace at all.
 *
 * A budget turns that into an ordinary bad tick — the hung job is abandoned,
 * the rest still run, and the record says which one ate the time.
 */
export const TICK_BUDGET_MS = 45_000
/** No single job may take the whole budget, however stuck it is. */
export const JOB_BUDGET_MS = 20_000

/**
 * Runs one job, converting any throw into a recorded failure, and refusing to
 * let it overrun the tick's remaining budget.
 *
 * ⚠️ A TIMED-OUT JOB IS ABANDONED, NOT CANCELLED. Promises have no cancellation
 * — the underlying send or sync keeps running until its socket gives up. That
 * is safe here only because every one of these jobs is claim-based and
 * idempotent: the work it completes after we stop waiting is work that would
 * have been done anyway, and the claim stops the next tick redoing it.
 */
export async function runJob(
  result: TickResult,
  name: string,
  job: () => Promise<string>,
  /*
   * When the tick started. A parameter rather than a module-level clock so a
   * test can hand in a start time in the past and exercise an exhausted budget
   * in milliseconds instead of waiting 45 seconds for one.
   */
  began: number,
): Promise<void> {
  const remaining = TICK_BUDGET_MS - (Date.now() - began)
  if (remaining <= 0) {
    /*
     * Recorded, not silently dropped. "This job did not run because an earlier
     * one used the whole tick" is the single most useful line in the record
     * when somebody asks why replies stopped syncing.
     */
    result.jobs[name] = { ok: false, detail: 'skipped — tick budget exhausted' }
    return
  }

  const limit = Math.min(remaining, JOB_BUDGET_MS)
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    const detail = await Promise.race([
      job(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${Math.round(limit / 1000)}s`)),
          limit,
        )
      }),
    ])
    result.jobs[name] = { ok: true, detail }
  } catch (error) {
    /*
     * ⚠️ LOGGED WITHOUT THE PAYLOAD. A failing send must not put a recipient
     * address or message body in the logs (CLAUDE.md: never log full lead
     * records or file contents).
     */
    const detail = error instanceof Error ? error.message : 'failed'
    console.error(`[tick] ${name} failed`, { message: detail })
    result.jobs[name] = { ok: false, detail }
  } finally {
    // Otherwise a pending timer keeps the function alive after the tick is done.
    clearTimeout(timer)
  }
}

/**
 * Runs every due background job once.
 *
 * ⚠️ THE ORDER IS DELIBERATE. Reaping comes first so that rows abandoned by a
 * killed worker are claimable again on this same tick rather than the next
 * one; sending comes before reply sync so a reply to something we just sent is
 * not fetched before the send is recorded.
 */
export async function runTick(): Promise<TickResult> {
  const startedAt = new Date().toISOString()
  const began = Date.now()
  const result: TickResult = { jobs: {}, startedAt, durationMs: 0 }

  // Flow actions register onto a module-level map; a cold start has an empty
  // one, and a flow would fail with ACTION_NOT_AVAILABLE without this.
  registerAllActions()

  await runJob(result, 'reap_email_claims', async () => {
    const reaped = await reapExpiredClaims()
    return `${reaped} stale claim${reaped === 1 ? '' : 's'} released`
  }, began)

  /*
   * ⚠️ BEFORE `send_email`, DELIBERATELY. This enqueues the steps that are due;
   * running it after would leave every one of them waiting a full tick before
   * anything went out. Ordering the two jobs the other way round is a silent
   * one-tick delay on every sequence.
   *
   * That is 5 minutes today (pg_cron, migration 0118) and was a full DAY when
   * this comment was written against Vercel Hobby's one-cron-per-day limit.
   * The ordering matters either way; only the size of the mistake changed.
   */
  await runJob(result, 'advance_sequences', async () => {
    const outcome = await advanceSequences(LIMITS.emailsPerTick)
    return (
      `${outcome.due} due, ${outcome.queued} queued, ${outcome.completed} completed, ` +
      `${outcome.stopped} stopped, ${outcome.deferred} deferred, ` +
      `${outcome.unrenderable} unrenderable, ${outcome.failed} failed`
    )
  }, began)

  await runJob(result, 'send_email', async () => {
    /*
     * The worker id names the tick, so a stuck claim can be traced to the run
     * that took it. It must be unique per tick or two overlapping ticks would
     * look like one worker to the reaper.
     */
    const outcome = await runSendWorker(`tick-${began}`, LIMITS.emailsPerTick)
    return `${outcome.claimed} claimed, ${outcome.sent} sent, ${outcome.failed} failed, ${outcome.skipped} skipped`
  }, began)

  await runJob(result, 'sync_replies', async () => {
    const db = createAdminClient()

    /*
     * Only workspaces that actually have a mailbox capable of reading replies.
     * Syncing every workspace would spend the whole tick on accounts that
     * cannot receive anything — SMTP without an IMAP companion reports
     * `replies: unsupported`, and `syncMailbox` returns immediately for those.
     */
    const { data: accounts } = await db
      .from('email_accounts')
      .select('workspace_id, last_sync_at')
      .in('status', ['ready', 'ramping', 'warning'])
      .order('last_sync_at', { ascending: true, nullsFirst: true })
      .limit(LIMITS.mailboxesPerTick)

    const workspaces = [...new Set((accounts ?? []).map((a) => a.workspace_id))]
    let replies = 0
    let bounces = 0
    /*
     * ⚠️ REPORTED, BECAUSE IT IS THE NUMBER THAT SHOWS THE FIX WORKING.
     *
     * Before 2026-09-07 every message in the mailbox counted as a reply:
     * production held 254 `replied` events against two messages ever sent.
     * Mail from an address this workspace never emailed is now stored for the
     * inbox and otherwise ignored, and `unrelated` is how anyone sees that
     * happening. A counter nobody can read is the same defect as no counter.
     */
    let unrelated = 0
    let failures = 0

    for (const workspaceId of workspaces) {
      try {
        const outcome = await syncWorkspaceReplies(workspaceId)
        replies += outcome.replies
        bounces += outcome.bounces
        unrelated += outcome.unrelated
      } catch {
        // ⚠️ ONE BROKEN MAILBOX MUST NOT STOP THE REST. A wrong IMAP password
        // in one workspace would otherwise block replies for everyone.
        failures += 1
      }
    }

    return (
      `${workspaces.length} workspace(s), ${replies} replies, ${bounces} bounces, ` +
      `${unrelated} unrelated, ${failures} failed`
    )
  }, began)

  await runJob(result, 'advance_flows', async () => {
    /*
     * A flow that hit a WAIT step is parked with `resume_at`. Without this it
     * waits forever — which looks exactly like a flow that silently stopped.
     */
    const waiting = await claimWaitingRuns(LIMITS.flowRunsPerTick)
    let advanced = 0
    let failures = 0

    for (const run of waiting) {
      try {
        await advanceRun(run.workspaceId, run.id)
        advanced += 1
      } catch {
        failures += 1
      }
    }

    return `${advanced} run(s) advanced, ${failures} failed`
  }, began)

  await runJob(result, 'deliver_webhooks', async () => {
    const outcome = await deliverPendingWebhooks(LIMITS.webhooksPerTick)

    /*
     * ⚠️ PRUNED IN THE SAME JOB THAT CREATES THE ROWS, following `recordRun`'s
     * reasoning: this is the one place guaranteed to run whenever deliveries
     * exist, so it needs no schedule of its own. An indexed range delete that
     * usually removes nothing.
     *
     * After delivery, never before: pruning first would spend the tick's budget
     * on housekeeping while a consumer waits.
     */
    const pruned = await pruneDeliveryLog()

    return (
      `${outcome.delivered} delivered, ${outcome.retrying} retrying, ` +
      `${outcome.exhausted} exhausted, ${pruned} pruned`
    )
  }, began)

  /*
   * ⚠️ THE JOB THAT MAKES RESEARCH VISIBLE IN THE CRM.
   *
   * Measured on production before this existed: 111 `work_email` and
   * `mobile_phone` evidence rows, and ZERO rows in `crm_contact_emails`. The
   * enrichment had been working the whole time; nothing carried the result
   * across, so the contact list showed "No email" for people whose address we
   * already held and the marketing export produced an empty file.
   *
   * Runs LAST because it is the only job here that is pure catch-up: sending,
   * replies and flows are time-sensitive, and this can safely take whatever is
   * left of the tick.
   */
  await runJob(result, 'sync_contact_evidence', async () => {
    const db = createAdminClient()

    /*
     * Workspaces with contacts that CAME FROM an extraction — the only ones
     * that can have person evidence at all. Ordered by id so the rotation is
     * deterministic rather than dependent on planner whim.
     */
    const { data: candidates } = await db
      .from('crm_contacts')
      .select('workspace_id')
      .not('source_lead_id', 'is', null)
      .is('deleted_at', null)
      .order('workspace_id', { ascending: true })
      .limit(500)

    const workspaces = [...new Set((candidates ?? []).map((c) => c.workspace_id))].slice(
      0,
      LIMITS.evidenceWorkspacesPerTick,
    )

    let emails = 0
    let phones = 0
    let failures = 0

    for (const workspaceId of workspaces) {
      try {
        const outcome = await syncContactEvidenceToCrm(workspaceId)
        emails += outcome.emailsAdded
        phones += outcome.phonesAdded
      } catch {
        // One workspace's malformed evidence must not stop the others.
        failures += 1
      }
    }

    return `${workspaces.length} workspace(s), +${emails} emails, +${phones} phones, ${failures} failed`
  }, began)

  /*
   * ⚠️ THE BACKSTOP FOR AN ORPHANED EXTRACTION, which had no backstop at all.
   *
   * The primary path is targeted: `claimAndProcessJob` is nudged by `after()`
   * from the upload action, the extension ingest and the jobs page. That covers
   * the normal case and nothing covered the abnormal one — if the `after()`
   * callback never ran, or the function was killed before it claimed, the row
   * sat `queued` forever with nothing in the product looking for it. Retry and
   * reaping do not help: both only act on a job someone already claimed.
   *
   * `claimAndProcessOne` is the untargeted drain written for exactly this and
   * called from nowhere until now. One per tick, deliberately: this is a
   * safety net, not the road, and extraction is the most expensive work here.
   */
  await runJob(result, 'drain_extraction_queue', async () => {
    const outcome = await claimAndProcessOne(`tick-${began}`)
    if (!outcome) return 'queue empty'
    return `1 orphaned job ${outcome.status}, ${outcome.leadsKept} lead(s) kept`
  }, began)

  /*
   * ⚠️ THE REPORTING AGGREGATE HAD NO TRIGGER EITHER — the same defect this
   * file's header describes, in the one subsystem the R0 audit missed.
   *
   * `rollupWorkspace` is written, tested by `tests/integration/crm-metrics`,
   * and until now called from nowhere but that test. Nothing wrote
   * `crm_reporting_daily` in production, so `/crm/reports` read an empty table
   * and rendered a full screen of zeroes — and a zero there does not say "not
   * computed", it says "this setter did nothing all week". That is the same
   * failure shape as the credit balance that rendered `?? 0`: the most
   * discouraging possible reading of missing data, shown to the person being
   * measured by it.
   *
   * ⚠️ RUNS LAST, AFTER THE JOBS THAT CREATE ACTIVITIES. `send_email` writes
   * EMAIL_SENT and `sync_replies` writes replies; rolling up before them would
   * make every number exactly one tick stale, which is the ordering mistake
   * `advance_sequences` already documents above.
   */
  await runJob(result, 'rollup_reporting', async () => {
    const db = createAdminClient()

    /*
     * ⚠️ A ROTATION OVER ALL LIVE WORKSPACES, NOT "THE ONES WITH ACTIVITY".
     *
     * Selecting by recent activity is the obvious optimisation and it is unsafe
     * here: PostgREST cannot `select distinct`, so it would mean reading a
     * bounded page of `crm_activities` and de-duplicating in JS — and whichever
     * column that page is ordered by, one busy workspace can fill it and
     * starve everyone else indefinitely. Rolling up a quiet workspace is a
     * delete and an insert-select over an empty range, which is cheap enough
     * that fairness is worth more than skipping it.
     */
    const { data: live, error } = await db
      .from('workspaces')
      .select('id')
      .is('deleted_at', null)
      .limit(500)
    if (error) throw new Error(error.message)

    const candidates = (live ?? []).map((row) => row.id)
    if (candidates.length === 0) return 'no live workspaces'

    /*
     * Most recent run per workspace. Ordered newest-first so the first row seen
     * for an id is its latest run.
     */
    const { data: runs } = await db
      .from('crm_reporting_runs')
      .select('workspace_id, started_at')
      .in('workspace_id', candidates)
      .order('started_at', { ascending: false })

    const lastRun = new Map<string, string>()
    for (const run of runs ?? []) {
      if (!lastRun.has(run.workspace_id)) lastRun.set(run.workspace_id, run.started_at)
    }

    /*
     * Oldest first, and a workspace that has NEVER been rolled up sorts ahead
     * of every workspace that has — it is the one whose reports are blank.
     */
    const due = candidates
      .sort((a, b) => (lastRun.get(a) ?? '').localeCompare(lastRun.get(b) ?? ''))
      .slice(0, LIMITS.reportingWorkspacesPerTick)

    let rows = 0
    let failures = 0

    for (const workspaceId of due) {
      try {
        // The default 7-day lookback: an event can arrive late, and a rollup
        // that only recomputed today would leave yesterday permanently wrong.
        const outcome = await rollupWorkspace(workspaceId)
        rows += outcome.rowsWritten
      } catch {
        // One workspace's bad data must not stop the rotation.
        failures += 1
      }
    }

    return `${due.length} of ${candidates.length} workspace(s), ${rows} row(s) written, ${failures} failed`
  }, began)

  result.durationMs = Date.now() - began
  await recordRun(result)
  return result
}

/** Runs older than this are deleted; the table answers "recently", not "ever". */
const RUN_RETENTION_DAYS = 30

/**
 * Writes the heartbeat row — see `0117_worker_runs.sql` for why it exists.
 *
 * ⚠️ NEVER THROWS. A tick that sent mail and then failed to record itself did
 * still send the mail; turning that into a 500 would make the scheduler retry
 * the whole tick and re-do the work that already succeeded. The recording is
 * strictly less important than the thing it records.
 */
async function recordRun(result: TickResult): Promise<void> {
  try {
    const db = createAdminClient()

    const { error } = await db.from('worker_runs').insert({
      started_at: result.startedAt,
      duration_ms: result.durationMs,
      jobs: result.jobs,
      // The tick RAN; `ok` is about what happened inside it.
      ok: Object.values(result.jobs).every((job) => job.ok),
    })
    if (error) throw new Error(error.message)

    /*
     * Pruned here rather than on a schedule of its own, because this is the
     * one job guaranteed to run whenever rows are being created. An indexed
     * range delete that usually removes nothing.
     */
    const cutoff = new Date(Date.now() - RUN_RETENTION_DAYS * 86_400_000).toISOString()
    await db.from('worker_runs').delete().lt('started_at', cutoff)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failed'
    console.error('[tick] recording the run failed', { message })
  }
}
