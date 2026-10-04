/**
 * An account page must not become a window onto contacts the viewer may not
 * see. A setter assigned an ACCOUNT still sees only their own CONTACTS there.
 *
 * Found by the step-3 risk review: notes, tasks and emails about a person also
 * carry the account's company_id, so "activity on the account" alone let a
 * colleague's conversations back in.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AccountAccess } from '@/lib/crm/account-access'

const filters: { table: string; or?: string; eq: Record<string, unknown> }[] = []
let activityRows: { id: string; contact_id: string | null }[] = []
let queries = 0

function table(name: string) {
  const record = { table: name, eq: {} as Record<string, unknown>, or: undefined as string | undefined }
  filters.push(record)
  const chain: Record<string, unknown> = {}
  const self = () => chain
  Object.assign(chain, {
    select: self,
    is: self,
    order: self,
    limit: self,
    eq: (k: string, v: unknown) => {
      record.eq[k] = v
      return chain
    },
    or: (expr: string) => {
      record.or = expr
      return chain
    },
    maybeSingle: () => {
      queries += 1
      return Promise.resolve({ data: { id: 'x' }, error: null })
    },
    then: (resolve: (r: unknown) => unknown) => {
      queries += 1
      const data =
        name === 'crm_contacts'
          ? [{ id: 'mine', full_name: 'My Lead' }]
          : activityRows.map((r) => ({
              ...r,
              activity_type: 'NOTE_ADDED',
              channel: 'manual',
              occurred_at: '2026-10-01T00:00:00Z',
              actor_user_id: null,
              metadata: {},
            }))
      return Promise.resolve({ data, error: null }).then(resolve)
    },
  })
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: (n: string) => table(n) }) }))

const { listAccountTimeline } = await import('@/lib/crm/accounts')
const { canSeeAccount } = await import('@/lib/crm/account-access')

const ACCOUNT = '11111111-1111-4111-8111-111111111111'
const access = {
  ctx: { userId: 'u-sam', workspace: { id: 'w1' } },
  viewAll: true,
  can: () => true,
  granted: new Set(),
} as unknown as AccountAccess

beforeEach(() => {
  filters.length = 0
  activityRows = []
  queries = 0
})

describe('the account timeline under the contact rule', () => {
  it('asks only for account-level events plus the viewer\'s own contacts', async () => {
    await listAccountTimeline(access, ACCOUNT, { contactScope: 'assigned' })
    const people = filters.find((f) => f.table === 'crm_contacts')!
    expect(people.eq.owner_user_id).toBe('u-sam')
    const activity = filters.find((f) => f.table === 'crm_activities')!
    expect(activity.or).toBe(`and(company_id.eq.${ACCOUNT},contact_id.is.null),contact_id.in.(mine)`)
  })

  it('never returns an event about a contact the viewer cannot see, whatever the query returned', async () => {
    activityRows = [
      { id: 'a1', contact_id: null },
      { id: 'a2', contact_id: 'mine' },
      { id: 'a3', contact_id: 'colleagues-lead' },
    ]
    const timeline = await listAccountTimeline(access, ACCOUNT, { contactScope: 'assigned' })
    expect(timeline.map((e) => e.id)).toEqual(['a1', 'a2'])
  })

  it('a viewer who sees every contact gets every event', async () => {
    activityRows = [
      { id: 'a1', contact_id: null },
      { id: 'a3', contact_id: 'colleagues-lead' },
    ]
    const timeline = await listAccountTimeline(access, ACCOUNT, { contactScope: 'all' })
    expect(timeline.map((e) => e.id)).toEqual(['a1', 'a3'])
    expect(filters.find((f) => f.table === 'crm_activities')!.or).toBe(
      `company_id.eq.${ACCOUNT},contact_id.in.(mine)`,
    )
  })
})

describe('a malformed account id', () => {
  it('is simply not found, and asks the database nothing', async () => {
    expect(await canSeeAccount(access, 'not-a-uuid')).toBe(false)
    expect(await canSeeAccount(access, "1' or '1'='1")).toBe(false)
    expect(queries).toBe(0)
  })
})
