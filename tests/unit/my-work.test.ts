/**
 * The queue is ordered by §7's tiers, and a deal is covered by a task on THAT
 * deal.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  TWO THINGS HERE CAN BE WRONG WHILE LOOKING COMPLETELY FINE.              ║
 * ║                                                                           ║
 * ║  1. THE ORDER. Sorting the flattened list by time is the obvious tidy-up  ║
 * ║     and it destroys the ranking: this morning's overdue reminder would    ║
 * ║     outrank last week's unanswered reply. The list still renders, still   ║
 * ║     looks sorted, and quietly buries the person waiting on an answer —    ║
 * ║     which is the one thing §7 puts first.                                 ║
 * ║                                                                           ║
 * ║  2. COVERAGE SCOPE. The deals are mine; a deal is covered the moment      ║
 * ║     ANYONE has an open task on it. Scoping the coverage lookup to my own  ║
 * ║     tasks reports a colleague's booked follow-up as missing, and the      ║
 * ║     natural fix for that false alarm is to create a duplicate task. A     ║
 * ║     queue that manufactures work is worse than no queue.                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ PROVEN NON-VACUOUS BY BREAKING IT (§2.1), each mutation verified to have
 * applied before the run: sorting by `at` alone fails the ordering test,
 * scoping the coverage query to the viewer fails the colleague test, and
 * joining coverage through `contact_id` instead of `opportunity_id` fails the
 * unrelated-activity test.
 *
 * Fixtures are fabricated.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const WS = '00000000-0000-4000-8000-000000000001'
const ME = '00000000-0000-4000-8000-000000000002'
const COLLEAGUE = '00000000-0000-4000-8000-000000000003'

/** A fixed instant so "today" and "overdue" cannot drift with the clock. */
const NOW = new Date('2026-09-14T12:00:00.000Z')

type Row = Record<string, unknown>

const mocks = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  /** Every (table, filters) pair the module asked for. */
  queries: [] as { table: string; filters: Record<string, unknown> }[],
}))

vi.mock('server-only', () => ({}))

/**
 * A PostgREST-shaped stub that actually filters.
 *
 * ⚠️ A STUB THAT CANNOT EXPRESS THE BUG CANNOT CATCH IT. An earlier version
 * ignored `.eq()` and returned every seeded row, so removing a workspace filter
 * from the module changed nothing and the tenancy test passed for a reason that
 * had nothing to do with the code. This one applies each operator — including
 * `.or()`, which the snooze filter uses.
 */
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {}
      const preds: ((r: Row) => boolean)[] = []
      let order: { column: string; ascending: boolean } | null = null
      let limit = Infinity

      /** One `column.operator.value` clause of a PostgREST logic tree. */
      const clause = (text: string): ((r: Row) => boolean) => {
        const first = text.indexOf('.')
        const second = text.indexOf('.', first + 1)
        const column = text.slice(0, first)
        const op = text.slice(first + 1, second)
        const value = text.slice(second + 1).replace(/^"|"$/g, '')
        if (op === 'is' && value === 'null') return (r) => (r[column] ?? null) === null
        if (op === 'lte') return (r) => r[column] != null && String(r[column]) <= value
        if (op === 'gte') return (r) => r[column] != null && String(r[column]) >= value
        if (op === 'lt') return (r) => r[column] != null && String(r[column]) < value
        if (op === 'eq') return (r) => String(r[column]) === value
        throw new Error(`stub does not understand or-clause operator ${op}`)
      }

      const chain: Record<string, unknown> = {}
      const run = () => {
        mocks.queries.push({ table, filters })
        let rows = (mocks.tables[table] ?? []).filter((r) => preds.every((p) => p(r)))
        if (order) {
          const { column, ascending } = order
          rows = [...rows].sort((a, b) => {
            const x = String(a[column] ?? '')
            const y = String(b[column] ?? '')
            return (x < y ? -1 : x > y ? 1 : 0) * (ascending ? 1 : -1)
          })
        }
        return { data: rows.slice(0, limit), error: null }
      }

      Object.assign(chain, {
        select: () => chain,
        eq: (c: string, v: unknown) => {
          filters[c] = v
          preds.push((r) => r[c] === v)
          return chain
        },
        neq: (c: string, v: unknown) => {
          preds.push((r) => r[c] !== v)
          return chain
        },
        lt: (c: string, v: string) => {
          preds.push((r) => String(r[c]) < v)
          return chain
        },
        gte: (c: string, v: string) => {
          preds.push((r) => String(r[c]) >= v)
          return chain
        },
        lte: (c: string, v: string) => {
          preds.push((r) => String(r[c]) <= v)
          return chain
        },
        is: (c: string, v: null) => {
          preds.push((r) => (r[c] ?? null) === v)
          return chain
        },
        not: (c: string, _op: string, v: null) => {
          preds.push((r) => (r[c] ?? null) !== v)
          return chain
        },
        or: (tree: string) => {
          filters.or = tree
          // Timestamps carry no commas, so a top-level split is exact here.
          const alternatives = tree.split(',').map(clause)
          preds.push((r) => alternatives.some((p) => p(r)))
          return chain
        },
        in: (c: string, vs: unknown[]) => {
          filters[`in:${c}`] = vs
          preds.push((r) => vs.includes(r[c]))
          return chain
        },
        order: (column: string, o: { ascending: boolean }) => {
          order = { column, ascending: o.ascending }
          return chain
        },
        limit: (n: number) => {
          limit = n
          return { ...chain, then: undefined, ...run() }
        },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(run()).then(resolve),
      })
      return chain
    },
  }),
}))

const { listMyWork, WORK_REASONS } = await import('@/lib/crm/my-work')

const run = () => listMyWork({ workspaceId: WS, userId: ME, now: NOW })

beforeEach(() => {
  mocks.tables = { email_threads: [], crm_tasks: [], crm_opportunities: [] }
  mocks.queries = []
})

function thread(over: Row = {}): Row {
  return {
    id: 't1',
    workspace_id: WS,
    status: 'open',
    last_direction: 'inbound',
    assigned_to: ME,
    subject: 'Re: proposal',
    last_message_at: '2026-09-07T09:00:00.000Z',
    contact_id: null,
    ...over,
  }
}

function task(over: Row = {}): Row {
  return {
    id: 'k1',
    workspace_id: WS,
    assigned_to_user_id: ME,
    status: 'open',
    deleted_at: null,
    title: 'Call them back',
    due_at: '2026-09-14T09:00:00.000Z',
    contact_id: null,
    opportunity_id: null,
    snoozed_until: null,
    version: 1,
    ...over,
  }
}

function deal(over: Row = {}): Row {
  return {
    id: 'd1',
    workspace_id: WS,
    owner_user_id: ME,
    status: 'open',
    deleted_at: null,
    title: 'Acme renewal',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...over,
  }
}

describe('the ranking', () => {
  it('puts a reply that arrived an hour ago above a task overdue since last week', async () => {
    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  ⚠️ THE FIXTURE IS THE TEST. The timestamps must DISAGREE with the     ║
     * ║  tiers, or the assertion proves nothing.                              ║
     * ║                                                                       ║
     * ║  The first version of this test used a week-old reply and a task due  ║
     * ║  that morning — and the reply sorts first under BOTH orderings,       ║
     * ║  because it is the older timestamp. Deleting the tier ranking         ║
     * ║  entirely left all fourteen tests green.                              ║
     * ║                                                                       ║
     * ║  So: the reply is the NEWER of the two. By time alone the overdue     ║
     * ║  task wins; by §7 the reply does, because a person is waiting on an   ║
     * ║  answer and the task is a reminder somebody set for themselves.       ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     */
    mocks.tables.email_threads = [thread({ last_message_at: '2026-09-14T11:00:00.000Z' })]
    mocks.tables.crm_tasks = [task({ due_at: '2026-09-07T09:00:00.000Z' })]

    const items = await run()

    expect(items.map((i) => i.reason)).toEqual(['reply_awaiting', 'overdue'])
    // Spelled out so the point survives a future edit: the winner is the LATER
    // timestamp, which only a tier ranking can produce.
    expect(items[0]!.at! > items[1]!.at!).toBe(true)
  })

  it('orders the tiers exactly as WORK_REASONS declares them', async () => {
    mocks.tables.email_threads = [thread()]
    mocks.tables.crm_tasks = [
      task({ id: 'k1', due_at: '2026-09-13T09:00:00.000Z' }),
      task({ id: 'k2', due_at: '2026-09-14T15:00:00.000Z' }),
    ]
    mocks.tables.crm_opportunities = [deal()]

    const items = await run()

    expect(items.map((i) => i.reason)).toEqual([...WORK_REASONS])
  })

  it('never lists the same task under two reasons', async () => {
    /*
     * ⚠️ THE DEFECT THIS FILE ACTUALLY FOUND. A task due at 08:00, read at
     * noon, is both "before now" and "within today" — so the first version
     * printed it twice, four rows apart, under Overdue and Due today. On
     * /crm/tasks that overlap is harmless because those are separate tabs; in
     * one ranked list it is a queue that lists the same job twice, which is a
     * queue people stop believing.
     */
    mocks.tables.crm_tasks = [task({ id: 'k1', due_at: '2026-09-14T08:00:00.000Z' })]

    const items = await run()

    expect(items).toHaveLength(1)
    expect(items[0]!.reason).toBe('overdue')
  })

  it('still shows a task due later today', async () => {
    // The partition must not have been achieved by dropping the tier.
    mocks.tables.crm_tasks = [task({ id: 'k1', due_at: '2026-09-14T18:00:00.000Z' })]

    const items = await run()

    expect(items.map((i) => i.reason)).toEqual(['due_today'])
  })

  it('orders by time within a tier, soonest first', async () => {
    mocks.tables.crm_tasks = [
      task({ id: 'late', due_at: '2026-09-13T18:00:00.000Z' }),
      task({ id: 'early', due_at: '2026-09-10T08:00:00.000Z' }),
    ]

    const items = await run()

    expect(items.map((i) => i.key)).toEqual(['overdue:early', 'overdue:late'])
  })
})

describe('deals without a next action', () => {
  it('does not list a deal that a colleague has already booked work on', async () => {
    /*
     * The deal is mine. The open task on it is theirs. Reporting this as
     * uncovered invites a duplicate task for work that is already scheduled.
     */
    mocks.tables.crm_opportunities = [deal({ id: 'd1' })]
    mocks.tables.crm_tasks = [
      task({ id: 'theirs', assigned_to_user_id: COLLEAGUE, opportunity_id: 'd1', due_at: null }),
    ]

    const items = await run()

    expect(items.filter((i) => i.reason === 'deal_without_next_action')).toHaveLength(0)
  })

  it('an unrelated activity on the same contact does not cover the deal', async () => {
    /*
     * ⚠️ §7 NAMES THIS EXACT FAILURE: "An unrelated contact activity must not
     * make every deal look covered." Before 0124 a task could only name a
     * person, so the only available join was through the contact — and every
     * deal for a busy contact would have read as covered.
     */
    mocks.tables.crm_opportunities = [deal({ id: 'd1' })]
    mocks.tables.crm_tasks = [
      task({ id: 'contact-only', contact_id: 'c1', opportunity_id: null, due_at: null }),
    ]

    const items = await run()

    expect(items.filter((i) => i.reason === 'deal_without_next_action')).toHaveLength(1)
  })

  it('a completed task does not count as a next action', async () => {
    // Coverage is about FUTURE work. A finished task is history.
    mocks.tables.crm_opportunities = [deal({ id: 'd1' })]
    mocks.tables.crm_tasks = [
      task({ id: 'done', status: 'completed', opportunity_id: 'd1', due_at: null }),
    ]

    const items = await run()

    expect(items.filter((i) => i.reason === 'deal_without_next_action')).toHaveLength(1)
  })

  it('does not query for coverage when there are no deals to cover', async () => {
    mocks.tables.crm_opportunities = []

    await run()

    const coverage = mocks.queries.filter((q) => q.table === 'crm_tasks' && 'in:opportunity_id' in q.filters)
    expect(coverage).toHaveLength(0)
  })
})

describe('snoozed tasks (0126)', () => {
  it('stay out of the queue until their review date', async () => {
    mocks.tables.crm_tasks = [
      task({ id: 'overdue-snoozed', due_at: '2026-09-10T09:00:00.000Z', snoozed_until: '2026-09-15T00:00:00.000Z' }),
      task({ id: 'today-snoozed', due_at: '2026-09-14T18:00:00.000Z', snoozed_until: '2026-09-15T00:00:00.000Z' }),
    ]

    expect(await run()).toEqual([])
  })

  it('come back once the review date has passed, still overdue', async () => {
    // A snooze is a review date, not a new due date: the task returns as the
    // overdue commitment it always was.
    mocks.tables.crm_tasks = [
      task({ id: 'back', due_at: '2026-09-10T09:00:00.000Z', snoozed_until: '2026-09-14T06:00:00.000Z' }),
    ]

    const items = await run()

    expect(items.map((i) => i.key)).toEqual(['overdue:back'])
  })

  it('still count as the deal’s next action while snoozed', async () => {
    /*
     * ⚠️ HIDDEN FROM THE PERSON, NOT FROM THE DEAL. The work is still booked;
     * reporting the deal as uncovered would invite a duplicate task.
     */
    mocks.tables.crm_opportunities = [deal({ id: 'd1' })]
    mocks.tables.crm_tasks = [
      task({ id: 'booked', opportunity_id: 'd1', due_at: '2026-09-20T09:00:00.000Z', snoozed_until: '2026-09-18T00:00:00.000Z' }),
    ]

    const items = await run()

    expect(items.filter((i) => i.reason === 'deal_without_next_action')).toHaveLength(0)
  })
})

describe('what the row actions need', () => {
  it('task rows carry their id and the version they were read at', async () => {
    mocks.tables.crm_tasks = [task({ id: 'k9', due_at: '2026-09-10T09:00:00.000Z', version: 3 })]

    const items = await run()

    expect(items[0]!.task).toEqual({ id: 'k9', version: 3 })
  })

  it('replies and deals have no task to act on', async () => {
    mocks.tables.email_threads = [thread()]
    mocks.tables.crm_opportunities = [deal()]

    const items = await run()

    expect(items.map((i) => i.task)).toEqual([null, null])
  })
})

describe('scoping', () => {
  it('every query filters by workspace', async () => {
    mocks.tables.email_threads = [thread()]
    mocks.tables.crm_tasks = [task()]
    mocks.tables.crm_opportunities = [deal()]

    await run()

    expect(mocks.queries.length).toBeGreaterThan(0)
    for (const q of mocks.queries) {
      expect(q.filters.workspace_id, `${q.table} was queried without a workspace filter`).toBe(WS)
    }
  })

  it('shows no one else their work', async () => {
    mocks.tables.email_threads = [thread({ assigned_to: COLLEAGUE })]
    mocks.tables.crm_tasks = [task({ assigned_to_user_id: COLLEAGUE })]
    mocks.tables.crm_opportunities = [deal({ owner_user_id: COLLEAGUE })]

    expect(await run()).toEqual([])
  })

  it('leaves an outbound thread alone — nobody is waiting on us', async () => {
    mocks.tables.email_threads = [thread({ last_direction: 'outbound' })]

    expect(await run()).toEqual([])
  })

  it('ignores a deleted task', async () => {
    mocks.tables.crm_tasks = [task({ deleted_at: '2026-09-01T00:00:00.000Z' })]

    expect(await run()).toEqual([])
  })

  it('ignores an undated task in both time tiers', async () => {
    // Undated is not overdue and not due today — it is undated, and sweeping it
    // into either tier would bury the things that have a real deadline.
    mocks.tables.crm_tasks = [task({ due_at: null })]

    expect(await run()).toEqual([])
  })
})
