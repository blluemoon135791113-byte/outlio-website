/**
 * Automatic post-extraction enrichment as a chain of batches.
 *
 * Pinned: every lead is reached (no 60-lead ceiling); batches of one upload
 * run strictly in order, each merged and its CSV rebuilt BEFORE the next is
 * queued; a deadline leaves work queued rather than starting a batch that
 * cannot finish; a batch that fails for good does not strand the rest; a
 * chain is never queued twice; paid providers switch the pass off; and the
 * pre-batching single runs are re-planned instead of processed whole.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Run = {
  id: string
  user_id: string
  status: string
  scope: Record<string, unknown>
  query_text: string
  idempotency_key: string
  created_at?: string
}

const USER = '00000000-0000-4000-8000-0000000000aa'
const JOB = '00000000-0000-4000-8000-0000000000bb'

let runs: Run[] = []
let jobLeads: string[] = []
let jobKind = 'lead_search'
let events: string[] = []
let failingRuns = new Set<string>()
let paid = false
let usageFails = false
const deferredUntil = new Map<string, number>()
let nextId = 0

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

vi.mock('server-only', () => ({}))

vi.mock('@/lib/intelligence/providers', () => ({ paidProvidersEnabled: () => paid }))

vi.mock('@/lib/intelligence/merge-store', () => ({
  mergeRunIntoLeads: async (_user: string, runId: string) => {
    events.push(`merge:${runId}`)
    return { ok: true, leadsUpdated: 1 }
  },
}))

vi.mock('@/lib/worker/rebuild-export', () => ({
  rebuildJobExport: async () => {
    events.push('rebuild:leads')
    return true
  },
}))

vi.mock('@/lib/worker/rebuild-account-export', () => ({
  rebuildAccountListExport: async () => {
    events.push('rebuild:accounts')
    return true
  },
}))

vi.mock('@/lib/intelligence/run', () => {
  const key = (input: { queryText: string; scope: unknown; plan: unknown }) =>
    JSON.stringify([input.queryText, input.scope, input.plan])
  return {
    researchIdempotencyKey: key,
    createResearchRun: async (
      userId: string,
      input: { queryText: string; scope: Record<string, unknown>; plan: unknown },
    ) => {
      const { validatePlan } = await import('@/lib/intelligence/plan')
      const validated = validatePlan(input.plan)
      if (!validated.ok) return { ok: false, reason: validated.reason }
      nextId += 1
      const run: Run = {
        id: uuid(1000 + nextId),
        user_id: userId,
        status: 'pending',
        scope: input.scope,
        query_text: input.queryText,
        idempotency_key: key({ ...input, plan: validated.plan }),
      }
      runs.push(run)
      events.push(`queue:${run.id}`)
      return { ok: true, runId: run.id, status: 'queued' }
    },
    processClaimedResearchRun: async (runId: string) => {
      const run = runs.find((r) => r.id === runId)!
      events.push(`process:${runId}`)
      if (failingRuns.has(runId)) {
        run.status = 'failed'
        throw new Error('provider outage')
      }
      run.status = 'partially_complete'
      return { runId, status: 'partially_complete', evidenceWritten: 2 }
    },
    cancelClaimedResearchRun: async (runId: string) => {
      runs.find((r) => r.id === runId)!.status = 'cancelled'
      events.push(`cancel:${runId}`)
    },
    deferClaimedResearchRun: async (runId: string, _user: string, until: Date) => {
      runs.find((r) => r.id === runId)!.status = 'pending'
      deferredUntil.set(runId, until.getTime())
      events.push(`defer:${runId}:${until.toISOString().slice(0, 10)}`)
    },
    claimNextResearchRun: async () => {
      const run = runs.find((r) => r.status === 'pending')
      if (!run) return null
      run.status = 'running'
      return { runId: run.id, userId: run.user_id }
    },
    reapStaleResearchRuns: async () => 0,
  }
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === 'claim_research_run') {
        const run = runs.find((r) => r.id === args.p_run_id && r.user_id === args.p_user_id)
        if (!run || run.status !== 'pending') return { data: [], error: null }
        run.status = 'running'
        return { data: [{ research_run_id: run.id, user_id: run.user_id, attempts: 1 }], error: null }
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } }
    },
    from: (table: string) => {
      const filters: Record<string, unknown> = {}
      let range: [number, number] | null = null
      const resolveMany = () => {
        if (table === 'extracted_leads') {
          expect(filters.user_id).toBe(USER)
          const [from, to] = range!
          return { data: jobLeads.slice(from, to + 1).map((id) => ({ id })), error: null }
        }
        if (table === 'research_runs' && filters.status === undefined) {
          // The monthly usage read: batches already researched, by size.
          if (usageFails) return { data: null, error: { message: 'down' } }
          return {
            data: runs
              .filter((r) => r.status === 'partially_complete')
              .map((r) => ({ lead_count: ((r.scope.leadIds as string[] | undefined) ?? []).length, company_count: ((r.scope.companyIds as string[] | undefined) ?? []).length })),
            error: null,
          }
        }
        if (table === 'research_runs') {
          return { data: runs.filter((r) => r.status === filters.status), error: null }
        }
        return { data: [], error: null }
      }
      const chain: Record<string, unknown> = {}
      Object.assign(chain, {
        select: () => chain,
        order: () => chain,
        limit: () => chain,
        like: () => chain,
        gte: () => chain,
        eq: (column: string, value: unknown) => {
          filters[column] = value
          return chain
        },
        range: (from: number, to: number) => {
          range = [from, to]
          return chain
        },
        maybeSingle: async () => {
          if (table === 'extraction_jobs') return { data: { kind: jobKind }, error: null }
          if (table !== 'research_runs') return { data: null, error: null }
          const run = runs.find((r) =>
            Object.entries(filters).every(([column, value]) => r[column as keyof Run] === value),
          )
          return { data: run ?? null, error: null }
        },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolveMany()).then(resolve),
      })
      return chain
    },
  }),
}))

const { startAutoEnrichment, continueAutoEnrichment, drainResearchQueue, BATCH_SIZE } =
  await import('@/lib/worker/enrich-free')

const FAR = () => Date.now() + 10 * 60_000

function scopeOf(runId: string) {
  return runs.find((r) => r.id === runId)!.scope as {
    type: string
    leadIds?: string[]
    companyIds?: string[]
    autoEnrich: { stage: string; next: unknown[] }
  }
}

beforeEach(() => {
  runs = []
  jobLeads = Array.from({ length: 23 }, (_, i) => uuid(i + 1))
  jobKind = 'lead_search'
  events = []
  failingRuns = new Set()
  paid = false
  usageFails = false
  deferredUntil.clear()
  nextId = 0
  vi.stubEnv('AUTO_ENRICH_MONTHLY_LIMIT', '')
})

describe('automatic enrichment chain', () => {
  it('reaches every lead — no ceiling — in batches of BATCH_SIZE', async () => {
    jobLeads = Array.from({ length: 87 }, (_, i) => uuid(i + 1))
    const first = await startAutoEnrichment(JOB, USER)
    await continueAutoEnrichment(first, USER, FAR(), 'test')

    const batches = runs.map((r) => scopeOf(r.id).leadIds!)
    expect(batches.map((ids) => ids.length)).toEqual([10, 10, 10, 10, 10, 10, 10, 10, 7])
    expect(batches.flat()).toEqual(jobLeads)
    expect(BATCH_SIZE).toBe(10)
  })

  it('merges and rebuilds each batch BEFORE the next one is queued', async () => {
    const first = await startAutoEnrichment(JOB, USER)
    await continueAutoEnrichment(first, USER, FAR(), 'test')

    const [a, b, c] = runs.map((r) => r.id)
    expect(events).toEqual([
      `queue:${a}`,
      `process:${a}`, `merge:${a}`, 'rebuild:leads', `queue:${b}`,
      `process:${b}`, `merge:${b}`, 'rebuild:leads', `queue:${c}`,
      `process:${c}`, `merge:${c}`, 'rebuild:leads',
    ])
  })

  it('leaves the next batch queued when one would not finish before the deadline', async () => {
    const first = await startAutoEnrichment(JOB, USER)
    await continueAutoEnrichment(first, USER, Date.now() + 1_000, 'test')

    expect(events).toEqual([`queue:${first}`])
    expect(runs[0]!.status).toBe('pending')
  })

  it('a batch that fails for good does not strand the rest of the upload', async () => {
    const first = await startAutoEnrichment(JOB, USER)
    failingRuns.add(first!)
    await continueAutoEnrichment(first, USER, FAR(), 'test')

    expect(runs).toHaveLength(3)
    expect(events).not.toContain(`merge:${first}`)
    expect(runs.slice(1).every((r) => r.status === 'partially_complete')).toBe(true)
  })

  it('an account list researches recommended leads, then company discovery, then contacts', async () => {
    jobKind = 'account_list'
    const leadIds = [uuid(501), uuid(502), uuid(503)]
    const companyIds = Array.from({ length: 12 }, (_, i) => uuid(600 + i))
    const first = await startAutoEnrichment(JOB, USER, { leadIds, companyIds })
    await continueAutoEnrichment(first, USER, FAR(), 'test')

    expect(runs.map((r) => {
      const scope = scopeOf(r.id)
      return `${scope.autoEnrich.stage}:${(scope.leadIds ?? scope.companyIds)!.length}`
    })).toEqual([
      'leads:3',
      'company_discovery:10', 'company_discovery:2',
      'company_contacts:10', 'company_contacts:2',
    ])
    // Company stages enrich companies, not lead cells: nothing to merge.
    expect(events.filter((e) => e.startsWith('merge:'))).toHaveLength(1)
    expect(events.filter((e) => e === 'rebuild:accounts')).toHaveLength(5)
  })

  it('never queues the same batch twice', async () => {
    const first = await startAutoEnrichment(JOB, USER)
    const again = await startAutoEnrichment(JOB, USER)
    expect(again).toBe(first)
    expect(runs).toHaveLength(1)
  })

  it('steps aside entirely while paid providers are enabled', async () => {
    paid = true
    expect(await startAutoEnrichment(JOB, USER)).toBeNull()
    expect(runs).toHaveLength(0)
  })

  it('the cron drain re-plans a pre-batching single run instead of processing it whole', async () => {
    const legacy = jobLeads.slice(0, 23)
    runs.push({
      id: uuid(9000),
      user_id: USER,
      status: 'pending',
      scope: { type: 'lead_ids', leadIds: legacy },
      query_text: `Automatic enrichment for extraction ${JOB}.`,
      idempotency_key: 'legacy',
    })

    const outcome = await drainResearchQueue({ deadlineAt: FAR(), workers: 1, claimedBy: 'test' })

    expect(runs[0]!.status).toBe('cancelled')
    expect(events).not.toContain(`process:${uuid(9000)}`)
    const batches = runs.slice(1).map((r) => scopeOf(r.id).leadIds!)
    expect(batches.flat()).toEqual(legacy)
    expect(batches.every((ids) => ids.length <= BATCH_SIZE)).toBe(true)
    expect(runs.slice(1).every((r) => r.status === 'partially_complete')).toBe(true)
    expect(outcome.batches).toBe(4)
  })

  it('the cron drain researches a console run but never merges it into leads', async () => {
    runs.push({
      id: uuid(9100),
      user_id: USER,
      status: 'pending',
      scope: { type: 'all_leads' },
      query_text: 'Which of these companies raised money this year?',
      idempotency_key: 'console',
    })

    await drainResearchQueue({ deadlineAt: FAR(), workers: 2, claimedBy: 'test' })

    expect(events).toEqual([`process:${uuid(9100)}`])
  })

  it('the cron drain cancels a console run stranded for days instead of running it unattended', async () => {
    runs.push({
      id: uuid(9200),
      user_id: USER,
      status: 'pending',
      scope: { type: 'all_leads' },
      query_text: 'Which of these companies raised money this year?',
      idempotency_key: 'console-old',
      created_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    })

    await drainResearchQueue({ deadlineAt: FAR(), workers: 1, claimedBy: 'test' })

    expect(events).toEqual([`cancel:${uuid(9200)}`])
  })
})

describe('the monthly automatic limit', () => {
  it('defers the rest of an upload to the 1st of next month once the limit is reached', async () => {
    vi.stubEnv('AUTO_ENRICH_MONTHLY_LIMIT', '15')
    const first = await startAutoEnrichment(JOB, USER)
    await continueAutoEnrichment(first, USER, FAR(), 'test')

    const [a, b, c] = runs.map((r) => r.id)
    const now = new Date()
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)
    // 0 used → batch 1; 10 used → batch 2; 20 ≥ 15 → the third waits, never dropped.
    expect(events).toContain(`process:${a}`)
    expect(events).toContain(`process:${b}`)
    expect(events).not.toContain(`process:${c}`)
    expect(events).toContain(`defer:${c}:${nextMonth}`)
    expect(runs.find((r) => r.id === c)!.status).toBe('pending')
  })

  it('pauses the automatic pass entirely at 0', async () => {
    vi.stubEnv('AUTO_ENRICH_MONTHLY_LIMIT', '0')
    const first = await startAutoEnrichment(JOB, USER)
    await continueAutoEnrichment(first, USER, FAR(), 'test')
    expect(events.some((e) => e.startsWith('process:'))).toBe(false)
    expect(events.some((e) => e.startsWith(`defer:${first}`))).toBe(true)
  })

  it('waits minutes, not a month, when usage cannot be read', async () => {
    usageFails = true
    const first = await startAutoEnrichment(JOB, USER)
    await continueAutoEnrichment(first, USER, FAR(), 'test')
    const wait = deferredUntil.get(first!)! - Date.now()
    expect(wait).toBeGreaterThan(5 * 60_000)
    expect(wait).toBeLessThanOrEqual(10 * 60_000)
  })

  it('never limits a Hubble console run', async () => {
    vi.stubEnv('AUTO_ENRICH_MONTHLY_LIMIT', '0')
    runs.push({
      id: uuid(9300),
      user_id: USER,
      status: 'pending',
      scope: { type: 'all_leads' },
      query_text: 'Who are the decision makers here?',
      idempotency_key: 'console-limit',
    })
    await drainResearchQueue({ deadlineAt: FAR(), workers: 1, claimedBy: 'test' })
    expect(events).toEqual([`process:${uuid(9300)}`])
  })
})

describe('the chain marker is server-only', () => {
  it('a client cannot send autoEnrich through the console scope', async () => {
    const { clientResearchScopeSchema, researchScopeSchema } = await import('@/lib/intelligence/plan')
    const scope = {
      type: 'lead_ids',
      leadIds: [uuid(1)],
      autoEnrich: { jobId: JOB, stage: 'leads', next: [] },
    }
    expect(researchScopeSchema.safeParse(scope).success).toBe(true)
    expect(clientResearchScopeSchema.safeParse(scope).success).toBe(false)
    expect(clientResearchScopeSchema.safeParse({ type: 'lead_ids', leadIds: [uuid(1)] }).success).toBe(true)
  })
})
