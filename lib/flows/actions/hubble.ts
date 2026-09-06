import 'server-only'

/**
 * AI steps in flows — M7 Phase 22.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  M7 CRITERION 4: "credit-exhausted Hubble step fails gracefully;          ║
 * ║  DETERMINISTIC PATH CONTINUES PER CONFIG."                                ║
 * ║                                                                           ║
 * ║  Both halves matter, and they pull in opposite directions:                ║
 * ║                                                                           ║
 * ║   - "Fails gracefully" means running out of credits must not abort the    ║
 * ║     run. A flow that assigns an owner, creates a task and THEN scores the ║
 * ║     lead should still assign and create when the score cannot be bought.  ║
 * ║   - "Per config" means the author decides. Some flows genuinely should    ║
 * ║     stop: if the next branch reads the AI's answer, continuing without it ║
 * ║     sends every contact down the default path, silently.                  ║
 * ║                                                                           ║
 * ║  Hence `onNoCredits`, and hence its default. `continue` is the default    ║
 * ║  because the common case is enrichment — nice to have, not load-bearing — ║
 * ║  and because a customer who has run out of credits should not also lose   ║
 * ║  the deterministic automation they are still paying for.                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { hubbleExecute } from '@/lib/hubble/execute'
import type { HubbleTask } from '@/lib/hubble/pricing'
import { registerAction, type ActionHandler, type ActionResult } from '@/lib/flows/engine'
import type { ActionType } from '@/lib/flows/definition'
import { createAdminClient } from '@/lib/supabase/admin'

/** Which Hubble task each flow action performs. */
const TASK_FOR: Record<string, HubbleTask> = {
  HUBBLE_ICP_SCORE: 'icp_score',
  HUBBLE_RESEARCH: 'research',
  HUBBLE_CLASSIFY: 'classification',
  HUBBLE_PERSONALIZE: 'personalization',
  HUBBLE_REPLY_DRAFT: 'reply_draft',
  HUBBLE_CLASSIFY_REPLY: 'response_classification',
  HUBBLE_ACCOUNT_SUMMARY: 'account_summary',
}

/**
 * The work each task performs.
 *
 * ⚠️ WIRED TO `lib/hubble/` IN PHASE 22'S FOLLOW-UP, NOT FAKED HERE. Returning
 * an invented score would be exactly the fabrication CLAUDE.md rule 4
 * forbids — and a customer would be CHARGED for it. Until a runner is
 * registered, the action fails with a named reason and costs nothing, because
 * `hubbleExecute` refunds a failed call.
 */
const RUNNERS: Partial<Record<HubbleTask, (input: HubbleInput) => Promise<Record<string, unknown>>>> = {}

export type HubbleInput = {
  workspaceId: string
  contactId: string | null
  config: Record<string, unknown>
}

export function registerHubbleRunner(
  task: HubbleTask,
  runner: (input: HubbleInput) => Promise<Record<string, unknown>>,
): void {
  RUNNERS[task] = runner
}

function hubbleHandler(action: string): ActionHandler {
  return async (ctx, config): Promise<ActionResult> => {
    const task = TASK_FOR[action]
    if (!task) {
      return { ok: false, code: 'UNKNOWN_TASK', message: `${action} is not a Hubble task.`, retryable: false }
    }

    /*
     * ⚠️ THE SPENDING USER IS THE FLOW'S OWNER, NOT THE CONTACT'S. Credits are
     * user-scoped (Ledger KI11), and an unattended flow has no session — so the
     * step must carry whose allowance it draws on. Absent, it cannot charge
     * anyone and refuses rather than guessing.
     */
    const userId = typeof config.userId === 'string' ? config.userId : null
    if (!userId) {
      return {
        ok: false,
        code: 'NO_BILLING_USER',
        message: 'This AI step has nobody to bill. Set the flow owner.',
        retryable: false,
      }
    }

    const onNoCredits = config.onNoCredits === 'fail' ? 'fail' : 'continue'
    const runner = RUNNERS[task]

    const outcome = await hubbleExecute(
      task,
      { workspaceId: ctx.workspaceId, userId, source: 'flow', flowRunId: ctx.runId },
      async () => {
        if (!runner) {
          // Not stubbed: an unregistered task fails loudly and is refunded.
          throw new Error(`No runner is registered for the "${task}" task yet.`)
        }
        return runner({ workspaceId: ctx.workspaceId, contactId: ctx.contactId, config })
      },
    )

    if (outcome.ok) {
      // Persist the result where later steps and branches can read it.
      if (ctx.contactId && typeof config.storeAs === 'string') {
        await createAdminClient().from('crm_activities').insert({
          workspace_id: ctx.workspaceId,
          contact_id: ctx.contactId,
          activity_type: 'ENGAGEMENT',
          channel: 'system',
          metadata: { hubble_task: task, key: config.storeAs, run_id: ctx.runId },
        })
      }

      return {
        ok: true,
        output: { task, creditsSpent: outcome.creditsSpent, remaining: outcome.remaining },
        creditsUsed: outcome.creditsSpent,
      }
    }

    if (outcome.reason === 'no_credits') {
      /*
       * ⚠️ CRITERION 4. Out of credits, and the author said continue — so the
       * step is recorded as SUCCEEDED-WITHOUT-RESULT and the run carries on to
       * the deterministic steps the customer is still paying for.
       *
       * `skipped: true` is on the output so the log, and any later branch, can
       * tell "the AI said no" from "the AI was never asked".
       */
      if (onNoCredits === 'continue') {
        return {
          ok: true,
          output: { task, skipped: true, reason: 'no_credits', message: outcome.message },
          creditsUsed: 0,
        }
      }

      return { ok: false, code: 'NO_CREDITS', message: outcome.message, retryable: false }
    }

    return { ok: false, code: outcome.code, message: outcome.message, retryable: false }
  }
}

export function registerHubbleActions(): void {
  for (const action of Object.keys(TASK_FOR)) {
    registerAction(action as ActionType, hubbleHandler(action))
  }
}
