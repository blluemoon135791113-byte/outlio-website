/**
 * Routing rules, availability and the Unassigned queue behave as the settings
 * screen promises.
 *
 * The routing DECISIONS are made and proven in 0127 against real Postgres.
 * What this file owns is the configuration around them: who may be named, what
 * a stale edit does, what order rules end up in, which leads the queue shows,
 * and what "Route again" may and may not do.
 *
 * ⚠️ THE STUB FILTERS FOR REAL. `eq`, `is` and `in` narrow the rows and an
 * update only touches what matched, so a missing workspace filter or version
 * check changes the outcome instead of passing unnoticed.
 *
 * Fixtures are fabricated.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const WS = '00000000-0000-4000-8000-000000000001'
const OTHER_WS = '00000000-0000-4000-8000-000000000002'
const ADMIN = '00000000-0000-4000-8000-0000000000ad'
const A = '00000000-0000-4000-8000-0000000000a1'
const B = '00000000-0000-4000-8000-0000000000b1'
const OUTSIDER = '00000000-0000-4000-8000-0000000000f1'

type Row = Record<string, unknown>

const mocks = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  audits: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  rpcResult: { data: null as unknown, error: null as unknown },
  nextId: 1,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/crm/activities', () => ({
  recordAudit: async (_ws: string, entry: Record<string, unknown>) => {
    mocks.audits.push(entry)
  },
}))
vi.mock('@/lib/events/emit', () => ({
  emitDomainEvent: async (event: Record<string, unknown>) => {
    mocks.events.push(event)
  },
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      mocks.rpcCalls.push({ fn, args })
      return mocks.rpcResult
    },
    from: (table: string) => {
      const preds: ((r: Row) => boolean)[] = []
      const orders: [string, boolean][] = []
      let limit = Infinity
      let op: 'select' | 'insert' | 'update' = 'select'
      let payload: Row = {}

      const exec = (): { data: unknown; error: null } => {
        const rows = (mocks.tables[table] ??= [])
        if (op === 'insert') {
          const row = { id: `id-${mocks.nextId++}`, ...payload }
          rows.push(row)
          return { data: row, error: null }
        }
        const matched = rows.filter((r) => preds.every((p) => p(r)))
        if (op === 'update') {
          for (const r of matched) Object.assign(r, payload)
          return { data: matched.map((r) => ({ ...r })), error: null }
        }
        const sorted = [...matched].sort((x, y) => {
          for (const [col, asc] of orders) {
            const a = x[col] as string | number
            const b = y[col] as string | number
            if (a < b) return asc ? -1 : 1
            if (a > b) return asc ? 1 : -1
          }
          return 0
        })
        /*
         * ⚠️ COPIES, NOT THE STORED ROWS. PostgREST returns fresh JSON; handing
         * back the same objects let a later update rewrite a row the code had
         * already read, so an audit's "before" showed the "after".
         */
        return { data: sorted.slice(0, limit).map((r) => ({ ...r })), error: null }
      }

      const b: Record<string, unknown> = {}
      Object.assign(b, {
        select: () => b,
        eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v), b),
        is: (c: string, v: unknown) => (preds.push((r) => (r[c] ?? null) === v), b),
        in: (c: string, vs: unknown[]) => (preds.push((r) => vs.includes(r[c])), b),
        order: (c: string, o?: { ascending?: boolean }) => (orders.push([c, o?.ascending !== false]), b),
        limit: (n: number) => ((limit = n), b),
        insert: (row: Row) => ((op = 'insert'), (payload = row), b),
        update: (patch: Row) => ((op = 'update'), (payload = patch), b),
        maybeSingle: async () => {
          const { data } = exec()
          return { data: Array.isArray(data) ? (data[0] ?? null) : data, error: null }
        },
        single: async () => {
          const { data } = exec()
          return { data: Array.isArray(data) ? data[0] : data, error: null }
        },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(exec()).then(resolve),
      })
      return b
    },
  }),
}))

const lib = await import('@/lib/crm/routing-rules')
const { RoutingRuleError } = lib

function rule(over: Row = {}): Row {
  return {
    id: 'r1',
    workspace_id: WS,
    name: 'Rule',
    position: 0,
    kind: 'pool',
    sources: ['csv_import'],
    user_id: null,
    member_ids: [A],
    max_open_workload: null,
    status: 'draft',
    version: 1,
    published_at: null,
    created_at: '2026-09-01T00:00:00Z',
    deleted_at: null,
    ...over,
  }
}

const poolInput = {
  name: 'Sales',
  kind: 'pool' as const,
  sources: ['csv_import' as const],
  userId: null,
  memberIds: [A, B],
  maxOpenWorkload: null,
}

beforeEach(() => {
  mocks.tables = {
    workspace_memberships: [
      { workspace_id: WS, user_id: A, role: 'setter', away_until: null, created_at: '1' },
      { workspace_id: WS, user_id: B, role: 'setter', away_until: null, created_at: '2' },
      { workspace_id: OTHER_WS, user_id: OUTSIDER, role: 'owner', away_until: null, created_at: '3' },
    ],
    crm_routing_rules: [],
    crm_routing_decisions: [],
    crm_contacts: [],
    profiles: [],
  }
  mocks.audits = []
  mocks.events = []
  mocks.rpcCalls = []
  mocks.rpcResult = { data: null, error: null }
  mocks.nextId = 1
})

describe('rule input', () => {
  it('drops the fields that belong to another kind before validating', () => {
    // The form keeps a person picked under "One named person" after switching
    // to a pool; refusing that invisible value would be an error nobody can see.
    expect(lib.validateRuleInput({ ...poolInput, userId: A })).toMatchObject({ userId: null, memberIds: [A, B] })
    expect(lib.validateRuleInput({ ...poolInput, kind: 'company_owner', userId: A })).toMatchObject({
      userId: null,
      memberIds: [],
    })
  })

  it('counts a person or a source listed twice once', () => {
    const input = lib.validateRuleInput({ ...poolInput, memberIds: [A, A, B], sources: ['csv_import', 'csv_import'] })
    expect(input.memberIds).toEqual([A, B])
    expect(input.sources).toEqual(['csv_import'])
  })

  it('refuses a rule that cannot route anyone', () => {
    const bad = [
      { ...poolInput, kind: 'named_user' as const, userId: null },
      { ...poolInput, memberIds: [] },
      { ...poolInput, sources: [] },
      { ...poolInput, maxOpenWorkload: 0 },
      { ...poolInput, name: '   ' },
    ]
    for (const input of bad) {
      expect(() => lib.validateRuleInput(input), JSON.stringify(input)).toThrow(RoutingRuleError)
    }
  })
})

describe('creating and editing', () => {
  it('refuses a rule naming someone outside the workspace, and writes nothing', async () => {
    await expect(lib.createRule(WS, ADMIN, { ...poolInput, memberIds: [A, OUTSIDER] })).rejects.toThrow(
      /member of this workspace/,
    )
    expect(mocks.tables.crm_routing_rules).toEqual([])
    expect(mocks.audits).toEqual([])
  })

  it('adds a new rule last, as a draft, and audits it', async () => {
    mocks.tables.crm_routing_rules = [rule({ id: 'r1', position: 0 }), rule({ id: 'r2', position: 4 })]

    await lib.createRule(WS, ADMIN, poolInput)

    const created = mocks.tables.crm_routing_rules.at(-1)!
    expect(created).toMatchObject({ workspace_id: WS, position: 5, status: 'draft', created_by: ADMIN })
    expect(mocks.audits).toEqual([expect.objectContaining({ action: 'crm.routing_rule.created' })])
  })

  it('refuses an edit made from a stale form, and writes nothing', async () => {
    mocks.tables.crm_routing_rules = [rule({ id: 'r1', version: 3, name: 'Current' })]

    await expect(lib.updateRule(WS, ADMIN, 'r1', 2, poolInput)).rejects.toThrow(/changed this rule/)
    expect(mocks.tables.crm_routing_rules[0]!.name).toBe('Current')
    expect(mocks.audits).toEqual([])
  })

  it('applies an edit made from the current version and audits before and after', async () => {
    mocks.tables.crm_routing_rules = [rule({ id: 'r1', version: 3, name: 'Current' })]

    await lib.updateRule(WS, ADMIN, 'r1', 3, poolInput)

    expect(mocks.tables.crm_routing_rules[0]!.name).toBe('Sales')
    expect(mocks.audits[0]).toMatchObject({ action: 'crm.routing_rule.updated', before: expect.objectContaining({ name: 'Current' }) })
  })

  it('cannot reach a rule in another workspace', async () => {
    mocks.tables.crm_routing_rules = [rule({ id: 'r1', workspace_id: OTHER_WS })]
    await expect(lib.setRuleStatus(WS, ADMIN, 'r1', 'published')).rejects.toThrow(RoutingRuleError)
    expect(mocks.tables.crm_routing_rules[0]!.status).toBe('draft')
  })

  it('stamps published_at when a rule goes live', async () => {
    mocks.tables.crm_routing_rules = [rule({ id: 'r1' })]
    await lib.setRuleStatus(WS, ADMIN, 'r1', 'published')
    expect(mocks.tables.crm_routing_rules[0]).toMatchObject({ status: 'published', published_at: expect.any(String) })
  })
})

describe('order', () => {
  it('moving a rule renumbers the list 0..n-1 in the new order, even through tied positions', async () => {
    mocks.tables.crm_routing_rules = [
      rule({ id: 'r1', position: 0, created_at: '1' }),
      rule({ id: 'r2', position: 3, created_at: '2' }),
      rule({ id: 'r3', position: 3, created_at: '3' }),
    ]

    await lib.moveRule(WS, ADMIN, 'r3', 'up')

    const byId = Object.fromEntries(mocks.tables.crm_routing_rules.map((r) => [r.id, r.position]))
    expect(byId).toEqual({ r1: 0, r3: 1, r2: 2 })
    expect(mocks.audits[0]).toMatchObject({ action: 'crm.routing_rule.moved' })
  })

  it('moving the first rule up changes nothing', async () => {
    mocks.tables.crm_routing_rules = [rule({ id: 'r1', position: 0 }), rule({ id: 'r2', position: 1 })]
    await lib.moveRule(WS, ADMIN, 'r1', 'up')
    expect(mocks.tables.crm_routing_rules.map((r) => r.position)).toEqual([0, 1])
    expect(mocks.audits).toEqual([])
  })
})

describe('availability', () => {
  it('reports a return date that has passed as available, and keeps one still ahead', async () => {
    /*
     * ⚠️ ADDED BECAUSE BREAKING IT CHANGED NOTHING. Returning `away_until`
     * as stored left every other test green, so the screen would have shown
     * someone back from leave as "away" indefinitely — while routing, which
     * compares against now, was already giving them leads.
     */
    mocks.tables.workspace_memberships = [
      { workspace_id: WS, user_id: A, role: 'setter', away_until: '2026-09-10T00:00:00.000Z', created_at: '1' },
      { workspace_id: WS, user_id: B, role: 'setter', away_until: '2026-09-20T00:00:00.000Z', created_at: '2' },
    ]

    const rows = await lib.listAvailability(WS, new Date('2026-09-15T12:00:00.000Z'))

    expect(rows.map((r) => [r.userId, r.awayUntil])).toEqual([
      [A, null],
      [B, '2026-09-20T00:00:00.000Z'],
    ])
  })

  it('refuses someone who is not a member of this workspace', async () => {
    await expect(lib.setAwayUntil(WS, ADMIN, OUTSIDER, '2026-10-01T00:00:00Z')).rejects.toThrow(/not a member/)
    expect(mocks.tables.workspace_memberships.find((m) => m.user_id === OUTSIDER)!.away_until).toBeNull()
  })
})

describe('the Unassigned queue', () => {
  it('shows each waiting lead once, newest decision, and only while still unowned and not deleted', async () => {
    mocks.tables.crm_routing_decisions = [
      { workspace_id: WS, contact_id: 'c1', outcome: 'unassigned', reason: 'no_rule_matched', evaluated: [], created_at: '2026-09-10' },
      { workspace_id: WS, contact_id: 'c1', outcome: 'unassigned', reason: 'no_eligible_owner', evaluated: [{ kind: 'pool', reason: 'no_eligible_owner' }], created_at: '2026-09-12' },
      { workspace_id: WS, contact_id: 'c2', outcome: 'unassigned', reason: 'no_rule_matched', evaluated: [], created_at: '2026-09-11' },
      { workspace_id: WS, contact_id: 'c3', outcome: 'unassigned', reason: 'no_rule_matched', evaluated: [], created_at: '2026-09-11' },
      { workspace_id: OTHER_WS, contact_id: 'c9', outcome: 'unassigned', reason: 'no_rule_matched', evaluated: [], created_at: '2026-09-13' },
    ]
    mocks.tables.crm_contacts = [
      { id: 'c1', workspace_id: WS, full_name: 'Waiting', owner_user_id: null, deleted_at: null },
      { id: 'c2', workspace_id: WS, full_name: 'Assigned by hand since', owner_user_id: A, deleted_at: null },
      { id: 'c3', workspace_id: WS, full_name: 'Undone import', owner_user_id: null, deleted_at: '2026-09-12' },
      { id: 'c9', workspace_id: OTHER_WS, full_name: 'Other tenant', owner_user_id: null, deleted_at: null },
    ]

    const queue = await lib.listUnassignedQueue(WS)

    expect(queue).toEqual([
      {
        contactId: 'c1',
        name: 'Waiting',
        reason: 'no_eligible_owner',
        evaluated: [{ kind: 'pool', reason: 'no_eligible_owner' }],
        decidedAt: '2026-09-12',
      },
    ])
  })
})

describe('routing a lead again', () => {
  const waiting = { id: 'c1', workspace_id: WS, owner_user_id: null, deleted_at: null, source: 'csv_import' }

  it('refuses a lead that already has an owner, is deleted, or was added by hand — without routing', async () => {
    for (const contact of [
      { ...waiting, owner_user_id: A },
      { ...waiting, deleted_at: '2026-09-12' },
      { ...waiting, source: 'manual' },
    ]) {
      mocks.tables.crm_contacts = [contact]
      await expect(lib.routeContactAgain(WS, 'c1')).rejects.toThrow(RoutingRuleError)
    }
    expect(mocks.rpcCalls).toEqual([])
  })

  it('uses a fresh review key each time, never the original intake key', async () => {
    /*
     * ⚠️ THE ORIGINAL KEY WOULD REPLAY THE ORIGINAL "UNASSIGNED" — once per
     * intake doing its job — and the lead would never move.
     */
    mocks.tables.crm_contacts = [waiting]
    mocks.rpcResult = { data: { outcome: 'unassigned', reason: 'no_eligible_owner' }, error: null }

    await lib.routeContactAgain(WS, 'c1', new Date('2026-09-15T10:00:00.000Z'))
    await lib.routeContactAgain(WS, 'c1', new Date('2026-09-15T11:00:00.000Z'))

    const keys = mocks.rpcCalls.map((c) => c.args.p_intake_key)
    expect(keys[0]).toMatch(/^review:c1:/)
    expect(new Set(keys).size).toBe(2)
    expect(mocks.rpcCalls[0]!.args).toMatchObject({ p_workspace_id: WS, p_contact_id: 'c1', p_source: 'csv_import' })
  })

  it('announces only a real assignment', async () => {
    mocks.tables.crm_contacts = [waiting]

    mocks.rpcResult = { data: { outcome: 'unassigned', reason: 'no_eligible_owner', chosen_owner: null, activity_id: null }, error: null }
    await lib.routeContactAgain(WS, 'c1')
    expect(mocks.events).toEqual([])

    mocks.rpcResult = { data: { outcome: 'assigned', reason: 'rule_matched', chosen_owner: B, activity_id: 'act-1' }, error: null }
    const result = await lib.routeContactAgain(WS, 'c1')
    expect(result).toEqual({ outcome: 'assigned', reason: 'rule_matched' })
    expect(mocks.events).toEqual([
      expect.objectContaining({ triggerType: 'contact_assigned', idempotencyKey: 'contact_assigned:act-1', payload: { contactId: 'c1', to: B, by: 'routing' } }),
    ])
  })
})
