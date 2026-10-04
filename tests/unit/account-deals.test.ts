/**
 * Deals for accounts: "New deal" on an account page and bulk "Move to
 * pipeline" on the Accounts list.
 *
 * Every id in those forms is a claim. Pinned here: the account must be
 * visible, the stage must be an OPEN stage (the pipeline comes from it, never
 * from the form), a person must work at THIS account and be visible to the
 * caller, and both gates — the deal permission and the account rule — apply.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppError } from '@/lib/errors/catalog'

const ACCOUNT = '0a000000-0000-4000-8000-000000000001'
const OTHER_ACCOUNT = '0a000000-0000-4000-8000-000000000002'
const STAGE = '0b000000-0000-4000-8000-000000000001'
const PIPELINE = '0c000000-0000-4000-8000-000000000001'
const PERSON = '0d000000-0000-4000-8000-000000000001'

let role = 'manager'
let refuseDeals = false
let refuseAccountView = false
const visible = new Set<string>()
let contactRow: { primary_company_id: string | null; owner_user_id: string | null } | null = null
const created: Record<string, unknown>[] = []
const rpcCalls: { name: string; args: Record<string, unknown> }[] = []
let rpcResult: unknown = null
let rpcError: { code: string; message: string } | null = null

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))
vi.mock('next/navigation', () => ({ redirect: () => undefined }))

vi.mock('@/lib/workspaces/context', () => ({
  assertWorkspacePermission: async (permission: string) => {
    if (permission === 'crm.opportunity.create' && refuseDeals) throw new AppError('ERR_FORBIDDEN')
    return { userId: 'u-sam', role, modules: new Set(['crm']), workspace: { id: 'w1', defaultCurrency: 'GBP' } }
  },
}))

vi.mock('@/lib/crm/account-access', () => ({
  assertAccountPermission: async () => {
    if (refuseAccountView) throw new AppError('ERR_FORBIDDEN')
    return { ctx: { userId: 'u-sam', role, workspace: { id: 'w1' } }, viewAll: true, can: () => true, granted: new Set() }
  },
  canSeeAccount: async (_a: unknown, id: string) => visible.has(id),
  visibleAccountIds: async (_a: unknown, ids: string[]) => new Set(ids.filter((id) => visible.has(id))),
  // Imported by account-writes (through account-actions); unused on these paths.
  requirePermissionFor: () => undefined,
  assertCanSeeAccount: async () => undefined,
}))

vi.mock('@/lib/crm/activities', () => ({ recordAudit: async () => undefined }))

vi.mock('@/lib/crm/opportunities', () => ({
  createOpportunity: async (_w: string, input: Record<string, unknown>) => {
    created.push(input)
    return 'deal-1'
  },
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args })
      return Promise.resolve({ data: rpcResult, error: rpcError })
    },
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      const self = () => chain
      Object.assign(chain, {
        select: self,
        eq: self,
        is: self,
        order: self,
        maybeSingle: () => Promise.resolve({ data: contactRow, error: null }),
        then: (resolve: (r: unknown) => unknown) => {
          const data =
            table === 'crm_pipelines'
              ? [{ id: PIPELINE, name: 'Sales', sort_order: 0 }]
              : table === 'crm_pipeline_stages'
                ? [{ id: STAGE, pipeline_id: PIPELINE, name: 'Qualified', sort_order: 1 }]
                : []
          return Promise.resolve({ data, error: null }).then(resolve)
        },
      })
      return chain
    },
  }),
}))

const { createAccountDealAction } = await import('@/app/(product)/crm/opportunities-actions')
const { bulkAccountAction } = await import('@/lib/crm/account-actions')

function dealForm(fields: Record<string, string> = {}): FormData {
  const f = new FormData()
  f.set('companyId', ACCOUNT)
  f.set('title', 'Acme')
  f.set('stageId', STAGE)
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

function bulkForm(ids: string[], stage = STAGE): FormData {
  const f = new FormData()
  f.set('op', 'deal')
  f.set('value_deal', stage)
  for (const id of ids) f.append('accountId', id)
  return f
}

beforeEach(() => {
  role = 'manager'
  refuseDeals = false
  refuseAccountView = false
  visible.clear()
  visible.add(ACCOUNT)
  contactRow = null
  created.length = 0
  rpcCalls.length = 0
  rpcResult = null
  rpcError = null
})

describe('"New deal" on an account page', () => {
  it('creates the deal FOR the account, in the pipeline the stage belongs to', async () => {
    const result = await createAccountDealAction(null, dealForm({ valueAmount: '1200', currency: 'EUR', expectedCloseDate: '2026-12-01' }))
    expect(result).toMatchObject({ ok: true, message: 'Acme added to Sales › Qualified.' })
    expect(created).toEqual([
      expect.objectContaining({
        title: 'Acme',
        companyId: ACCOUNT,
        contactId: null,
        pipelineId: PIPELINE,
        stageId: STAGE,
        ownerUserId: 'u-sam',
        valueAmount: 1200,
        currency: 'EUR',
        expectedCloseDate: '2026-12-01',
      }),
    ])
  })

  it('blank value is unknown (NULL), never zero', async () => {
    await createAccountDealAction(null, dealForm({ valueAmount: '' }))
    expect(created[0]).toMatchObject({ valueAmount: null })
  })

  type Refusal = { name: string; arrange?: () => void; fields?: Record<string, string>; message: RegExp }
  const refusals: Refusal[] = [
    { name: 'no permission to create deals', arrange: () => { refuseDeals = true }, message: /permission/ },
    { name: 'an account the caller cannot see', arrange: () => { visible.clear() }, message: /account could not be found/ },
    { name: 'a stage that is not an open stage here', fields: { stageId: '0b000000-0000-4000-8000-0000000000ff' }, message: /stage is no longer available/ },
    { name: 'no name', fields: { title: ' ' }, message: /name/ },
    { name: 'a negative value', fields: { valueAmount: '-1' }, message: /number/ },
    { name: 'a value the column cannot hold', fields: { valueAmount: '1000000000000' }, message: /too large/ },
    { name: 'a currency not offered', fields: { currency: 'XXX' }, message: /currency/ },
    { name: 'a malformed date', fields: { expectedCloseDate: '01/12/2026' }, message: /calendar/ },
  ]

  it.each(refusals)('refuses $name, and creates nothing', async ({ arrange, fields, message }) => {
    arrange?.()
    const result = await createAccountDealAction(null, dealForm(fields))
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(message) })
    expect(created).toEqual([])
  })

  it('a person must work at THIS account', async () => {
    contactRow = { primary_company_id: OTHER_ACCOUNT, owner_user_id: 'u-sam' }
    const result = await createAccountDealAction(null, dealForm({ contactId: PERSON }))
    expect(result).toMatchObject({ ok: false, error: 'That person is not at this account.' })
    expect(created).toEqual([])
  })

  it('a setter cannot attach a colleague\'s contact — same answer as "not here"', async () => {
    role = 'setter'
    contactRow = { primary_company_id: ACCOUNT, owner_user_id: 'u-someone-else' }
    const result = await createAccountDealAction(null, dealForm({ contactId: PERSON }))
    expect(result).toMatchObject({ ok: false, error: 'That person is not at this account.' })
    expect(created).toEqual([])
  })

  it('a person at the account who is visible is attached', async () => {
    contactRow = { primary_company_id: ACCOUNT, owner_user_id: 'u-sam' }
    await createAccountDealAction(null, dealForm({ contactId: PERSON }))
    expect(created[0]).toMatchObject({ contactId: PERSON, companyId: ACCOUNT })
  })
})

describe('bulk "Move to pipeline"', () => {
  it('only visible accounts reach the database; the result is summarised', async () => {
    rpcResult = {
      pipeline_id: PIPELINE,
      created: [{ company_id: ACCOUNT, opportunity_id: '0e000000-0000-4000-8000-000000000001' }],
      skipped_open: [],
      skipped_unnamed: [],
      missing: 0,
    }
    const result = await bulkAccountAction(null, bulkForm([ACCOUNT, OTHER_ACCOUNT]))
    expect(rpcCalls).toEqual([
      {
        name: 'crm_create_account_deals',
        args: { p_workspace_id: 'w1', p_stage_id: STAGE, p_company_ids: [ACCOUNT], p_owner_user_id: 'u-sam', p_actor_id: 'u-sam' },
      },
    ])
    expect(result).toEqual({ ok: false, message: '1 deal created, 1 not found.' })
  })

  it('already-there accounts are reported, not duplicated', async () => {
    rpcResult = { pipeline_id: PIPELINE, created: [], skipped_open: [ACCOUNT], skipped_unnamed: [], missing: 0 }
    const result = await bulkAccountAction(null, bulkForm([ACCOUNT]))
    expect(result).toEqual({ ok: true, message: '0 deals created, 1 already in that pipeline.' })
  })

  it('without permission to create deals, nothing is called', async () => {
    refuseDeals = true
    const result = await bulkAccountAction(null, bulkForm([ACCOUNT]))
    expect(result).toEqual({ ok: false, message: 'You do not have permission to create deals.' })
    expect(rpcCalls).toEqual([])
  })

  it('without the account rule, nothing is called', async () => {
    refuseAccountView = true
    const result = await bulkAccountAction(null, bulkForm([ACCOUNT]))
    expect(result).toMatchObject({ ok: false })
    expect(rpcCalls).toEqual([])
  })

  it('no stage, no accounts, or over 100 are refused before any call', async () => {
    expect(await bulkAccountAction(null, bulkForm([ACCOUNT], ''))).toMatchObject({ ok: false })
    expect(await bulkAccountAction(null, bulkForm([]))).toMatchObject({ ok: false })
    const many = Array.from({ length: 101 }, (_, i) => `0a000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    expect(await bulkAccountAction(null, bulkForm(many))).toMatchObject({ ok: false })
    expect(rpcCalls).toEqual([])
  })

  it('a refused stage reads as a sentence, never the database message', async () => {
    rpcError = { code: '23514', message: 'crm_create_account_deals: a new deal starts in an open stage' }
    const result = await bulkAccountAction(null, bulkForm([ACCOUNT]))
    expect(result).toEqual({ ok: false, message: 'That stage is no longer available. Refresh and try again.' })
  })

  it('an unexpected result shape is an error, not a guess', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    rpcResult = { created: 'everything' }
    const result = await bulkAccountAction(null, bulkForm([ACCOUNT]))
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('Something went wrong') })
  })
})
