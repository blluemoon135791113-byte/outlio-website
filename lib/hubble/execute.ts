import 'server-only'

/**
 * The single AI boundary — M7 Phase 22.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  EVERY AI CALL IN THE PRODUCT GOES THROUGH `hubbleExecute`. NO EXCEPTIONS.║
 * ║                                                                           ║
 * ║  The constitution's rule is "never scatter LLM calls", and the reason is  ║
 * ║  not tidiness. Credits are the customer's money. A model call made        ║
 * ║  outside this function is a charge nobody metered, a cost nobody can      ║
 * ║  attribute, and a step that keeps working after a customer's plan runs    ║
 * ║  out. One boundary means one place that can be audited, capped and        ║
 * ║  turned off.                                                              ║
 * ║                                                                           ║
 * ║  ⚠️ THE ORDER IS: QUOTE → SPEND → RUN → RECORD.                          ║
 * ║                                                                           ║
 * ║  Credits are spent BEFORE the model runs, and refunded if it fails. The   ║
 * ║  alternative — run first, charge after — means a crash mid-call gives     ║
 * ║  away work for free, and a customer at their limit can exceed it by       ║
 * ║  however many calls are in flight.                                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { createAdminClient } from '@/lib/supabase/admin'
// Pricing is pure and lives apart, so a quote can be rendered in the flow
// editor without a database round trip.
import { quoteCredits, type HubbleTask } from '@/lib/hubble/pricing'

export { HUBBLE_TASKS, quoteCredits, quoteFlow, type HubbleTask } from '@/lib/hubble/pricing'

export type HubbleContext = {
  workspaceId: string
  /** Whose allowance is spent. Credits are user-scoped (see Ledger KI11). */
  userId: string
  /** Where the call came from, for the audit trail. */
  source?: string
  flowRunId?: string | null
}

export type HubbleOutcome<T> =
  | { ok: true; result: T; creditsSpent: number; remaining: number | null }
  /**
   * ⚠️ ITS OWN OUTCOME, NOT AN ERROR. M7 criterion 4 requires a
   * credit-exhausted step to fail GRACEFULLY and let the deterministic path
   * continue. A thrown exception would abort the whole flow, which is exactly
   * the ungraceful failure the criterion rules out.
   */
  | { ok: false; reason: 'no_credits'; message: string; remaining: number }
  | { ok: false; reason: 'failed'; code: string; message: string }

/** The work itself. Receives nothing but its own input. */
export type HubbleRunner<T> = () => Promise<T>

/**
 * Runs one AI task, metered.
 *
 * @param runner the actual model call. Kept as a callback so this function
 *   owns the credit lifecycle and the caller owns only the work — which is
 *   what stops the two drifting apart.
 */
export async function hubbleExecute<T>(
  task: HubbleTask,
  context: HubbleContext,
  runner: HubbleRunner<T>,
): Promise<HubbleOutcome<T>> {
  const db = createAdminClient()
  const quoted = quoteCredits(task)
  const startedAt = Date.now()

  const record = async (
    outcome: 'ok' | 'refused_no_credits' | 'failed',
    spent: number,
    error?: { code: string; message: string },
  ) => {
    await db.from('hubble_calls').insert({
      workspace_id: context.workspaceId,
      user_id: context.userId,
      task,
      outcome,
      credits_quoted: quoted,
      credits_spent: spent,
      source: context.source ?? null,
      flow_run_id: context.flowRunId ?? null,
      duration_ms: Date.now() - startedAt,
      error_code: error?.code ?? null,
      // Never a model response or a customer's data — just the failure.
      error_message: error?.message ?? null,
    })
  }

  // --- 1. SPEND, before the model runs. ---
  const { data: spend, error: spendError } = await db.rpc('hubble_spend_credits', {
    p_user_id: context.userId,
    p_amount: quoted,
  })

  if (spendError) {
    await record('failed', 0, { code: 'CREDIT_CHECK_FAILED', message: spendError.message })
    return {
      ok: false,
      reason: 'failed',
      code: 'CREDIT_CHECK_FAILED',
      message: 'Could not check your credit balance.',
    }
  }

  const outcome = spend?.[0]

  if (!outcome || outcome.outcome === 'exhausted') {
    await record('refused_no_credits', 0)
    return {
      ok: false,
      reason: 'no_credits',
      remaining: outcome?.remaining ?? 0,
      message: `This step needs ${quoted} credit${quoted === 1 ? '' : 's'} and your plan has none left this month. The rest of the flow will continue.`,
    }
  }

  const unlimited = outcome.outcome === 'unlimited'
  const spent = unlimited ? 0 : quoted

  // --- 2. RUN. ---
  try {
    const result = await runner()
    await record('ok', spent)
    return { ok: true, result, creditsSpent: spent, remaining: outcome.remaining ?? null }
  } catch (error) {
    /*
     * ⚠️ REFUNDED. The customer paid for an answer and did not get one.
     * Charging for a failed call is the kind of small dishonesty that erodes
     * trust in every number the product shows.
     */
    if (spent > 0) {
      const { error: refundError } = await db.rpc('hubble_refund_credits', {
        p_user_id: context.userId,
        p_amount: spent,
      })

      if (refundError) {
        // A refund that fails must be LOUD: the customer has been charged for
        // nothing, and only this line will ever say so.
        console.error('[hubble] REFUND FAILED — customer charged for a failed call', {
          userId: context.userId,
          task,
          credits: spent,
          message: refundError.message,
        })
      }
    }

    const message = error instanceof Error ? error.message : 'The AI step failed.'
    await record('failed', 0, { code: 'RUNNER_FAILED', message })

    return { ok: false, reason: 'failed', code: 'RUNNER_FAILED', message }
  }
}

/**
 * How many credits are left, without spending any.
 *
 * ⚠️ `p_amount: 0` IS A QUESTION, NOT A SPEND. The SQL treats it as a read and
 * creates no usage row, so asking the balance never costs anything.
 */
export async function creditsRemaining(userId: string): Promise<{
  unlimited: boolean
  remaining: number | null
  allowance: number | null
}> {
  const { data } = await createAdminClient().rpc('hubble_spend_credits', {
    p_user_id: userId,
    p_amount: 0,
  })

  const row = data?.[0]
  if (!row || row.outcome === 'unlimited') {
    return { unlimited: true, remaining: null, allowance: null }
  }
  return { unlimited: false, remaining: row.remaining ?? 0, allowance: row.allowance ?? 0 }
}
