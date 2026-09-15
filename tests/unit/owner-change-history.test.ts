/**
 * Bulk assignment and member handover announce exactly the changes the
 * database recorded.
 *
 * What the functions do — history rows, the membership check, one transaction,
 * open tasks only — is proven in 0129 and its smoke file against real
 * Postgres. This file owns what TypeScript adds: the call, the error mapping,
 * and one `contact_assigned` per new OWNER_ASSIGNED row, keyed on it.
 *
 * Fixtures are fabricated.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const WS = '00000000-0000-4000-8000-000000000001'
const ACTOR = '00000000-0000-4000-8000-0000000000ad'
const FROM = '00000000-0000-4000-8000-0000000000a1'
const TO = '00000000-0000-4000-8000-0000000000b1'

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

const { bulkAssignContacts, NotAMemberError } = await import('@/lib/crm/activities')
const { announceHandover, reassignMemberRecords } = await import('@/lib/workspaces/handover')

beforeEach(() => {
  mocks.rpcCalls = []
  mocks.events = []
  mocks.rpcResult = { data: null, error: null }
})

describe('bulkAssignContacts', () => {
  it('asks the database to assign the selection, scoped to the workspace, as the actor', async () => {
    mocks.rpcResult = { data: { changed: 0, unchanged: 0, skipped: 0, assignments: [] }, error: null }

    await bulkAssignContacts(WS, ['c1', 'c2'], TO, ACTOR)

    expect(mocks.rpcCalls).toEqual([
      {
        fn: 'crm_bulk_assign_contacts',
        args: { p_workspace_id: WS, p_contact_ids: ['c1', 'c2'], p_new_owner: TO, p_actor_id: ACTOR },
      },
    ])
  })

  it('passes null to unassign', async () => {
    mocks.rpcResult = { data: { changed: 0, unchanged: 0, skipped: 0, assignments: [] }, error: null }
    await bulkAssignContacts(WS, ['c1'], null, ACTOR)
    expect(mocks.rpcCalls[0]!.args.p_new_owner).toBeNull()
  })

  it('announces each change once, keyed on its activity, with where it came from', async () => {
    mocks.rpcResult = {
      data: {
        // Distinct counts, so a summary that drops or swaps one cannot pass.
        changed: 2,
        unchanged: 3,
        skipped: 4,
        assignments: [
          { contact_id: 'c1', from: FROM, activity_id: 'a1' },
          { contact_id: 'c2', from: null, activity_id: 'a2' },
        ],
      },
      error: null,
    }

    const result = await bulkAssignContacts(WS, ['c1', 'c2', 'c3'], TO, ACTOR)

    expect(result).toEqual({ changed: 2, unchanged: 3, skipped: 4 })
    expect(mocks.events).toEqual([
      {
        workspaceId: WS,
        triggerType: 'contact_assigned',
        contactId: 'c1',
        idempotencyKey: 'contact_assigned:a1',
        payload: { contactId: 'c1', from: FROM, to: TO },
      },
      {
        workspaceId: WS,
        triggerType: 'contact_assigned',
        contactId: 'c2',
        idempotencyKey: 'contact_assigned:a2',
        payload: { contactId: 'c2', from: null, to: TO },
      },
    ])
  })

  it('reports an outsider as a named error the action can show, and announces nothing', async () => {
    mocks.rpcResult = {
      data: null,
      error: { message: 'crm_bulk_assign_contacts: new owner is not a member of this workspace' },
    }

    await expect(bulkAssignContacts(WS, ['c1'], TO, ACTOR)).rejects.toBeInstanceOf(NotAMemberError)
    expect(mocks.events).toEqual([])
  })

  it('does not dress up any other failure as a membership problem', async () => {
    mocks.rpcResult = { data: null, error: { message: 'at most 200 contacts at a time' } }
    const failure = await bulkAssignContacts(WS, ['c1'], TO, ACTOR).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(Error)
    expect(failure).not.toBeInstanceOf(NotAMemberError)
  })
})

describe('reassignMemberRecords', () => {
  it('hands the book over in one database call, as the actor', async () => {
    mocks.rpcResult = {
      data: { contacts: 0, companies: 0, opportunities: 0, tasks: 0, assignments: [] },
      error: null,
    }

    await reassignMemberRecords(WS, FROM, TO, ACTOR)

    expect(mocks.rpcCalls).toEqual([
      {
        fn: 'crm_handover_member_records',
        args: { p_workspace_id: WS, p_from_user: FROM, p_to_user: TO, p_actor_id: ACTOR },
      },
    ])
  })

  /*
   * ⚠️ IT DOES NOT ANNOUNCE. The caller deletes the membership first and
   * announces after the response: awaiting thousands of events here let a
   * timeout strand a removal whose records had already moved.
   */
  it('returns what moved and the contacts to announce, without announcing them', async () => {
    mocks.rpcResult = {
      data: {
        contacts: 5,
        companies: 2,
        opportunities: 3,
        tasks: 4,
        assignments: [{ contact_id: 'c1', activity_id: 'a9' }],
      },
      error: null,
    }

    const result = await reassignMemberRecords(WS, FROM, null, ACTOR)

    expect(result).toEqual({
      contacts: 5,
      companies: 2,
      opportunities: 3,
      tasks: 4,
      assignments: [{ contactId: 'c1', activityId: 'a9' }],
    })
    expect(mocks.events).toEqual([])
  })

  it('keeps the message the member-removal flow and its integration test rely on', async () => {
    mocks.rpcResult = {
      data: null,
      error: { message: 'crm_handover_member_records: the new owner is not in this workspace' },
    }
    await expect(reassignMemberRecords(WS, FROM, TO, ACTOR)).rejects.toThrow(/not in this workspace/)
    expect(mocks.events).toEqual([])
  })

  it('names a handover to the departing member rather than a generic failure', async () => {
    mocks.rpcResult = {
      data: null,
      error: { message: 'crm_handover_member_records: the new owner is the departing member' },
    }
    await expect(reassignMemberRecords(WS, FROM, FROM, ACTOR)).rejects.toThrow(/departing member/)
  })
})

describe('announceHandover', () => {
  it('announces each contact that changed hands once, keyed on its activity', async () => {
    await announceHandover(WS, FROM, null, [
      { contactId: 'c1', activityId: 'a9' },
      { contactId: 'c2', activityId: 'a10' },
    ])

    expect(mocks.events).toEqual([
      {
        workspaceId: WS,
        triggerType: 'contact_assigned',
        contactId: 'c1',
        idempotencyKey: 'contact_assigned:a9',
        payload: { contactId: 'c1', from: FROM, to: null },
      },
      {
        workspaceId: WS,
        triggerType: 'contact_assigned',
        contactId: 'c2',
        idempotencyKey: 'contact_assigned:a10',
        payload: { contactId: 'c2', from: FROM, to: null },
      },
    ])
  })
})
