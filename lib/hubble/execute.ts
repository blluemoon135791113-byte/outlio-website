import 'server-only'

/**
 * The single AI boundary — M7 Phase 22, made the guarded entry point in Phase 12.
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
 * ║                                                                           ║
 * ║  ⚠️ IT FAILS CLOSED (build contract §5.11). Three refusals happen before  ║
 * ║  anything is spent or run: a capability the registry does not list as AI,║
 * ║  a capability the registry lists without a price, and a call with no      ║
 * ║  credit context. Each is recorded so a silence can be explained.          ║
 * ║                                                                           ║
 * ║  ⚠️ THE MODEL IS HANDED TO THE RUNNER, NOT FETCHED BY IT. This module is  ║
 * ║  the only non-provider file allowed to import a provider — enforced by    ║
 * ║  `tests/unit/model-call-boundary.test.ts` — so the only way for product   ║
 * ║  code to reach a model is from inside a metered runner.                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { CAPABILITIES, isCapabilityId, type AiCapabilityId } from '@/lib/capabilities/registry'
import { createHubbleLlm } from '@/lib/hubble/providers/ollama-llm'
import type { LLMProvider } from '@/lib/intelligence/llm/provider'

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

/** What a metered runner may use. Constructed lazily; a runner that never asks pays nothing. */
export type HubbleTools = {
  /** The model Hubble reasons with. Only reachable from inside a metered call. */
  readonly llm: LLMProvider
}

/** The work itself. Receives the tools and nothing else. */
export type HubbleRunner<T> = (tools: HubbleTools) => Promise<T>

/**
 * Runs one AI capability, metered.
 *
 * @param runner the actual model call. Kept as a callback so this function
 *   owns the credit lifecycle and the caller owns only the work — which is
 *   what stops the two drifting apart.
 */
export async function hubbleExecute<T>(
  capability: AiCapabilityId,
  context: HubbleContext,
  runner: HubbleRunner<T>,
): Promise<HubbleOutcome<T>> {
  const db = createAdminClient()
  const startedAt = Date.now()

  /*
   * ⚠️ RESOLVED AT RUNTIME, NOT TRUSTED FROM THE TYPE. The id may have arrived
   * from a stored flow definition, and a definition compiled against a later
   * registry can name something this build does not know.
   */
  const entry = isCapabilityId(capability) ? CAPABILITIES[capability] : null
  const quoted = entry?.isAi && entry.credits !== null ? entry.credits : 0

  const record = async (
    outcome: 'ok' | 'refused_no_credits' | 'failed',
    spent: number,
    error?: { code: string; message: string },
  ) => {
    await db.from('hubble_calls').insert({
      // A refused call may have no attributable tenant; `null` is the truth there.
      workspace_id: context?.workspaceId || null,
      user_id: context?.userId || null,
      task: capability,
      outcome,
      credits_quoted: quoted,
      credits_spent: spent,
      source: context?.source ?? null,
      flow_run_id: context?.flowRunId ?? null,
      duration_ms: Date.now() - startedAt,
      error_code: error?.code ?? null,
      // Never a model response or a customer's data — just the failure.
      error_message: error?.message ?? null,
    })
  }

  const refuse = async (code: string, message: string): Promise<HubbleOutcome<T>> => {
    await record('failed', 0, { code, message })
    return { ok: false, reason: 'failed', code, message }
  }

  // --- 0. REFUSE, before anything is spent or run. ---
  if (!entry || !entry.isAi) {
    return refuse(
      'NOT_AN_AI_CAPABILITY',
      `"${capability}" is not an AI capability in the registry, so nothing may call a model for it.`,
    )
  }

  if (entry.credits === null) {
    return refuse(
      'UNPRICED_CAPABILITY',
      `"${capability}" has no price yet (${entry.pricingDecision}). It cannot run until one is decided.`,
    )
  }

  if (!context || typeof context.userId !== 'string' || context.userId === '' ||
      typeof context.workspaceId !== 'string' || context.workspaceId === '') {
    return refuse('NO_CREDIT_CONTEXT', 'This AI call has nobody to bill, so it was not made.')
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
    let llm: LLMProvider | null = null
    const tools: HubbleTools = {
      get llm() {
        llm ??= createHubbleLlm()
        return llm
      },
    }
    const result = await runner(tools)
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
          capability,
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
