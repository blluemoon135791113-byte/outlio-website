/**
 * Retrying waiting leads announces exactly what the database placed, in the
 * workspace the database says each lead belongs to.
 *
 * Which leads are due — and that polling again retries nothing — is decided
 * and proven in 0128 and its smoke file against real Postgres. This file owns
 * the announcement and the tick wiring.
 *
 * Fixtures are fabricated.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const WS1 = '00000000-0000-4000-8000-000000000001'
const WS2 = '00000000-0000-4000-8000-000000000002'

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

const { retryWaitingLeads } = await import('@/lib/crm/routing')

beforeEach(() => {
  mocks.rpcCalls = []
  mocks.events = []
  mocks.rpcResult = {
    data: { retried: 0, assigned: 0, unassigned: 0, already_owned: 0, failed: 0, assignments: [] },
    error: null,
  }
})

describe('retryWaitingLeads', () => {
  it('asks the database for a bounded retry', async () => {
    await retryWaitingLeads(100)
    expect(mocks.rpcCalls).toEqual([{ fn: 'crm_retry_waiting_leads', args: { p_limit: 100 } }])
  })

  it('announces each placement in the lead’s own workspace, keyed on its activity', async () => {
    mocks.rpcResult = {
      data: {
        // Every count distinct, so a summary that drops or swaps one cannot pass.
        retried: 4,
        assigned: 2,
        unassigned: 1,
        already_owned: 3,
        failed: 5,
        assignments: [
          { workspace_id: WS1, contact_id: 'c1', owner: 'u1', activity_id: 'a1' },
          { workspace_id: WS2, contact_id: 'c2', owner: 'u2', activity_id: 'a2' },
        ],
      },
      error: null,
    }

    const summary = await retryWaitingLeads(100)

    expect(mocks.events).toEqual([
      {
        workspaceId: WS1,
        triggerType: 'contact_assigned',
        contactId: 'c1',
        idempotencyKey: 'contact_assigned:a1',
        payload: { contactId: 'c1', to: 'u1', by: 'routing' },
      },
      {
        workspaceId: WS2,
        triggerType: 'contact_assigned',
        contactId: 'c2',
        idempotencyKey: 'contact_assigned:a2',
        payload: { contactId: 'c2', to: 'u2', by: 'routing' },
      },
    ])
    expect(summary).toEqual({ retried: 4, assigned: 2, unassigned: 1, alreadyOwned: 3, failed: 5 })
  })

  it('announces nothing when nothing new was placed', async () => {
    await retryWaitingLeads(100)
    expect(mocks.events).toEqual([])
  })

  it('throws on a database error, for the tick to record', async () => {
    mocks.rpcResult = { data: null, error: { message: 'boom' } }
    await expect(retryWaitingLeads(100)).rejects.toThrow(/retryWaitingLeads failed/)
    expect(mocks.events).toEqual([])
  })
})

describe('the tick', () => {
  const tick = readFileSync(join(process.cwd(), 'lib/workers/tick.ts'), 'utf8')

  it('retries waiting leads before rolling up reports, which count the assignments', () => {
    const retry = tick.indexOf("runJob(result, 'retry_routing'")
    const rollup = tick.indexOf("runJob(result, 'rollup_reporting'")
    expect(retry).toBeGreaterThan(-1)
    expect(rollup).toBeGreaterThan(retry)
  })

  it('passes the bounded limit, not an unbounded one', () => {
    expect(tick).toMatch(/retryWaitingLeads\(LIMITS\.waitingLeadsPerTick\)/)
  })
})
