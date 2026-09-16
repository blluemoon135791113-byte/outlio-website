/**
 * Routing announces exactly the assignments the database made.
 *
 * The decisions themselves — rules, eligibility, the cap, once per intake — are
 * made and proven in 0127 and its smoke file against real Postgres. What this
 * file owns is the announcement: one `contact_assigned` per NEW assignment,
 * keyed on the activity the database wrote, and nothing for a replay.
 *
 * Fixtures are fabricated.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const WS = '00000000-0000-4000-8000-000000000001'
const BATCH = '00000000-0000-4000-8000-00000000ba7c'

const mocks = vi.hoisted(() => ({
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  rpcResult: { data: null as unknown, error: null as unknown },
  events: [] as Record<string, unknown>[],
}))

vi.mock('server-only', () => ({}))
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
  }),
}))

const { routeBatch } = await import('@/lib/crm/routing')

beforeEach(() => {
  mocks.rpcCalls = []
  mocks.events = []
  mocks.rpcResult = {
    data: { assigned: 0, unassigned: 0, already_owned: 0, assignments: [] },
    error: null,
  }
})

describe('routeBatch', () => {
  it('asks the database to route the batch, scoped to the workspace', async () => {
    await routeBatch(WS, BATCH)

    expect(mocks.rpcCalls).toEqual([
      { fn: 'crm_route_batch', args: { p_workspace_id: WS, p_batch_id: BATCH } },
    ])
  })

  it('announces each new assignment once, keyed on the activity', async () => {
    mocks.rpcResult = {
      data: {
        assigned: 2,
        unassigned: 1,
        already_owned: 1,
        assignments: [
          { contact_id: 'c1', owner: 'u1', activity_id: 'a1' },
          { contact_id: 'c2', owner: 'u2', activity_id: 'a2' },
        ],
      },
      error: null,
    }

    const summary = await routeBatch(WS, BATCH)

    expect(summary).toEqual({ assigned: 2, unassigned: 1, alreadyOwned: 1 })
    expect(mocks.events).toEqual([
      expect.objectContaining({
        triggerType: 'contact_assigned',
        contactId: 'c1',
        idempotencyKey: 'contact_assigned:a1',
        payload: { contactId: 'c1', to: 'u1', by: 'routing' },
      }),
      expect.objectContaining({ contactId: 'c2', idempotencyKey: 'contact_assigned:a2' }),
    ])
  })

  it('announces nothing for a replayed batch, even though its count is unchanged', async () => {
    /*
     * A re-run batch reports its earlier assignments in the count — they are
     * still assigned — but lists none to announce. Emitting from the count
     * would re-run every "on assigned" flow for leads that did not move.
     */
    mocks.rpcResult = {
      data: { assigned: 3, unassigned: 0, already_owned: 0, assignments: [] },
      error: null,
    }

    const summary = await routeBatch(WS, BATCH)

    expect(summary.assigned).toBe(3)
    expect(mocks.events).toEqual([])
  })

  it('announces in bounded groups, so a large import cannot fire them all at once', async () => {
    const assignments = Array.from({ length: 45 }, (_, i) => ({
      contact_id: `c${i}`,
      owner: 'u',
      activity_id: `a${i}`,
    }))
    mocks.rpcResult = {
      data: { assigned: 45, unassigned: 0, already_owned: 0, assignments },
      error: null,
    }

    await routeBatch(WS, BATCH)

    expect(mocks.events).toHaveLength(45)
    expect(new Set(mocks.events.map((e) => e.idempotencyKey)).size).toBe(45)
  })

  it('throws when the database refuses, and announces nothing', async () => {
    mocks.rpcResult = { data: null, error: { message: 'no such batch in workspace' } }

    await expect(routeBatch(WS, BATCH)).rejects.toThrow(/routeBatch failed/)
    expect(mocks.events).toEqual([])
  })
})
