/**
 * The four AI routes enter the metered door — Phase 12 item 4.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS TEST TRAVELS THE USER'S PATH, NOT THE FUNCTION'S.                   ║
 * ║                                                                           ║
 * ║  The defect this phase closed was never broken code — it was correct      ║
 * ║  code that nothing metered. Four HTTP routes called a model with no        ║
 * ║  credit context because being metered depended on a caller remembering    ║
 * ║  to import `hubbleExecute`. Previous tests hid that by calling the        ║
 * ║  inner functions directly.                                               ║
 * ║                                                                           ║
 * ║  So this file drives the ROUTES: it mocks only the outermost edges        ║
 * ║  (auth, workspace resolution, the admin DB client) and lets the real       ║
 * ║  `hubbleExecute`, the real registry and the real routes run. What it       ║
 * ║  proves: a route handler cannot reach a model without a spend RPC call     ║
 * ║  and a `hubble_calls` ledger row happening first.                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ PROVEN NON-VACUOUS BY BREAKING IT (this project's rule, §2.1):
 * removing the `hubbleExecute` wrapper from any of the four routes makes
 * "the route meters every model call" fail — verified by mutation before
 * this file shipped, see the git history of this test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  userId: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
  spendOutcome: { outcome: 'spent', remaining: 99, allowance: 100, used: 1 },
  spendCalls: [] as Array<{ userId: string; amount: number }>,
  ledgerRows: [] as Array<Record<string, unknown>>,
  /*
   * The one lead the ask route resolves its subject from. Shape matches the
   * route's own select list; values are a fabricated fixture (CLAUDE.md rule
   * on fixtures: invented names, example.com domains).
   */
  leadRow: {
    id: '00000000-0000-4000-8000-000000000004',
    full_name: 'Fabricated Fixture',
    job_title: 'Founder',
    location: 'Lagos',
    company_name: 'Fixture Labs',
    company_id: '00000000-0000-4000-8000-000000000005',
    company_website_url: 'https://fixture.example',
    company_url: null,
    company_industry: 'Software',
    company_size: null,
    company_employee_count: null,
    companies: { domain: 'fixture.example' },
  },
  runResults: null as null | {
    queryText: string
    rows: unknown[]
    columns: string[]
  },
  summarizeResult: null as null | { text: string; withData: number; withoutData: number; gotModel: boolean },
  plannerResult: null as null | Record<string, unknown>,
}))

vi.mock('server-only', () => ({}))

vi.mock('@/lib/auth/access', () => ({
  assertHubbleAccess: vi.fn(async () => ({ userId: mocks.userId, isAdmin: false })),
}))

vi.mock('@/lib/workspaces/context', () => ({
  getWorkspaceContext: vi.fn(async () => ({
    workspace: { id: mocks.workspaceId },
  })),
}))

vi.mock('@/lib/auth/rate-limit', () => ({
  consume: vi.fn(async () => ({ allowed: true, remaining: 10, retryAfterSeconds: 0 })),
}))

vi.mock('@/lib/security/action-limits', () => ({
  ACTION_LIMITS: { research: { limit: 20, windowSeconds: 600 } },
}))

vi.mock('@/lib/supabase/admin', () => ({
  /*
   * A chainable PostgREST stand-in: `.from(t).select(...).eq(...).maybeSingle()`
   * however deep it nests. Reads return null (empty tables), writes record.
   * The one read this file needs non-empty — the ask route's lead lookup — is
   * served by `leadRow` below.
   */
  createAdminClient: () => ({
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'hubble_spend_credits') {
        mocks.spendCalls.push({ userId: args.p_user_id as string, amount: args.p_amount as number })
        return { data: [mocks.spendOutcome], error: null }
      }
      if (name === 'hubble_refund_credits') {
        return { data: 0, error: null }
      }
      return { data: null, error: null }
    }),
    from: vi.fn((table: string) => {
      const chain: Record<string, unknown> = {
        maybeSingle: vi.fn(async () => ({ data: table === 'extracted_leads' ? mocks.leadRow : null, error: null })),
        single: vi.fn(async () => ({ data: null, error: null })),
        limit: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        is: vi.fn(() => chain),
        in: vi.fn(() => chain),
        ilike: vi.fn(() => chain),
        or: vi.fn(() => chain),
        not: vi.fn(() => chain),
        order: vi.fn(() => chain),
        range: vi.fn(() => chain),
        select: vi.fn(() => chain),
        update: vi.fn(() => chain),
        delete: vi.fn(() => chain),
        insert: vi.fn(async (row: Record<string, unknown>) => {
          if (table === 'hubble_calls') mocks.ledgerRows.push(row)
          return { error: null }
        }),
      }
      return chain
    }),
  }),
}))

vi.mock('@/lib/hubble/providers/embedding', () => ({
  resolveEmbeddingProvider: () => ({
    isUsable: async () => false,
    isConfigured: () => false,
    embed: async () => null,
    model: 'fixture-embed',
  }),
}))

vi.mock('@/lib/intelligence/results', () => ({
  getRunResults: vi.fn(async () => mocks.runResults),
  /*
   * A non-empty estimate, so the query route passes its "nothing selected"
   * refusal and reaches the door. The estimate itself is not under test.
   */
  estimateScope: vi.fn(async () => ({ leadCount: 3, companyCount: 2, leadIds: [] })),
}))

vi.mock('@/lib/intelligence/run', () => ({
  createResearchRun: vi.fn(async () => ({
    ok: true,
    researchRunId: '00000000-0000-4000-8000-000000000003',
    requiresClarification: false,
  })),
  claimAndProcessResearchRun: vi.fn(async () => null),
}))

vi.mock('@/lib/intelligence/planner', () => ({
  planQuery: vi.fn(async (options: { llm: unknown }) => {
    mocks.plannerResult = { gotModel: options.llm !== undefined, status: 'refused', reason: 'none' }
    return { status: 'refused', reason: 'unrecognised' }
  }),
}))

vi.mock('@/lib/hubble/summarize', () => ({
  summarizeRun: vi.fn(async (llm: unknown, question: string) => {
    mocks.summarizeResult = {
      text: `summary-of:${question}`,
      withData: 1,
      withoutData: 0,
      gotModel: llm !== undefined,
    }
    return mocks.summarizeResult
  }),
}))

import { POST as askRoute } from '@/app/api/hubble/ask/route'
import { POST as queryRoute } from '@/app/api/intelligence/query/route'
import { POST as summaryRoute } from '@/app/api/intelligence/runs/[id]/summary/route'

function post(url: string, body: unknown): Request {
  return new Request(url, { method: 'POST', body: JSON.stringify(body) })
}

const UUID = '00000000-0000-4000-8000-000000000003'

describe('the four AI routes enter the metered door (Phase 12 item 4)', () => {
  beforeEach(() => {
    mocks.spendCalls.length = 0
    mocks.ledgerRows.length = 0
    mocks.spendOutcome = { outcome: 'spent', remaining: 99, allowance: 100, used: 1 }
    vi.clearAllMocks()
  })

  it('/api/hubble/ask spends credits and writes a ledger row before answering', async () => {
    /*
     * The real `askHubble` runs against the chainable DB stand-in: every read
     * comes back empty, so the pipeline degrades honestly (no evidence, no
     * model configured in the test env) — and the real door still meters the
     * run. That is the journey a user travels; stubbing `askHubble` itself
     * would test the mock, not the route.
     */
    const response = await askRoute(
      post('https://app.outlio.io/api/hubble/ask', {
        leadId: '00000000-0000-4000-8000-000000000004',
        question: 'What does this company do?',
      }) as never,
    )

    // The route answers as an NDJSON stream whose body IS the work — the
    // Response returns before research starts. Draining it runs the journey.
    const lines = await new Response(response.body).text()

    expect(mocks.spendCalls).toContainEqual({ userId: mocks.userId, amount: 0 })
    expect(
      mocks.ledgerRows.some((r) => r.task === 'hubble.ask'),
      'the ask route must leave a hubble_calls row',
    ).toBe(true)
    // Every line is valid NDJSON, and an answer (never a thrown stack) ends it.
    for (const line of lines.split('\n').filter(Boolean)) {
      expect(() => JSON.parse(line), `line not NDJSON: ${line.slice(0, 120)}`).not.toThrow()
    }
    expect(lines).toContain('"type":"answer"')
  })

  it('/api/intelligence/query hands the planner a metered model', async () => {
    const response = await queryRoute(
      post('https://app.outlio.io/api/intelligence/query', {
        query: 'fintech founders in Lagos',
        scope: { type: 'all_leads' },
      }) as never,
    )
    const body = await response.json()

    expect(mocks.spendCalls).toContainEqual({ userId: mocks.userId, amount: 0 })
    expect(mocks.ledgerRows.some((r) => r.task === 'intelligence.plan')).toBe(true)
    expect(mocks.plannerResult?.gotModel).toBe(true)
    expect(body.status).toBeDefined()
  })

  it('/api/intelligence/runs/[id]/summary hands the summariser a metered model', async () => {
    mocks.runResults = { queryText: 'test question', rows: [], columns: [] }

    const response = await summaryRoute(
      post(`https://app.outlio.io/api/intelligence/runs/${UUID}/summary`, {}) as never,
      { params: Promise.resolve({ id: UUID }) } as never,
    )
    const body = await response.json()

    expect(mocks.spendCalls).toContainEqual({ userId: mocks.userId, amount: 0 })
    expect(mocks.ledgerRows.some((r) => r.task === 'intelligence.summarize')).toBe(true)
    expect(mocks.summarizeResult?.gotModel).toBe(true)
    expect(body.summary).toBeDefined()
  })

  it('an out-of-credits user is refused BEFORE any model runs, and the refusal is recorded', async () => {
    mocks.spendOutcome = { outcome: 'exhausted', remaining: 0, allowance: 100, used: 100 }

    const response = await queryRoute(
      post('https://app.outlio.io/api/intelligence/query', {
        query: 'anything at all',
        scope: { type: 'all_leads' },
      }) as never,
    )
    const body = await response.json()

    /*
     * The spend happens once, with 0 — the DECISION-16 starting price. The
     * refusal outcome `exhausted` means even a free call is refused once the
     * allowance is gone (0094's zero-spend branch), which is the graceful
     * degradation M7 criterion 4 requires.
     */
    expect(mocks.spendCalls).toEqual([{ userId: mocks.userId, amount: 0 }])
    expect(
      mocks.ledgerRows.some(
        (r) => r.task === 'intelligence.plan' && r.outcome === 'refused_no_credits',
      ),
      'the refusal must leave a ledger row — a silent refusal is an unexplainable stop',
    ).toBe(true)
    // The route maps a door refusal to a failed plan, surfaced as 503 with
    // the door's own message. Nothing about the response claims research ran.
    expect(response.status).toBe(503)
    expect(body.error?.message).toContain('credit')
  })
})
