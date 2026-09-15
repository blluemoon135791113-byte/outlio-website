/**
 * Every routing settings action is an admin action, and reads its form
 * honestly.
 *
 * ⚠️ A SERVER ACTION IS A PUBLIC HTTP ENDPOINT. The settings page shows the
 * controls only to admins, but a manager can load the page, and anyone with an
 * action id can post to it. Each action must refuse on its own.
 *
 * Fixtures are fabricated.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const WS = '00000000-0000-4000-8000-000000000001'
const ADMIN = '00000000-0000-4000-8000-0000000000ad'
const A = '00000000-0000-4000-8000-0000000000a1'
const B = '00000000-0000-4000-8000-0000000000b1'
const RULE = '00000000-0000-4000-8000-00000000001e'
const CONTACT = '00000000-0000-4000-8000-0000000000c1'

const mocks = vi.hoisted(() => ({
  gates: [] as string[],
  denied: false,
  calls: [] as { fn: string; args: unknown[] }[],
  throwWith: null as Error | null,
  reroute: { outcome: 'assigned', reason: 'rule_matched' } as { outcome: string; reason: string },
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/workspaces/context', () => ({
  assertWorkspacePermission: async (permission: string) => {
    mocks.gates.push(permission)
    if (mocks.denied) throw new Error('denied')
    return { userId: ADMIN, role: 'admin', workspace: { id: WS } }
  },
}))

vi.mock('@/lib/crm/routing-rules', () => {
  class RoutingRuleError extends Error {}
  const record = (fn: string) => async (...args: unknown[]) => {
    mocks.calls.push({ fn, args })
    if (mocks.throwWith) throw mocks.throwWith
    return fn === 'routeContactAgain' ? mocks.reroute : undefined
  }
  return {
    RoutingRuleError,
    createRule: record('createRule'),
    updateRule: record('updateRule'),
    setRuleStatus: record('setRuleStatus'),
    moveRule: record('moveRule'),
    deleteRule: record('deleteRule'),
    setAwayUntil: record('setAwayUntil'),
    routeContactAgain: record('routeContactAgain'),
  }
})

const actions = await import('@/app/(product)/dashboard/settings/routing/actions')
const { RoutingRuleError } = await import('@/lib/crm/routing-rules')

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    for (const value of Array.isArray(v) ? v : [v]) fd.append(k, value)
  }
  return fd
}

const validRule = {
  name: 'Sales team',
  kind: 'pool',
  sources: ['csv_import', 'lead_engine'],
  memberIds: [A, B],
  maxOpenWorkload: '',
}

beforeEach(() => {
  mocks.gates = []
  mocks.denied = false
  mocks.calls = []
  mocks.throwWith = null
  mocks.reroute = { outcome: 'assigned', reason: 'rule_matched' }
})

afterEach(() => {
  vi.useRealTimers()
})

const EVERY_ACTION: [string, (s: null, f: FormData) => Promise<unknown>, FormData][] = [
  ['createRoutingRuleAction', actions.createRoutingRuleAction, form(validRule)],
  ['updateRoutingRuleAction', actions.updateRoutingRuleAction, form({ ...validRule, ruleId: RULE, version: '2' })],
  ['setRoutingRuleStatusAction', actions.setRoutingRuleStatusAction, form({ ruleId: RULE, status: 'published' })],
  ['moveRoutingRuleAction', actions.moveRoutingRuleAction, form({ ruleId: RULE, direction: 'up' })],
  ['deleteRoutingRuleAction', actions.deleteRoutingRuleAction, form({ ruleId: RULE })],
  ['setMemberAwayAction', actions.setMemberAwayAction, form({ userId: A, awayUntil: '' })],
  ['routeContactAgainAction', actions.routeContactAgainAction, form({ contactId: CONTACT })],
]

describe('every action is gated on crm.routing.manage', () => {
  for (const [name, action, fd] of EVERY_ACTION) {
    it(`${name} asks for crm.routing.manage and nothing weaker`, async () => {
      await action(null, fd)
      expect(mocks.gates).toEqual(['crm.routing.manage'])
    })

    it(`${name} changes nothing when refused`, async () => {
      mocks.denied = true
      const state = (await action(null, fd)) as { ok: boolean; error?: string }
      expect(state.ok).toBe(false)
      expect(state.error).toMatch(/admin/i)
      expect(mocks.calls, `${name} reached the library without permission`).toEqual([])
    })
  }
})

describe('reading a rule from the form', () => {
  it('collects repeated sources and members, and an empty cap means no cap', async () => {
    await actions.createRoutingRuleAction(null, form(validRule))

    expect(mocks.calls).toEqual([
      {
        fn: 'createRule',
        args: [
          WS,
          ADMIN,
          {
            name: 'Sales team',
            kind: 'pool',
            sources: ['csv_import', 'lead_engine'],
            userId: null,
            memberIds: [A, B],
            maxOpenWorkload: null,
          },
        ],
      },
    ])
  })

  it('reads a whole-number cap', async () => {
    await actions.createRoutingRuleAction(null, form({ ...validRule, maxOpenWorkload: '25' }))
    expect((mocks.calls[0]!.args[2] as { maxOpenWorkload: number }).maxOpenWorkload).toBe(25)
  })

  it('refuses a cap that is not a whole number rather than dropping it', async () => {
    /*
     * Someone who typed "ten" or "2.5" meant a limit. Reading it as "no cap"
     * removes the limit they asked for.
     */
    for (const cap of ['ten', '2.5']) {
      const state = await actions.createRoutingRuleAction(null, form({ ...validRule, maxOpenWorkload: cap }))
      expect(state?.ok, `cap ${cap} was accepted`).toBe(false)
    }
    expect(mocks.calls).toEqual([])
  })

  it('refuses an update without a usable version', async () => {
    for (const version of ['', '0', 'x']) {
      const state = await actions.updateRoutingRuleAction(null, form({ ...validRule, ruleId: RULE, version }))
      expect(state?.ok).toBe(false)
    }
    expect(mocks.calls).toEqual([])
  })

  it('passes the version the form was loaded with', async () => {
    await actions.updateRoutingRuleAction(null, form({ ...validRule, ruleId: RULE, version: '7' }))
    expect(mocks.calls[0]!.args.slice(0, 4)).toEqual([WS, ADMIN, RULE, 7])
  })
})

describe('messages', () => {
  it('shows a RoutingRuleError word for word', async () => {
    mocks.throwWith = new RoutingRuleError('Everyone in a rule must be a member of this workspace.')
    const state = await actions.createRoutingRuleAction(null, form(validRule))
    expect(state).toEqual({ ok: false, error: 'Everyone in a rule must be a member of this workspace.' })
  })

  it('never shows any other error’s message', async () => {
    mocks.throwWith = new Error('duplicate key value violates unique constraint "secret_internal_name"')
    const state = await actions.createRoutingRuleAction(null, form(validRule))
    expect(state?.ok).toBe(false)
    if (state && !state.ok) expect(state.error).not.toContain('secret_internal_name')
  })

  it('says a new rule is a draft that routes nothing yet', async () => {
    const state = await actions.createRoutingRuleAction(null, form(validRule))
    if (state && state.ok) expect(state.message).toMatch(/draft/i)
  })
})

describe('status and order', () => {
  it('accepts only the three statuses', async () => {
    const state = await actions.setRoutingRuleStatusAction(null, form({ ruleId: RULE, status: 'deleted' }))
    expect(state?.ok).toBe(false)
    expect(mocks.calls).toEqual([])
  })

  it('accepts only up and down', async () => {
    const state = await actions.moveRoutingRuleAction(null, form({ ruleId: RULE, direction: 'top' }))
    expect(state?.ok).toBe(false)
    expect(mocks.calls).toEqual([])
  })
})

describe('availability', () => {
  it('an empty date means available again', async () => {
    await actions.setMemberAwayAction(null, form({ userId: A, awayUntil: '' }))
    expect(mocks.calls).toEqual([{ fn: 'setAwayUntil', args: [WS, ADMIN, A, null] }])
  })

  it('sends the start of the chosen day as an instant', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-15T12:00:00.000Z'))

    await actions.setMemberAwayAction(null, form({ userId: A, awayUntil: '2026-10-01' }))

    expect(mocks.calls[0]!.args[3]).toBe(new Date('2026-10-01T00:00:00').toISOString())
  })

  it('refuses a date that has passed, is over two years away, or is not a date', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-15T12:00:00.000Z'))

    for (const awayUntil of ['2026-09-01', '2029-01-01', 'next week']) {
      const state = await actions.setMemberAwayAction(null, form({ userId: A, awayUntil }))
      expect(state?.ok, `awayUntil ${awayUntil} was accepted`).toBe(false)
    }
    expect(mocks.calls).toEqual([])
  })
})

describe('routing a lead again', () => {
  it('reports success when the lead was placed', async () => {
    const state = await actions.routeContactAgainAction(null, form({ contactId: CONTACT }))
    expect(state).toEqual({ ok: true, message: 'Routed to an owner.' })
    expect(mocks.calls).toEqual([{ fn: 'routeContactAgain', args: [WS, CONTACT] }])
  })

  it('says why when it is still waiting, rather than claiming success', async () => {
    mocks.reroute = { outcome: 'unassigned', reason: 'no_eligible_owner' }
    const state = await actions.routeContactAgainAction(null, form({ contactId: CONTACT }))
    expect(state?.ok).toBe(false)
    if (state && !state.ok) expect(state.error).toMatch(/nobody available/i)
  })
})
