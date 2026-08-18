import { NextResponse, type NextRequest } from 'next/server'
import { after } from 'next/server'
import { z } from 'zod'

import { assertAccess } from '@/lib/auth/access'
import { consume } from '@/lib/auth/rate-limit'
import { LLM_VENDORS, resolveLlmProvider } from '@/lib/intelligence/llm/provider'
import { planQuery } from '@/lib/intelligence/planner'
import { researchScopeSchema } from '@/lib/intelligence/plan'
import { estimateScope } from '@/lib/intelligence/results'
import { claimAndProcessResearchRun, createResearchRun } from '@/lib/intelligence/run'
import { toClientError } from '@/lib/errors/catalog'
import { ACTION_LIMITS } from '@/lib/security/action-limits'

/**
 * Ask Outlio a question (spec §39, §40).
 *
 * The pipeline: plan the question → create a run → hand it to the queue. The
 * response returns immediately with a run id; the browser polls
 * `/api/intelligence/runs/[id]` for progress. Research over hundreds of
 * companies takes minutes and must survive the tab closing.
 */
export const maxDuration = 300

const inputSchema = z.object({
  query: z.string().trim().min(3).max(2000),
  scope: researchScopeSchema,
  qualificationProfileId: z.string().uuid().nullable().optional(),
  /**
   * Ask for the cost picture without starting anything. This is what makes the
   * "this will evaluate X leads / Y companies" confirmation possible (spec §31).
   */
  estimateOnly: z.boolean().optional(),
  /*
   * Which model plans the question.
   *
   * ⚠️ VALIDATED AGAINST THE VENDOR LIST, not passed through. This selects a
   * code path that holds an API key; an unchecked string here would be a
   * request from the browser deciding which credential the server reaches for.
   */
  model: z.enum(LLM_VENDORS).optional(),
})

export async function POST(request: NextRequest) {
  let userId: string
  try {
    const ctx = await assertAccess()
    userId = ctx.userId!
  } catch (error) {
    // `toClientError` already returns the full client-safe envelope; wrapping it
    // again would nest `error` inside `error` and break every caller.
    const safe = toClientError(error)
    return NextResponse.json(safe.body, { status: safe.status })
  }

  const limit = await consume(ACTION_LIMITS.research, `user:${userId}`)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: { code: 'ERR_RATE_LIMITED', message: 'Too many research requests. Please wait.' } },
      { status: 429 },
    )
  }

  const parsed = inputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'ERR_VALIDATION', message: 'Enter a question and choose what to search.' } },
      { status: 400 },
    )
  }

  const { query, scope, qualificationProfileId, estimateOnly, model } = parsed.data
  const estimate = await estimateScope(userId, scope)

  // Nothing is planned or spent for an estimate.
  if (estimateOnly) {
    return NextResponse.json({ status: 'estimate', ...estimate })
  }

  if (estimate.leadCount === 0) {
    return NextResponse.json(
      { error: { code: 'ERR_NOT_FOUND', message: 'There are no leads in that selection.' } },
      { status: 404 },
    )
  }

  const planned = await planQuery({
    question: query,
    // Falls back to the configured order when the client names nothing, so a
    // stale tab that predates the picker still works.
    llm: model ? resolveLlmProvider(model) : undefined,
  })

  if (planned.status === 'refused') {
    return NextResponse.json({ status: 'refused', reason: planned.reason }, { status: 422 })
  }

  if (planned.status === 'failed') {
    return NextResponse.json(
      { error: { code: 'ERR_RESEARCH_FAILED', message: planned.reason } },
      { status: 503 },
    )
  }

  const created = await createResearchRun(userId, {
    queryText: query,
    scope,
    plan: planned.plan,
    qualificationProfileId: qualificationProfileId ?? null,
  })

  if (!created.ok) {
    return NextResponse.json(
      { error: { code: 'ERR_RESEARCH_FAILED', message: 'That question could not be planned.' } },
      { status: 500 },
    )
  }

  if (created.status === 'waiting_for_clarification') {
    // Nothing is queued and nothing is charged until the user answers.
    return NextResponse.json({
      status: 'clarification_required',
      researchRunId: created.runId,
      questions: created.questions,
      ...estimate,
    })
  }

  // `after()` runs the work once the response is on its way, so the browser
  // never waits on provider latency. The queue row already exists, so a
  // function timeout here is recovered by the reaper rather than lost.
  after(async () => {
    try {
      await claimAndProcessResearchRun(created.runId, userId, 'vercel-after')
    } catch {
      // Failure is recorded on the run itself; the reaper handles retries.
    }
  })

  return NextResponse.json({
    status: 'running',
    researchRunId: created.runId,
    leadCount: estimate.leadCount,
    uniqueCompanyCount: estimate.companyCount,
  })
}
