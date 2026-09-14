/**
 * ROUND_ROBIN hands the whole decision to the database, and reports it honestly.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE RACE IS NOT TESTED HERE, BECAUSE IT NO LONGER LIVES HERE.            ║
 * ║                                                                           ║
 * ║  The handler used to count every candidate, pick the lowest, then        ║
 * ║  update — three statements with nothing held between them, so two runs   ║
 * ║  starting together both chose the same person. That was reproduced       ║
 * ║  deterministically in this file before the fix:                          ║
 * ║                                                                           ║
 * ║      count(a1)=0  count(a2)=0      <- run A counts                        ║
 * ║      count(a1)=0  count(a2)=0      <- run B counts, sees nothing yet      ║
 * ║      assign(c1 -> a1)                                                     ║
 * ║      assign(c2 -> a1)              <- both leads, same person             ║
 * ║                                                                           ║
 * ║  0125 moved count, decision and write into one transaction under a       ║
 * ║  workspace advisory lock. A stubbed `rpc` cannot demonstrate a database   ║
 * ║  lock — the stub would decide the answer itself and the test would prove ║
 * ║  only that the stub works. The lock is proven where it lives: the smoke  ║
 * ║  file and the two-session concurrency check against real Postgres.       ║
 * ║                                                                           ║
 * ║  What IS this file's job is the TypeScript's remaining responsibility,   ║
 * ║  and the most dangerous regression is the obvious one: somebody "helps"  ║
 * ║  by reinstating a count or an update next to the RPC call, and the race  ║
 * ║  is back with every test still green.                                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * Fixtures are fabricated.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const WS = '00000000-0000-4000-8000-000000000001'
const ALEX = '00000000-0000-4000-8000-0000000000a1'
const SAM = '00000000-0000-4000-8000-0000000000a2'
const LEAD = '00000000-0000-4000-8000-0000000000c1'
const ACTIVITY = '00000000-0000-4000-8000-0000000000e1'

const mocks = vi.hoisted(() => ({
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  rpcResult: { data: null as unknown, error: null as unknown },
  /** Any table access at all — the handler should make none. */
  tableAccess: [] as string[],
  events: [] as Record<string, unknown>[],
  activities: 0,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/crm/activities', () => ({
  recordActivity: async () => {
    mocks.activities += 1
    return 'should-not-be-written-here'
  },
}))
vi.mock('@/lib/crm/opportunities', () => ({
  createOpportunity: async () => undefined,
  moveStage: async () => undefined,
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
      mocks.tableAccess.push(table)
      throw new Error(`ROUND_ROBIN touched ${table} directly`)
    },
  }),
}))

const { handlerFor } = await import('@/lib/flows/engine')
const { registerCrmActions } = await import('@/lib/flows/actions/crm')
// Registration is explicit rather than an import side effect, so the test asks
// for it the same way the worker does.
registerCrmActions()

const roundRobin = () => {
  const handler = handlerFor('ROUND_ROBIN')
  expect(handler, 'ROUND_ROBIN has no registered handler').toBeDefined()
  return handler!
}

function context(contactId: string | null = LEAD) {
  return { workspaceId: WS, runId: 'run-1', contactId, publisherUserId: null, variables: {} }
}

beforeEach(() => {
  mocks.rpcCalls = []
  mocks.rpcResult = {
    data: { changed: true, activity_id: ACTIVITY, from: null, assigned_to: SAM },
    error: null,
  }
  mocks.tableAccess = []
  mocks.events = []
  mocks.activities = 0
})

describe('the decision belongs to the database', () => {
  it('makes exactly one call, to crm_round_robin_assign, with the whole pool', async () => {
    const result = await roundRobin()(context() as never, { userIds: [ALEX, SAM] })

    expect(result.ok).toBe(true)
    expect(mocks.rpcCalls).toEqual([
      {
        fn: 'crm_round_robin_assign',
        args: { p_workspace_id: WS, p_contact_id: LEAD, p_user_ids: [ALEX, SAM] },
      },
    ])
  })

  it('never reads or writes a table itself', async () => {
    /*
     * ⚠️ THIS IS THE REGRESSION GUARD FOR THE RACE. A count before the call,
     * or an update after it, reopens the read-decide-write window 0125 closed —
     * and would do so with every other test in the suite still passing. The
     * stub throws on any `from()`, so there is no way to add one quietly.
     */
    await roundRobin()(context() as never, { userIds: [ALEX, SAM] })

    expect(mocks.tableAccess).toEqual([])
  })

  it('does not write the audit row a second time', async () => {
    // 0125 writes OWNER_ASSIGNED through 0123, inside the same transaction.
    // Recording it again here would put two handovers on the timeline, and
    // crm_activities is append-only — the duplicate could never be removed.
    await roundRobin()(context() as never, { userIds: [ALEX, SAM] })

    expect(mocks.activities).toBe(0)
  })

  it('reports whoever the database chose, not the first in the pool', async () => {
    const result = await roundRobin()(context() as never, { userIds: [ALEX, SAM] })

    expect(result).toEqual({ ok: true, output: { assignedTo: SAM } })
  })
})

describe('the event', () => {
  it('is keyed on the activity the database wrote', async () => {
    await roundRobin()(context() as never, { userIds: [ALEX, SAM] })

    expect(mocks.events).toHaveLength(1)
    expect(mocks.events[0]).toMatchObject({
      triggerType: 'contact_assigned',
      idempotencyKey: `contact_assigned:${ACTIVITY}`,
      payload: { contactId: LEAD, to: SAM, by: 'flow_round_robin' },
    })
  })

  it('is not emitted when nothing changed', async () => {
    /*
     * 0123 returns `changed: false, activity_id: null` when the contact already
     * belongs to the chosen person. Announcing an assignment that did not
     * happen would start every "on assigned" flow for a contact that never
     * moved.
     */
    mocks.rpcResult = {
      data: { changed: false, activity_id: null, from: SAM, assigned_to: SAM },
      error: null,
    }

    const result = await roundRobin()(context() as never, { userIds: [ALEX, SAM] })

    expect(result.ok).toBe(true)
    expect(mocks.events).toEqual([])
  })
})

describe('failure', () => {
  it('is retryable when the database refuses', async () => {
    mocks.rpcResult = { data: null, error: { message: 'no such contact in workspace' } }

    const result = await roundRobin()(context() as never, { userIds: [ALEX, SAM] })

    expect(result).toMatchObject({ ok: false, code: 'ASSIGN_FAILED', retryable: true })
    expect(mocks.events).toEqual([])
  })

  it('fails rather than reporting success when no one was assigned', async () => {
    // A response with no `assigned_to` is not a success with a blank owner.
    mocks.rpcResult = { data: { changed: true, activity_id: ACTIVITY }, error: null }

    const result = await roundRobin()(context() as never, { userIds: [ALEX, SAM] })

    expect(result).toMatchObject({ ok: false, code: 'ASSIGN_FAILED' })
    expect(mocks.events).toEqual([])
  })

  it('refuses an empty pool before calling the database', async () => {
    const result = await roundRobin()(context() as never, { userIds: [] })

    expect(result).toMatchObject({ ok: false, code: 'NO_POOL' })
    expect(mocks.rpcCalls).toEqual([])
  })

  it('refuses a step with no contact before calling the database', async () => {
    const result = await roundRobin()(context(null) as never, { userIds: [ALEX] })

    expect(result).toMatchObject({ ok: false, code: 'NO_CONTACT' })
    expect(mocks.rpcCalls).toEqual([])
  })
})

describe('the source, read directly', () => {
  /*
   * The stub above proves behaviour for the calls the handler makes today. This
   * pins the shape so a future edit cannot route around the stub — for example
   * by importing a second client.
   */
  const SRC = readFileSync(join(__dirname, '..', '..', 'lib', 'flows', 'actions', 'crm.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*\r?\n/g, '\n')

  const body = (() => {
    const start = SRC.indexOf('const roundRobin: ActionHandler')
    const end = SRC.indexOf('const createTask: ActionHandler')
    expect(start, 'roundRobin handler not found').toBeGreaterThan(-1)
    expect(end, 'end of roundRobin handler not found').toBeGreaterThan(start)
    return SRC.slice(start, end)
  })()

  it('contains no count and no update of crm_contacts', () => {
    expect(body).not.toMatch(/count:\s*'exact'/)
    expect(body).not.toMatch(/\.update\(/)
    expect(body).not.toMatch(/from\(\s*'crm_contacts'\s*\)/)
  })
})
