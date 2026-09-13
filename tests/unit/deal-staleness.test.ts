/**
 * A deal is stale because it has SAT, not because nobody touched it — A2.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE DEFECT.                                                              ║
 * ║                                                                           ║
 * ║  `isStale` was `row.updated_at < staleBefore`. `set_updated_at` fires on   ║
 * ║  every write, so renaming a deal, reassigning it, or correcting its value ║
 * ║  reset the clock on a deal that had not moved stage in months. The badge  ║
 * ║  vanished and the deal went back to looking healthy.                      ║
 * ║                                                                           ║
 * ║  §8 is explicit: "Editing a name … resets neither."                       ║
 * ║                                                                           ║
 * ║  ⚠️ AND IT WAS WRONG IN THE BROWSER TOO. `useBoardRealtime` rebuilt the    ║
 * ║  card from the payload with a flat `isStale: false`, reasoning that a     ║
 * ║  card which just moved is not rotting. True of a move — but that          ║
 * ║  subscription fires on EVERY update to the row, so a rename cleared the   ║
 * ║  badge live even once the server got it right. Fixing one half would have ║
 * ║  looked fixed and behaved broken.                                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ PROVEN NON-VACUOUS BY BREAKING IT (§2.1): reverting `isStale` to compare
 * `row.updated_at` fails "an edit does not reset the stage clock" and "a deal
 * that never moved is aged from its creation"; ordering the history ascending
 * so the OLDEST entry wins fails "a deal that came back is aged from its
 * RETURN".
 *
 * ⚠️ AND ONE MUTATION THAT IS NOT CAUGHT, RECORDED RATHER THAN HIDDEN:
 * removing the `.eq('to_stage_id', …)` filter changes no result here, and it
 * turns out it changes no result anywhere — a deal sitting in a stage got there
 * by entering it, so its newest history row IS that entry whether or not the
 * query filters. The filter is a narrowing for the index, not a correctness
 * condition, and `stageEntryTimes` now says so instead of claiming a guarantee
 * it does not provide.
 *
 * Fixtures are fabricated.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const WS = '00000000-0000-4000-8000-000000000001'
const PIPELINE = '00000000-0000-4000-8000-000000000002'
const STAGE = '00000000-0000-4000-8000-000000000003'
const OTHER_STAGE = '00000000-0000-4000-8000-000000000004'
const DEAL = '00000000-0000-4000-8000-000000000010'

/*
 * ⚠️ ONE CLOCK READING FOR THE WHOLE FILE. `daysAgo(60)` called twice is two
 * different milliseconds, so seeding with one and asserting on the other fails
 * intermittently — a time-dependent test, which is the defect #22 removed from
 * this suite. Freezing `NOW` makes every timestamp here exact.
 */
const NOW = Date.now()
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString()

const mocks = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>[]>(),
}))

/**
 * A table-aware PostgREST stub. Filters are recorded and applied, because the
 * property under test IS a filter: `to_stage_id` is what makes a deal that
 * returned to a stage age from its return rather than its first visit.
 */
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const eq: Record<string, unknown> = {}
      let inCol: string | null = null
      let inVals: unknown[] = []
      let desc = false
      let orderCol: string | null = null

      const rows = () => {
        let out = (mocks.rows.get(table) ?? []).filter((row) =>
          Object.entries(eq).every(([k, v]) => row[k] === v),
        )
        if (inCol) out = out.filter((row) => inVals.includes(row[inCol!]))
        if (orderCol) {
          out = [...out].sort((a, b) =>
            String(a[orderCol!]) < String(b[orderCol!]) ? (desc ? 1 : -1) : desc ? -1 : 1,
          )
        }
        return out.map((r) => ({ ...r }))
      }

      const chain: Record<string, unknown> = {}
      Object.assign(chain, {
        select: () => chain,
        eq: (col: string, value: unknown) => {
          eq[col] = value
          return chain
        },
        in: (col: string, values: unknown[]) => {
          inCol = col
          inVals = values
          return chain
        },
        is: () => chain,
        limit: () => chain,
        order: (col: string, opts?: { ascending?: boolean }) => {
          orderCol = col
          desc = opts?.ascending === false
          return chain
        },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        single: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: rows(), count: rows().length, error: null }),
      })
      return chain
    },
  }),
}))

const { getBoard } = await import('@/lib/crm/opportunities')

/** One open deal in STAGE, renamed today, sitting there for `sattingDays`. */
function seed(options: {
  staleAfterDays: number | null
  updatedAt: string
  createdAt: string
  history?: { to_stage_id: string; occurred_at: string }[]
}) {
  mocks.rows.set('crm_pipelines', [{ id: PIPELINE, workspace_id: WS, name: 'Sales', is_default: true }])
  mocks.rows.set('crm_pipeline_stages', [
    {
      id: STAGE,
      workspace_id: WS,
      pipeline_id: PIPELINE,
      name: 'Proposal',
      kind: 'open',
      sort_order: 1,
      default_probability: 50,
      stale_after_days: options.staleAfterDays,
    },
  ])
  mocks.rows.set('crm_opportunities', [
    {
      id: DEAL,
      workspace_id: WS,
      pipeline_id: PIPELINE,
      stage_id: STAGE,
      status: 'open',
      deleted_at: null,
      title: 'Fabricated deal',
      version: 1,
      value_amount: 1000,
      currency: 'USD',
      owner_user_id: null,
      contact_id: null,
      updated_at: options.updatedAt,
      created_at: options.createdAt,
    },
  ])
  mocks.rows.set(
    'crm_opportunity_stage_history',
    (options.history ?? []).map((h, i) => ({
      id: `h${i}`,
      workspace_id: WS,
      opportunity_id: DEAL,
      ...h,
    })),
  )
}

const staleFlag = async () => {
  const board = await getBoard(WS, PIPELINE)
  return board[0]!.cards[0]!
}

beforeEach(() => mocks.rows.clear())

describe('staleness is measured from stage entry', () => {
  it('an edit does not reset the stage clock', async () => {
    /*
     * ⚠️ THE DEFECT, IN ONE TEST. The deal entered Proposal 60 days ago and
     * somebody renamed it a minute ago. Reading `updated_at` calls that fresh.
     */
    seed({
      staleAfterDays: 30,
      updatedAt: daysAgo(0),
      createdAt: daysAgo(90),
      history: [{ to_stage_id: STAGE, occurred_at: daysAgo(60) }],
    })

    const card = await staleFlag()
    expect(card.isStale, 'a rename cleared the stale badge').toBe(true)
    expect(card.stageEnteredAt).toBe(daysAgo(60))
  })

  it('a deal that genuinely just moved here is not stale', async () => {
    seed({
      staleAfterDays: 30,
      updatedAt: daysAgo(0),
      createdAt: daysAgo(90),
      history: [{ to_stage_id: STAGE, occurred_at: daysAgo(2) }],
    })

    expect((await staleFlag()).isStale).toBe(false)
  })

  it('a deal that came back is aged from its RETURN, not its first visit', async () => {
    /*
     * ⚠️ WHY THE QUERY FILTERS ON `to_stage_id`. Proposal → Negotiation →
     * Proposal. The newest history row overall describes the return; the
     * newest row INTO THIS STAGE is the clock on screen. Reading the wrong one
     * ages the deal from a visit it has already left.
     */
    seed({
      staleAfterDays: 30,
      updatedAt: daysAgo(0),
      createdAt: daysAgo(200),
      history: [
        { to_stage_id: STAGE, occurred_at: daysAgo(120) },
        { to_stage_id: OTHER_STAGE, occurred_at: daysAgo(90) },
        { to_stage_id: STAGE, occurred_at: daysAgo(3) },
      ],
    })

    const card = await staleFlag()
    expect(card.stageEnteredAt, 'aged from the first visit, not the return').toBe(daysAgo(3))
    expect(card.isStale).toBe(false)
  })

  it('a deal that never moved is aged from its creation', async () => {
    /*
     * `createOpportunity` sets the first stage directly rather than through
     * `crm_move_opportunity_stage`, so a deal created here has NO history row.
     * Its creation is its stage entry — falling back to `updated_at` would
     * reintroduce the bug for exactly the deals nobody has moved.
     */
    seed({ staleAfterDays: 30, updatedAt: daysAgo(0), createdAt: daysAgo(45), history: [] })

    const card = await staleFlag()
    expect(card.stageEnteredAt).toBe(daysAgo(45))
    expect(card.isStale).toBe(true)
  })

  it('no threshold configured means nothing is ever stale', async () => {
    // `stale_after_days` is nullable, and null means the stage does not rot.
    seed({
      staleAfterDays: null,
      updatedAt: daysAgo(0),
      createdAt: daysAgo(500),
      history: [{ to_stage_id: STAGE, occurred_at: daysAgo(400) }],
    })

    expect((await staleFlag()).isStale).toBe(false)
  })
})
