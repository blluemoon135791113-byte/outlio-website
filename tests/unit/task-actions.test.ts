/**
 * My Work's task actions, and the task list's toggle, go through 0126.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE DATABASE DECIDES; THIS FILE CHECKS WHAT THE SERVER ACTIONS OWN.     ║
 * ║                                                                           ║
 * ║  Staleness, membership, "not yours" and the audit row are enforced by the ║
 * ║  0126 functions and proven by their smoke file against real Postgres. A   ║
 * ║  stubbed `rpc` cannot prove any of that. What the TypeScript still owns — ║
 * ║  and can silently get wrong — is:                                         ║
 * ║                                                                           ║
 * ║   • which permission gates each action                                    ║
 * ║   • passing a setter's restriction, and NOT passing one for a manager     ║
 * ║   • passing the version the screen saw, and refusing when there is none   ║
 * ║   • routing the task list's toggle through the function at all — the old  ║
 * ║     direct update is what lost the history of contactless tasks          ║
 * ║   • clearing `outcome` on reopen, which 0126's constraint requires        ║
 * ║   • announcing a completion only when one happened                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * Fixtures are fabricated.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const WS = '00000000-0000-4000-8000-000000000001'
const SETTER = '00000000-0000-4000-8000-000000000002'
const MANAGER = '00000000-0000-4000-8000-000000000003'
const OTHER = '00000000-0000-4000-8000-000000000004'
const TASK = '00000000-0000-4000-8000-000000000010'

const mocks = vi.hoisted(() => ({
  role: 'setter' as 'setter' | 'manager',
  userId: '',
  denied: new Set<string>(),
  gates: [] as string[],
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  rpcResult: { data: null as unknown, error: null as unknown },
  updates: [] as { table: string; patch: Record<string, unknown>; filters: Record<string, unknown> }[],
  updateResult: { data: null as unknown, error: null as unknown },
  events: [] as Record<string, unknown>[],
  activities: 0,
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

vi.mock('@/lib/workspaces/context', () => ({
  assertWorkspacePermission: async (permission: string) => {
    mocks.gates.push(permission)
    if (mocks.denied.has(permission)) throw new Error('denied')
    return { userId: mocks.userId, role: mocks.role, workspace: { id: WS } }
  },
}))

vi.mock('@/lib/events/emit', () => ({
  emitDomainEvent: async (event: Record<string, unknown>) => {
    mocks.events.push(event)
  },
}))

vi.mock('@/lib/crm/activities', () => ({
  recordActivity: async () => {
    mocks.activities += 1
    return 'activity'
  },
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      mocks.rpcCalls.push({ fn, args })
      return mocks.rpcResult
    },
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => {
        const filters: Record<string, unknown> = {}
        const builder = {
          eq: (column: string, value: unknown) => {
            filters[column] = value
            return builder
          },
          select: () => builder,
          maybeSingle: async () => {
            mocks.updates.push({ table, patch, filters })
            return mocks.updateResult
          },
        }
        return builder
      },
    }),
  }),
}))

const { completeTaskAction, reassignTaskAction, setTaskDone, snoozeTaskAction } = await import(
  '@/app/(product)/crm/tasks/actions'
)

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

const completed = (over: Record<string, unknown> = {}) => ({
  data: { ok: true, changed: true, activity_id: 'act', task_id: TASK, contact_id: null, version: 5, ...over },
  error: null,
})

beforeEach(() => {
  mocks.role = 'setter'
  mocks.userId = SETTER
  mocks.denied = new Set()
  mocks.gates = []
  mocks.rpcCalls = []
  mocks.rpcResult = completed()
  mocks.updates = []
  mocks.updateResult = { data: { id: TASK }, error: null }
  mocks.events = []
  mocks.activities = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe('completing', () => {
  it('gates on crm.task.manage and restricts a setter to their own task', async () => {
    const state = await completeTaskAction(
      null,
      form({ taskId: TASK, version: '4', outcome: '  Booked a demo  ' }),
    )

    expect(state?.ok).toBe(true)
    expect(mocks.gates).toEqual(['crm.task.manage'])
    expect(mocks.rpcCalls).toEqual([
      {
        fn: 'crm_complete_task',
        args: {
          p_workspace_id: WS,
          p_task_id: TASK,
          p_actor_id: SETTER,
          p_outcome: 'Booked a demo',
          p_expected_version: 4,
          p_restrict_to_assignee: SETTER,
        },
      },
    ])
  })

  it('does not restrict a manager, whose data scope is the whole workspace', async () => {
    // Sending the manager's own id as the restriction would make every task
    // assigned to someone else read as "not found" to the person allowed to act on it.
    mocks.role = 'manager'
    mocks.userId = MANAGER

    await completeTaskAction(null, form({ taskId: TASK, version: '1' }))

    expect(mocks.rpcCalls[0]!.args).not.toHaveProperty('p_restrict_to_assignee')
  })

  it('announces task_completed once, keyed on the task, after a real completion', async () => {
    await completeTaskAction(null, form({ taskId: TASK, version: '1' }))

    expect(mocks.events).toEqual([
      expect.objectContaining({
        triggerType: 'task_completed',
        idempotencyKey: `task_completed:${TASK}`,
        contactId: null,
      }),
    ])
  })

  it('refuses a stale screen with a reload message, and announces nothing', async () => {
    mocks.rpcResult = { data: { ok: false, reason: 'stale' }, error: null }

    const state = await completeTaskAction(null, form({ taskId: TASK, version: '1' }))

    expect(state?.ok).toBe(false)
    if (state && !state.ok) expect(state.error).toMatch(/changed this task/i)
    expect(mocks.events).toEqual([])
  })

  it('never reaches the database without a version', async () => {
    /*
     * ⚠️ DEFAULTING WOULD DEFEAT THE LOCK. "I cannot tell whether this screen
     * is stale" must not become "assume it is not".
     */
    for (const version of ['', '0', 'abc', '1.5']) {
      const state = await completeTaskAction(null, form({ taskId: TASK, version }))
      expect(state?.ok, `version ${JSON.stringify(version)} was accepted`).toBe(false)
    }
    expect(mocks.rpcCalls).toEqual([])
  })

  it('never sends an outcome over 500 characters', async () => {
    const state = await completeTaskAction(
      null,
      form({ taskId: TASK, version: '1', outcome: 'x'.repeat(501) }),
    )

    expect(state?.ok).toBe(false)
    expect(mocks.rpcCalls).toEqual([])
  })
})

describe('the task list toggle', () => {
  it('completes through crm_complete_task, not a direct update', async () => {
    /*
     * ⚠️ THE REGRESSION GUARD FOR THE CONTACTLESS-TASK BUG. The old path
     * updated crm_tasks and then called recordActivity with no subject, which
     * crm_activities_has_subject refused after the update had committed.
     */
    const state = await setTaskDone(null, form({ taskId: TASK, done: 'true', version: '2' }))

    expect(state?.ok).toBe(true)
    expect(mocks.rpcCalls.map((c) => c.fn)).toEqual(['crm_complete_task'])
    expect(mocks.rpcCalls[0]!.args).toMatchObject({ p_expected_version: 2, p_outcome: '' })
    expect(mocks.updates).toEqual([])
    expect(mocks.activities).toBe(0)
  })

  it('reopens by clearing the outcome, only a completed task, only the setter’s own', async () => {
    /*
     * ⚠️ `outcome: null` IS REQUIRED, NOT TIDY. 0126 refuses an open task that
     * still carries an outcome, so leaving it out makes every reopen of a task
     * completed with an outcome fail.
     */
    const state = await setTaskDone(null, form({ taskId: TASK, done: 'false' }))

    expect(state?.ok).toBe(true)
    expect(mocks.updates).toEqual([
      {
        table: 'crm_tasks',
        patch: { status: 'open', completed_at: null, completed_by: null, outcome: null },
        filters: {
          workspace_id: WS,
          id: TASK,
          status: 'completed',
          assigned_to_user_id: SETTER,
        },
      },
    ])
    expect(mocks.rpcCalls).toEqual([])
    expect(mocks.events).toEqual([])
  })

  it('does not limit a manager’s reopen to their own tasks', async () => {
    mocks.role = 'manager'
    mocks.userId = MANAGER

    await setTaskDone(null, form({ taskId: TASK, done: 'false' }))

    expect(mocks.updates[0]!.filters).not.toHaveProperty('assigned_to_user_id')
  })

  it('says so when there was nothing to reopen', async () => {
    mocks.updateResult = { data: null, error: null }

    const state = await setTaskDone(null, form({ taskId: TASK, done: 'false' }))

    expect(state?.ok).toBe(false)
  })
})

describe('snoozing', () => {
  it('sends the start of the chosen day as an instant, with the version and restriction', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-14T12:00:00.000Z'))

    const state = await snoozeTaskAction(null, form({ taskId: TASK, version: '3', until: '2026-09-20' }))

    expect(state?.ok).toBe(true)
    expect(mocks.rpcCalls).toEqual([
      {
        fn: 'crm_snooze_task',
        args: {
          p_workspace_id: WS,
          p_task_id: TASK,
          p_actor_id: SETTER,
          p_until: new Date('2026-09-20T00:00:00').toISOString(),
          p_expected_version: 3,
          p_restrict_to_assignee: SETTER,
        },
      },
    ])
  })

  it('never sends a date that has passed, is over a year away, or is not a date', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-14T12:00:00.000Z'))

    for (const until of ['2026-09-01', '2028-01-01', 'tomorrow', '']) {
      const state = await snoozeTaskAction(null, form({ taskId: TASK, version: '1', until }))
      expect(state?.ok, `until ${JSON.stringify(until)} was accepted`).toBe(false)
    }
    expect(mocks.rpcCalls).toEqual([])
  })

  it('does not announce a completion', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-14T12:00:00.000Z'))

    await snoozeTaskAction(null, form({ taskId: TASK, version: '1', until: '2026-09-20' }))

    expect(mocks.events).toEqual([])
  })
})

describe('reassigning', () => {
  it('requires the manager permission and stops before the database without it', async () => {
    mocks.denied = new Set(['crm.contact.assign'])

    const state = await reassignTaskAction(
      null,
      form({ taskId: TASK, version: '1', assigneeId: OTHER }),
    )

    expect(state?.ok).toBe(false)
    expect(mocks.gates).toEqual(['crm.contact.assign'])
    expect(mocks.rpcCalls).toEqual([])
  })

  it('is not satisfied by crm.task.manage', async () => {
    // A setter holds crm.task.manage. If this action accepted it, every setter
    // could hand their work to anyone.
    const state = await reassignTaskAction(
      null,
      form({ taskId: TASK, version: '1', assigneeId: OTHER }),
    )

    expect(mocks.gates).not.toContain('crm.task.manage')
    expect(state?.ok).toBe(true)
  })

  it('passes the chosen member and the version the screen saw', async () => {
    mocks.role = 'manager'
    mocks.userId = MANAGER

    await reassignTaskAction(null, form({ taskId: TASK, version: '2', assigneeId: OTHER }))

    expect(mocks.rpcCalls).toEqual([
      {
        fn: 'crm_reassign_task',
        args: {
          p_workspace_id: WS,
          p_task_id: TASK,
          p_actor_id: MANAGER,
          p_new_assignee: OTHER,
          p_expected_version: 2,
        },
      },
    ])
  })

  it('explains a non-member refusal in words someone can act on', async () => {
    mocks.rpcResult = { data: { ok: false, reason: 'not_a_member' }, error: null }

    const state = await reassignTaskAction(
      null,
      form({ taskId: TASK, version: '1', assigneeId: OTHER }),
    )

    expect(state?.ok).toBe(false)
    if (state && !state.ok) expect(state.error).toMatch(/not a member/i)
  })

  it('does not claim a change when the task was already theirs', async () => {
    mocks.rpcResult = completed({ changed: false, activity_id: null })

    const state = await reassignTaskAction(
      null,
      form({ taskId: TASK, version: '1', assigneeId: OTHER }),
    )

    expect(state?.ok).toBe(true)
    if (state && state.ok) expect(state.message).toMatch(/already/i)
  })

  it('never sends an empty assignee', async () => {
    const state = await reassignTaskAction(null, form({ taskId: TASK, version: '1', assigneeId: '' }))

    expect(state?.ok).toBe(false)
    expect(mocks.rpcCalls).toEqual([])
  })
})
