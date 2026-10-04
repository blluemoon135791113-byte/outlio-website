/**
 * "Add N accounts to CRM" for an account upload.
 *
 * Pinned: the upload must belong to a member of THIS workspace and be an
 * account upload; facts only fill empty fields (summary and range included);
 * one provenance row per account per upload, re-runs are no-ops; one bad row
 * never costs the rest; and the action picks its branch from the STORED kind.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppError } from '@/lib/errors/catalog'

type Call = { table: string; op: string; row?: unknown; eq: Record<string, unknown>; is: Record<string, unknown>; options?: unknown; order: string[]; limit?: number; after?: string }

let job: { id: string; user_id: string; kind: string; trashed_at: string | null } | null
let member = true
let entries: Record<string, unknown>[] = []
let entryReadFailureAfter: number | null = null
let entryReads = 0
const calls: Call[] = []
const upserts: Record<string, unknown>[] = []
let upsertFails = new Set<string>()
let createdNames = new Set<string>()

vi.mock('server-only', () => ({}))
vi.mock('@/lib/crm/repository', () => ({
  upsertCrmCompany: async (_w: string, input: Record<string, unknown>) => {
    upserts.push(input)
    const name = String(input.name)
    if (upsertFails.has(name)) throw new Error('identifies no company')
    return { id: `crm-${name}`, created: createdNames.has(name), matchedBy: createdNames.has(name) ? null : 'sales_navigator' }
  },
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const call: Call = { table, op: 'select', eq: {}, is: {}, order: [] }
      const chain: Record<string, unknown> = {}
      Object.assign(chain, {
        select: () => chain,
        order: (column: string) => { call.order.push(column); return chain },
        limit: (limit: number) => { call.limit = limit; return chain },
        gt: (column: string, value: string) => {
          expect(column).toBe('id')
          call.after = value
          return chain
        },
        eq: (k: string, v: unknown) => {
          call.eq[k] = v
          return chain
        },
        is: (k: string, v: unknown) => {
          call.is[k] = v
          return chain
        },
        update: (row: unknown) => {
          call.op = 'update'
          call.row = row
          calls.push(call)
          return chain
        },
        upsert: (row: unknown, options: unknown) => {
          call.op = 'upsert'
          call.row = row
          call.options = options
          calls.push(call)
          return Promise.resolve({ error: null })
        },
        maybeSingle: () =>
          Promise.resolve({
            data: table === 'extraction_jobs' ? job : table === 'workspace_memberships' && member ? { user_id: 'u-owner' } : null,
            error: null,
          }),
        then: (resolve: (r: unknown) => unknown) => {
          if (call.op === 'select' && table === 'account_list_entries') {
            calls.push(call)
            entryReads += 1
            if (entryReadFailureAfter !== null && entryReads > entryReadFailureAfter) {
              return Promise.resolve({ data: null, error: { message: 'fixture page read failed' } }).then(resolve)
            }
            const ordered = [...entries].sort((a, b) => {
              for (const column of call.order) {
                if (a[column] !== b[column]) return a[column]! < b[column]! ? -1 : 1
              }
              return 0
            })
            const rows = ordered.filter((row) => !call.after || String(row.id) > call.after)
            // Reproduce PostgREST's max_rows cap even without a requested limit.
            return Promise.resolve({ data: rows.slice(0, Math.min(call.limit ?? 1000, 1000)), error: null }).then(resolve)
          }
          return Promise.resolve({ data: null, error: null }).then(resolve)
        },
      })
      return chain
    },
  }),
}))

const { ingestAccountJob } = await import('@/lib/crm/ingest-account-job')

const entry = (name: string, extra: Record<string, unknown> = {}) => ({
  id: `entry-${name}`,
  company_id: `co-${name}`,
  source_row_index: 0,
  page_kind: 'account_search',
  company_name_snapshot: name,
  company_sales_navigator_url: `https://www.linkedin.com/sales/company/${name.length}`,
  industry_snapshot: 'Software Development',
  employee_count_snapshot: 253,
  employee_count_range_snapshot: null,
  summary_snapshot: `${name} makes things.`,
  location_snapshot: null,
  signals: ['hiring_on_linkedin'],
  ...extra,
})

beforeEach(() => {
  job = { id: 'job-1', user_id: 'u-owner', kind: 'account_list', trashed_at: null }
  member = true
  entryReads = 0
  entryReadFailureAfter = null
  entries = [entry('Acme'), entry('Beta', { summary_snapshot: null, employee_count_snapshot: null, employee_count_range_snapshot: '1.2K+' })]
  calls.length = 0
  upserts.length = 0
  upsertFails = new Set()
  createdNames = new Set(['Acme'])
})

describe('tenancy and kind', () => {
  it.each([
    ['no such upload', () => (job = null), /no such extraction job/],
    ['a trashed upload', () => (job!.trashed_at = '2026-10-01'), /no such extraction job/],
    ['a lead upload', () => (job!.kind = 'lead_search'), /not an account upload/],
    // Same answer as a missing upload — and before the kind is looked at.
    ["an upload by someone outside this workspace", () => (member = false), /no such extraction job/],
    ['a lead upload outside this workspace (kind not revealed)', () => {
      member = false
      job!.kind = 'lead_search'
    }, /no such extraction job/],
  ])('refuses %s, writing nothing', async (_n, arrange, message) => {
    arrange()
    await expect(ingestAccountJob('w1', 'job-1', 'u-me')).rejects.toThrow(message)
    expect(upserts).toEqual([])
    expect(calls.filter((c) => c.op !== 'select')).toEqual([])
  })

  it('reads only this upload, scoped by its owner', async () => {
    await ingestAccountJob('w1', 'job-1', 'u-me')
    expect(calls.find((c) => c.table === 'account_list_entries')?.eq).toEqual({ user_id: 'u-owner', extraction_job_id: 'job-1' })
  })
})

describe('accounts', () => {
  it('created and matched are counted; identity and facts go through the gap-filling upsert', async () => {
    expect(await ingestAccountJob('w1', 'job-1', 'u-me')).toEqual({ accountsCreated: 1, accountsMatched: 1, accountsSkipped: 0 })
    expect(upserts[0]).toEqual({
      name: 'Acme',
      salesNavigatorUrl: 'https://www.linkedin.com/sales/company/4',
      industry: 'Software Development',
      employeeCount: 253,
      headquarters: null,
      sourceCompanyId: 'co-Acme',
      source: 'lead_engine',
    })
  })

  it('summary and range are written ONLY where empty, and only when the page had one', async () => {
    await ingestAccountJob('w1', 'job-1', 'u-me')
    const updates = calls.filter((c) => c.table === 'crm_companies' && c.op === 'update')
    expect(updates).toEqual([
      expect.objectContaining({ row: { summary: 'Acme makes things.' }, eq: { workspace_id: 'w1', id: 'crm-Acme' }, is: { summary: null } }),
      // …and only beside no exact count.
      expect.objectContaining({
        row: { employee_count_range: '1.2K+' },
        eq: { workspace_id: 'w1', id: 'crm-Beta' },
        is: { employee_count_range: null, employee_count: null },
      }),
    ])
  })

  it('one provenance row per account per upload, a repeat ignored, with what the page showed', async () => {
    await ingestAccountJob('w1', 'job-1', 'u-me')
    const sources = calls.filter((c) => c.table === 'crm_company_sources')
    expect(sources).toHaveLength(2)
    expect(sources[0]).toMatchObject({
      op: 'upsert',
      options: { onConflict: 'company_id,extraction_job_id', ignoreDuplicates: true },
      row: {
        workspace_id: 'w1',
        company_id: 'crm-Acme',
        source_type: 'html_upload',
        extraction_job_id: 'job-1',
        url: 'https://www.linkedin.com/sales/company/4',
        imported_by: 'u-me',
        raw_payload: expect.objectContaining({ page: 'account_search', summary: 'Acme makes things.', signals: ['hiring_on_linkedin'] }),
      },
    })
  })

  it('one account that cannot be resolved is skipped; the rest still land', async () => {
    upsertFails = new Set(['Acme'])
    expect(await ingestAccountJob('w1', 'job-1', 'u-me')).toEqual({ accountsCreated: 0, accountsMatched: 1, accountsSkipped: 1 })
    expect(calls.filter((c) => c.table === 'crm_company_sources')).toHaveLength(1)
  })
})

describe('pagination across the PostgREST row cap', () => {
  it.each([0, 500, 1000, 1250])('examines all %i stored rows exactly once, even when source row indexes repeat', async (count) => {
    entries = Array.from({ length: count }, (_, i) => entry(`Company${String(i).padStart(4, '0')}`, {
      id: `entry-${String(i).padStart(4, '0')}`, source_row_index: i % 25, summary_snapshot: null,
    })).reverse()
    createdNames = new Set(entries.map((row) => String(row.company_name_snapshot)))
    expect(await ingestAccountJob('w1', 'job-1', 'u-me')).toEqual({ accountsCreated: count, accountsMatched: 0, accountsSkipped: 0 })
    expect(new Set(upserts.map((row) => row.name)).size).toBe(count)
    expect(upserts).toHaveLength(count)
    expect(calls.filter((call) => call.table === 'crm_company_sources')).toHaveLength(count)
    for (const call of calls.filter((call) => call.table === 'account_list_entries')) {
      expect(call.eq).toEqual({ user_id: 'u-owner', extraction_job_id: 'job-1' })
    }
  })

  it('does not report a successful partial import if a later page cannot be read', async () => {
    entries = Array.from({ length: 1250 }, (_, i) => entry(`Company${String(i).padStart(4, '0')}`, { summary_snapshot: null }))
    entryReadFailureAfter = 1
    await expect(ingestAccountJob('w1', 'job-1', 'u-me')).rejects.toThrow('fixture page read failed')
  })
})

describe('the action picks its branch from the STORED kind', () => {
  it('a lead upload never reaches the account path, whatever the form says', async () => {
    vi.resetModules()
    const accountIngest = vi.fn()
    const leadIngest = vi.fn(async () => ({ batchId: 'b', contactsCreated: 0, contactsMatched: 0, rowsSkipped: 0 }))
    let gated: string | null = null
    vi.doMock('next/cache', () => ({ revalidatePath: () => undefined }))
    vi.doMock('@/lib/workspaces/context', () => ({
      assertWorkspacePermission: async () => ({ userId: 'u-me', workspace: { id: 'w1' } }),
    }))
    vi.doMock('@/lib/crm/account-access', () => ({
      assertAccountPermission: async (p: string) => {
        gated = p
        throw new AppError('ERR_FORBIDDEN')
      },
      canSeeAccount: async () => true,
    }))
    vi.doMock('@/lib/crm/ingest-account-job', () => ({ ingestAccountJob: accountIngest }))
    vi.doMock('@/lib/crm/ingest', () => ({ ingestExtractionJob: leadIngest, runCsvImport: vi.fn(), undoBatch: vi.fn() }))
    vi.doMock('@/lib/crm/routing', () => ({ routeBatch: async () => ({ routed: 0, waiting: 0 }) }))
    const { sendExtractionToCrm } = await import('@/app/(product)/crm/import/actions')

    job = { id: 'job-1', user_id: 'u-owner', kind: 'lead_search', trashed_at: null }
    const form = new FormData()
    form.set('jobId', 'job-1')
    form.set('kind', 'account_list')
    await sendExtractionToCrm(null, form)
    expect(accountIngest).not.toHaveBeenCalled()
    expect(leadIngest).toHaveBeenCalled()

    // An account upload needs accounts.import; refused, nothing ingested.
    job = { id: 'job-1', user_id: 'u-owner', kind: 'account_list', trashed_at: null }
    const refused = await sendExtractionToCrm(null, form)
    expect(gated).toBe('accounts.import')
    expect(refused).toEqual({ ok: false, error: 'You do not have permission to add accounts to the CRM.' })
    expect(accountIngest).not.toHaveBeenCalled()
  })
})
