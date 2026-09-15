/**
 * A flow's assignment steps leave an owned contact with its owner.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THESE STEPS WERE TAKING CONTACTS FROM THE MEMBERS WHO ADDED THEM.     ║
 * ║                                                                           ║
 * ║  `contact_created` is emitted only when a member adds someone by hand,    ║
 * ║  and that path makes the member the owner. ASSIGN_OWNER updated           ║
 * ║  unconditionally, so a flow on that trigger reassigned the contact away   ║
 * ║  from them — production shows two contacts added by hand on 2026-09-03   ║
 * ║  reassigned about two minutes later, `by: flow`. §5: "Creator ownership   ║
 * ║  takes precedence for member-added records."                              ║
 * ║                                                                           ║
 * ║  Owner decision, 2026-09-14: assignment steps skip an owned contact.      ║
 * ║                                                                           ║
 * ║  ⚠️ A SKIP IS NOT A SUCCESS AND NOT A FAILURE. As a success it would      ║
 * ║  announce an assignment that did not happen; as a failure it would halt   ║
 * ║  a run that did exactly the right thing.                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * Fixtures are fabricated.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const WS = '00000000-0000-4000-8000-000000000001'
const CREATOR = '00000000-0000-4000-8000-0000000000a1'
const TARGET = '00000000-0000-4000-8000-0000000000b1'
const CONTACT = '00000000-0000-4000-8000-0000000000c1'

const mocks = vi.hoisted(() => ({
  /** Current owner of CONTACT, or undefined when the contact does not exist. */
  owner: undefined as string | null | undefined,
  updates: [] as { patch: Record<string, unknown>; filters: Record<string, unknown> }[],
  activities: 0,
  events: [] as Record<string, unknown>[],
  rpcResult: { data: null as unknown, error: null as unknown },
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/crm/activities', () => ({
  recordActivity: async () => {
    mocks.activities += 1
    return 'activity-1'
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

/**
 * ⚠️ THE STUB HONOURS `.is('owner_user_id', null)`. A stub that ignored the
 * condition would claim an owned contact and let an unconditional update pass
 * every test here — the defect this file exists to catch.
 */
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: async () => mocks.rpcResult,
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        const filters: Record<string, unknown> = {}
        const b = {
          eq: (c: string, v: unknown) => {
            filters[c] = v
            return b
          },
          is: (c: string, v: unknown) => {
            filters[`is:${c}`] = v
            return b
          },
          select: async () => {
            mocks.updates.push({ patch, filters })
            const exists = mocks.owner !== undefined
            const requiresUnowned = 'is:owner_user_id' in filters
            const claimable = exists && (!requiresUnowned || mocks.owner === null)
            if (claimable) mocks.owner = patch.owner_user_id as string
            return { data: claimable ? [{ id: CONTACT }] : [], error: null }
          },
        }
        return b
      },
      select: () => {
        const b = {
          eq: () => b,
          maybeSingle: async () => ({
            data: mocks.owner === undefined ? null : { owner_user_id: mocks.owner },
            error: null,
          }),
        }
        return b
      },
    }),
  }),
}))

const { handlerFor } = await import('@/lib/flows/engine')
const { registerCrmActions } = await import('@/lib/flows/actions/crm')
registerCrmActions()

const ctx = { workspaceId: WS, runId: 'run-1', contactId: CONTACT, publisherUserId: null, facts: {} }

beforeEach(() => {
  mocks.owner = null
  mocks.updates = []
  mocks.activities = 0
  mocks.events = []
  mocks.rpcResult = { data: null, error: null }
})

describe('ASSIGN_OWNER', () => {
  const assign = () => handlerFor('ASSIGN_OWNER')!(ctx as never, { userId: TARGET })

  it('claims an unowned contact, conditionally, and records it', async () => {
    const result = await assign()

    expect(result).toMatchObject({ ok: true, output: { assignedTo: TARGET } })
    expect(result).not.toHaveProperty('skipped')
    expect(mocks.updates[0]!.filters).toMatchObject({ 'is:owner_user_id': null, workspace_id: WS })
    expect(mocks.activities).toBe(1)
    expect(mocks.events).toHaveLength(1)
  })

  it('leaves a contact a member added with that member, and says so as a skip', async () => {
    mocks.owner = CREATOR

    const result = await assign()

    expect(mocks.owner, 'the creator lost their contact').toBe(CREATOR)
    expect(result).toMatchObject({
      ok: true,
      output: { assignedTo: CREATOR },
      skipped: { code: 'ALREADY_OWNED' },
    })
    expect(mocks.activities, 'an assignment that did not happen was recorded').toBe(0)
    expect(mocks.events, 'an assignment that did not happen was announced').toEqual([])
  })

  it('fails, rather than skipping, when the contact is gone', async () => {
    mocks.owner = undefined

    const result = await assign()

    expect(result).toMatchObject({ ok: false, code: 'NO_CONTACT' })
  })
})

describe('ROUND_ROBIN', () => {
  const roundRobin = () =>
    handlerFor('ROUND_ROBIN')!(ctx as never, { userIds: [TARGET, CREATOR] })

  it('reports 0127’s skip as a skip, naming the owner it kept', async () => {
    mocks.rpcResult = {
      data: { changed: false, skipped: true, reason: 'already_owned', activity_id: null, from: CREATOR },
      error: null,
    }

    const result = await roundRobin()

    expect(result).toMatchObject({
      ok: true,
      output: { assignedTo: CREATOR },
      skipped: { code: 'ALREADY_OWNED' },
    })
    expect(mocks.events).toEqual([])
  })

  it('still assigns and announces when the database assigned', async () => {
    mocks.rpcResult = {
      data: { changed: true, activity_id: 'act-9', from: null, assigned_to: TARGET },
      error: null,
    }

    const result = await roundRobin()

    expect(result).toEqual({ ok: true, output: { assignedTo: TARGET } })
    expect(mocks.events).toHaveLength(1)
  })
})
