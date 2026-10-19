/**
 * A finished extraction lands in the CRM by itself — but only as far as the
 * uploader could have sent it there by hand.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

let memberships: { id: string; role: string; isOwner: boolean }[] = []
let accountGranted = false
const ingestLeads = vi.fn()
const ingestAccounts = vi.fn()
const routeBatch = vi.fn()

vi.mock('@/lib/workspaces/context', () => ({ listMemberships: async () => memberships }))
vi.mock('@/lib/workspaces/entitlements', () => ({
  getWorkspaceEntitlements: async () => ({ modules: new Set(['crm']), memberLimit: null, senderLimit: null }),
}))
vi.mock('@/lib/crm/account-access', () => ({ loadAccountPolicyInput: async () => ({}) }))
vi.mock('@/lib/crm/account-permissions', () => ({
  decideAccountPermission: () => ({ allowed: accountGranted }),
}))
vi.mock('@/lib/crm/ingest', () => ({ ingestExtractionJob: (...a: unknown[]) => ingestLeads(...a) }))
vi.mock('@/lib/crm/ingest-account-job', () => ({ ingestAccountJob: (...a: unknown[]) => ingestAccounts(...a) }))
vi.mock('@/lib/crm/routing', () => ({ routeBatch: (...a: unknown[]) => routeBatch(...a) }))

const { ExtractionCrmSync } = await import('@/lib/crm/auto-sync')

beforeEach(() => {
  memberships = [{ id: 'w-own', role: 'owner', isOwner: true }]
  accountGranted = false
  ingestLeads.mockReset().mockResolvedValue({ batchId: 'b1', contactsCreated: 3, contactsMatched: 1 })
  ingestAccounts.mockReset().mockResolvedValue({ accountsCreated: 2, accountsMatched: 0, accountsSkipped: 0 })
  routeBatch.mockReset().mockResolvedValue(null)
})

describe('ExtractionCrmSync', () => {
  it('ingests a lead run into the uploader’s workspace, unassigned', async () => {
    const outcome = await new ExtractionCrmSync('job1', 'u1', 'leads').run()

    expect(outcome).toEqual({ synced: true, kind: 'leads', created: 3, matched: 1 })
    expect(ingestLeads).toHaveBeenCalledWith('w-own', 'job1', { ownerUserId: null, actorUserId: 'u1' })
    expect(routeBatch).toHaveBeenCalledWith('w-own', 'b1')
  })

  it('does nothing for an uploader who could not import by hand', async () => {
    memberships = [{ id: 'w1', role: 'setter', isOwner: false }]
    expect(await new ExtractionCrmSync('job1', 'u1', 'leads').run()).toEqual({ synced: false, reason: 'not_permitted' })
    expect(ingestLeads).not.toHaveBeenCalled()
  })

  it('needs accounts.import for an account run', async () => {
    memberships = [{ id: 'w1', role: 'manager', isOwner: false }]
    expect(await new ExtractionCrmSync('job1', 'u1', 'accounts').run()).toMatchObject({ reason: 'not_permitted' })
    accountGranted = true
    expect(await new ExtractionCrmSync('job1', 'u1', 'accounts').run()).toEqual({
      synced: true,
      kind: 'accounts',
      created: 2,
      matched: 0,
    })
    expect(ingestAccounts).toHaveBeenCalledWith('w1', 'job1', 'u1')
  })

  it('never throws — the extraction already succeeded', async () => {
    ingestLeads.mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await new ExtractionCrmSync('job1', 'u1', 'leads').run()).toEqual({ synced: false, reason: 'failed' })
  })

  it('skips when the workspace is ambiguous or missing', async () => {
    memberships = [
      { id: 'w-team', role: 'manager', isOwner: false },
      { id: 'w-own', role: 'owner', isOwner: true },
    ]
    expect(await new ExtractionCrmSync('job1', 'u1', 'leads').run()).toEqual({ synced: false, reason: 'no_single_workspace' })
    memberships = []
    expect(await new ExtractionCrmSync('job1', 'u1', 'leads').run()).toEqual({ synced: false, reason: 'no_single_workspace' })
    expect(ingestLeads).not.toHaveBeenCalled()
  })
})
