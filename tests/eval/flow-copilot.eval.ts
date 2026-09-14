/**
 * The Flow Copilot, scored against a real model. §5.10's eval harness.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THIS SPENDS MONEY AND IS NOT IN `npm test`, ON PURPOSE.              ║
 * ║                                                                           ║
 * ║  `vitest.config.mts` explains at length why the unit project must stay     ║
 * ║  fast: a 25-minute check is one nobody runs, and a detection nobody runs   ║
 * ║  is worthless. An eval that calls a model forty times belongs nowhere      ║
 * ║  near that loop.                                                          ║
 * ║                                                                           ║
 * ║  Run it deliberately:  npm run eval:copilot                               ║
 * ║                                                                           ║
 * ║  The corpus itself is validated for free, offline, in the default loop by  ║
 * ║  `tests/unit/flow-copilot-corpus.test.ts` — so a stale case is caught      ║
 * ║  before anyone pays to discover it.                                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ IT MEASURES THE REAL PATH, INCLUDING METERING. `generateFlowDefinition`
 * runs inside `hubbleExecute`, so this also needs Supabase — every call writes
 * a `hubble_calls` row. Bypassing the door to make the eval simpler would
 * measure a code path the product does not have.
 */
import { describe, expect, it } from 'vitest'

import { generateFlowDefinition } from '@/lib/flows/copilot'
import { CORPUS, type EvalCase } from './flow-copilot-corpus'

const hasModel = Boolean(
  process.env.GEMINI_API_KEY ||
    process.env.GROQ_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.CEREBRAS_API_KEY ||
    process.env.BACKBOARD_API_KEY,
)
const hasSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
)

const WORKSPACE_ID = process.env.EVAL_WORKSPACE_ID ?? ''
const USER_ID = process.env.EVAL_USER_ID ?? ''

const MISSING = [
  !hasModel && 'a model key (GEMINI_API_KEY, or another vendor)',
  !hasSupabase && 'NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY',
  !WORKSPACE_ID && 'EVAL_WORKSPACE_ID',
  !USER_ID && 'EVAL_USER_ID',
].filter(Boolean) as string[]

const ready = MISSING.length === 0
/** Someone set SOME of it, so they meant to run this. */
const partiallyConfigured = !ready && MISSING.length < 4

const describeIf = ready ? describe : describe.skip

/*
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ A HALF-CONFIGURED EVAL THAT SILENTLY SKIPS IS THE REAL TRAP.         ║
 * ║                                                                           ║
 * ║  `console.log` does not help: vitest suppresses output from skipped files, ║
 * ║  so the first version of this printed its reason to nobody and the run     ║
 * ║  read as "41 skipped" with no explanation. Someone who set a model key but ║
 * ║  forgot EVAL_WORKSPACE_ID would conclude the copilot scored perfectly.     ║
 * ║                                                                           ║
 * ║  So: nothing configured is a silent skip, which is correct in CI and on a  ║
 * ║  fresh checkout. ANYTHING configured means intent, and a missing piece is  ║
 * ║  then a FAILURE that names it.                                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
describe('the eval is configured, or deliberately not', () => {
  it('names what is missing when someone has half-configured it', () => {
    expect(
      partiallyConfigured ? MISSING : [],
      'The copilot eval was partly configured and then skipped silently, which ' +
        'reads as a pass. Set the rest, or unset the others to skip deliberately.',
    ).toEqual([])
  })
})

type Score = { id: string; passed: boolean; detail: string }
const scores: Score[] = []

async function score(testCase: EvalCase): Promise<Score> {
  const result = await generateFlowDefinition({
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    description: testCase.prompt,
  })

  if (testCase.outcome === 'refusal') {
    /*
     * ⚠️ A REFUSAL MUST BE `unusable`, NOT `refused`. `refused` means the door
     * turned it away before a model ran — no credits, unpriced entry — which
     * would score a billing problem as model accuracy and quietly inflate the
     * number the moment the workspace ran out of credits.
     */
    if (result.ok) {
      return { id: testCase.id, passed: false, detail: 'built a flow for an impossible request' }
    }
    if (result.reason !== 'unusable') {
      return { id: testCase.id, passed: false, detail: `door refused (${result.reason}), model never ran` }
    }
    return { id: testCase.id, passed: true, detail: 'refused' }
  }

  if (!result.ok) {
    return { id: testCase.id, passed: false, detail: `no flow: ${result.message}` }
  }

  const definition = result.definition
  const actions = definition.steps.filter((s) => s.type === 'ACTION').map((s) => s.action)
  const problems: string[] = []

  if (definition.trigger.type !== testCase.trigger) {
    problems.push(`trigger ${definition.trigger.type}, wanted ${testCase.trigger}`)
  }
  for (const required of testCase.mustUse) {
    if (!actions.includes(required)) problems.push(`missing ${required}`)
  }
  for (const forbidden of testCase.mustNotUse ?? []) {
    if (actions.includes(forbidden)) problems.push(`did ${forbidden} unasked`)
  }
  if (testCase.needsBranch && !definition.steps.some((s) => s.type === 'BRANCH')) {
    problems.push('no branch')
  }
  if (testCase.needsWait && !definition.steps.some((s) => s.type === 'WAIT')) {
    problems.push('no wait')
  }

  return {
    id: testCase.id,
    passed: problems.length === 0,
    detail: problems.length === 0 ? `ok in ${result.attempts.length} attempt(s)` : problems.join('; '),
  }
}

describeIf('flow copilot, against a real model', () => {
  for (const testCase of CORPUS) {
    it(
      `${testCase.id}: ${testCase.outcome}`,
      async () => {
        const result = await score(testCase)
        scores.push(result)
        expect(result.passed, `${result.id} — ${result.detail}`).toBe(true)
      },
      120_000,
    )
  }

  it('reports the aggregate', () => {
    /*
     * ⚠️ REPORTED, NOT ASSERTED AGAINST A THRESHOLD. A pass rate baked in as
     * `expect(rate).toBeGreaterThan(0.8)` gets quietly lowered the first time
     * it fails, and then it measures nothing. The per-case assertions above are
     * the gate; this is the summary a person reads to decide whether the prompt
     * needs work or the corpus does.
     */
    const passed = scores.filter((s) => s.passed).length
    // eslint-disable-next-line no-console
    console.log(
      `\n[eval:copilot] ${passed}/${scores.length} passed\n` +
        scores
          .filter((s) => !s.passed)
          .map((s) => `  ✗ ${s.id} — ${s.detail}`)
          .join('\n'),
    )
    expect(scores.length).toBeGreaterThan(0)
  })
})
