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
import { deliverPendingWebhooks } from '@/lib/api/webhooks'
import { advanceRun, claimWaitingRuns } from '@/lib/flows/engine'
import { registerAllActions } from '@/lib/flows/actions'
import { reapExpiredClaims, runSendWorker } from '@/lib/email/send'
import { syncWorkspaceReplies } from '@/lib/email/reply-sync'
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
}

/** Runs one job, converting any throw into a recorded failure. */
async function runJob(
  result: TickResult,
  name: string,
  job: () => Promise<string>,
): Promise<void> {
  try {
    result.jobs[name] = { ok: true, detail: await job() }
  } catch (error) {
    /*
     * ⚠️ LOGGED WITHOUT THE PAYLOAD. A failing send must not put a recipient
     * address or message body in the logs (CLAUDE.md: never log full lead
     * records or file contents).
     */
    const detail = error instanceof Error ? error.message : 'failed'
    console.error(`[tick] ${name} failed`, { message: detail })
    result.jobs[name] = { ok: false, detail }
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
  })

  await runJob(result, 'send_email', async () => {
    /*
     * The worker id names the tick, so a stuck claim can be traced to the run
     * that took it. It must be unique per tick or two overlapping ticks would
     * look like one worker to the reaper.
     */
    const outcome = await runSendWorker(`tick-${began}`, LIMITS.emailsPerTick)
    return `${outcome.claimed} claimed, ${outcome.sent} sent, ${outcome.failed} failed, ${outcome.skipped} skipped`
  })

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
    let failures = 0

    for (const workspaceId of workspaces) {
      try {
        const outcome = await syncWorkspaceReplies(workspaceId)
        replies += outcome.replies
      } catch {
        // ⚠️ ONE BROKEN MAILBOX MUST NOT STOP THE REST. A wrong IMAP password
        // in one workspace would otherwise block replies for everyone.
        failures += 1
      }
    }

    return `${workspaces.length} workspace(s), ${replies} replies, ${failures} failed`
  })

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
  })

  await runJob(result, 'deliver_webhooks', async () => {
    const outcome = await deliverPendingWebhooks(LIMITS.webhooksPerTick)
    return `${outcome.delivered} delivered, ${outcome.retrying} retrying, ${outcome.exhausted} exhausted`
  })

  result.durationMs = Date.now() - began
  return result
}
