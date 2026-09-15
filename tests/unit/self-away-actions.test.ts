/**
 * A member can mark only themselves away.
 *
 * ⚠️ A SERVER ACTION IS A PUBLIC HTTP ENDPOINT. The Profile form carries no user
 * id, but anyone can post one. The action must change the caller's own row
 * whatever the request says.
 *
 * Fixtures are fabricated.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const WS = '00000000-0000-4000-8000-000000000001'
const ME = '00000000-0000-4000-8000-0000000000a1'
const COLLEAGUE = '00000000-0000-4000-8000-0000000000b1'

const mocks = vi.hoisted(() => ({
  gates: [] as string[],
  denied: false,
  calls: [] as unknown[][],
  throwWith: null as Error | null,
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/workspaces/context', () => ({
  assertWorkspacePermission: async (permission: string) => {
    mocks.gates.push(permission)
    if (mocks.denied) throw new Error('denied')
    return { userId: ME, role: 'setter', workspace: { id: WS } }
  },
}))
vi.mock('@/lib/crm/routing-rules', () => ({
  setAwayUntil: async (...args: unknown[]) => {
    mocks.calls.push(args)
    if (mocks.throwWith) throw mocks.throwWith
  },
}))

const { setMyAwayAction } = await import('@/app/(product)/dashboard/settings/availability-actions')

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return fd
}

beforeEach(() => {
  mocks.gates = []
  mocks.denied = false
  mocks.calls = []
  mocks.throwWith = null
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-15T12:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('setMyAwayAction', () => {
  it('asks only for workspace membership, so every member can use it', async () => {
    await setMyAwayAction(null, form({ awayUntil: '' }))
    expect(mocks.gates).toEqual(['workspace.view'])
  })

  it('changes nothing when the caller is not signed in to a workspace', async () => {
    mocks.denied = true
    const state = await setMyAwayAction(null, form({ awayUntil: '2026-10-01' }))
    expect(state?.ok).toBe(false)
    expect(mocks.calls).toEqual([])
  })

  it('always changes the caller’s own row, even when the request names someone else', async () => {
    await setMyAwayAction(null, form({ awayUntil: '2026-10-01', userId: COLLEAGUE }))

    expect(mocks.calls).toEqual([[WS, ME, ME, new Date('2026-10-01T00:00:00').toISOString()]])
  })

  it('an empty date means available again', async () => {
    const state = await setMyAwayAction(null, form({ awayUntil: '' }))
    expect(mocks.calls).toEqual([[WS, ME, ME, null]])
    expect(state).toEqual({ ok: true, message: 'You are available for routed leads again.' })
  })

  it('refuses a date that has passed, is over two years away, or is not a date', async () => {
    for (const awayUntil of ['2026-09-01', '2029-01-01', 'next week']) {
      const state = await setMyAwayAction(null, form({ awayUntil }))
      expect(state?.ok, `awayUntil ${awayUntil} was accepted`).toBe(false)
    }
    expect(mocks.calls).toEqual([])
  })

  it('never shows a database message', async () => {
    mocks.throwWith = new Error('permission denied for table workspace_memberships')
    const state = await setMyAwayAction(null, form({ awayUntil: '' }))
    expect(state).toEqual({ ok: false, error: 'Could not change your availability.' })
  })
})
