/**
 * Which jobs the Excel download will build, and for whom.
 *
 * ⚠️ THE `user_id` FILTER IS THE AUTHORIZATION. The service role bypasses RLS,
 * so the only thing standing between one customer and another's leads is that
 * the job lookup is scoped by the caller's id. These tests pin that scoping and
 * every refusal, so a job id from someone else's account gets the same answer
 * as one that does not exist.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ExportTable } from '@/lib/export/sanitize'

type JobRow = { id: string; kind: 'lead_search' | 'account_list'; status: string } | null

const state = vi.hoisted(() => ({
  job: null as JobRow,
  jobError: null as { message: string } | null,
  filters: [] as [string, unknown][],
  leads: [] as unknown[] | null,
  accounts: [] as unknown[],
  accountsThrow: false,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        state.filters.push([column, value])
        return query
      },
      maybeSingle: async () => ({ data: state.job, error: state.jobError }),
    }
    return { from: () => query }
  },
}))

vi.mock('@/lib/worker/rebuild-export', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/worker/rebuild-export')>()),
  loadJobLeads: async () => state.leads,
}))

/*
 * ⚠️ THE WRITER IS SPIED, NOT RUN, IN THIS FILE. The row ceiling must be tested
 * at its exact edge, and a real 10,000-row build takes seconds — seconds that
 * grew fivefold when the suite ran in parallel. Timing belongs in a benchmark,
 * not a unit assertion. What the workbook actually contains is proven by
 * export-xlsx.test.ts, which does build and read back real files.
 */
const toXlsx = vi.hoisted(() =>
  // Typed like the real writer, so the recorded calls can be inspected.
  vi.fn(async (_table: ExportTable, _sheetName: string) => new Uint8Array([0x50, 0x4b])),
)
vi.mock('@/lib/export/xlsx', () => ({ toXlsx }))

vi.mock('@/lib/export/account-loader', () => ({
  loadAccountExportRecords: async () => {
    if (state.accountsThrow) throw new Error('EXPORT_ACCOUNTS_UNAVAILABLE')
    return state.accounts
  },
}))

const { buildJobWorkbook, MAX_WORKBOOK_ROWS } = await import('@/lib/export/job-workbook')

const USER = '11111111-1111-4111-8111-111111111111'
const JOB = '22222222-2222-4222-8222-222222222222'

const lead = {
  id: '33333333-3333-4333-8333-333333333333',
  extraction_job_id: JOB,
  full_name: 'Ada Example',
  linkedin_url: 'https://www.linkedin.com/in/fabricated-1',
  job_title: 'Founder',
  company_name: 'Example Co',
  company_url: 'https://www.linkedin.com/sales/company/1',
  company_website_url: 'https://example.com',
  sales_navigator_url: 'https://www.linkedin.com/sales/lead/fabricated-1',
  location: 'London',
  enrichment: {},
}

beforeEach(() => {
  state.job = { id: JOB, kind: 'lead_search', status: 'completed' }
  state.jobError = null
  state.filters = []
  state.leads = [lead]
  state.accounts = []
  state.accountsThrow = false
  toXlsx.mockClear()
})

describe('buildJobWorkbook', () => {
  it('scopes the job lookup to the caller', async () => {
    await buildJobWorkbook(USER, JOB)
    expect(state.filters).toContainEqual(['user_id', USER])
    expect(state.filters).toContainEqual(['id', JOB])
  })

  /*
   * Someone else's job never matches the user-scoped lookup, so it arrives here
   * as "no row" — indistinguishable, by design, from an id that never existed.
   */
  it("answers a job that is not the caller's exactly like one that does not exist", async () => {
    state.job = null
    await expect(buildJobWorkbook(USER, JOB)).resolves.toEqual({ ok: false, reason: 'not_found' })
  })

  it('refuses a run that has not finished', async () => {
    for (const status of ['uploaded', 'queued', 'processing', 'failed', 'cancelled']) {
      state.job = { id: JOB, kind: 'lead_search', status }
      await expect(buildJobWorkbook(USER, JOB), status).resolves.toEqual({ ok: false, reason: 'not_ready' })
    }
  })

  it('builds a partially completed run — it has rows worth having', async () => {
    state.job = { id: JOB, kind: 'lead_search', status: 'partially_completed' }
    await expect(buildJobWorkbook(USER, JOB)).resolves.toMatchObject({ ok: true })
  })

  it('refuses a failed read rather than serving a shorter workbook', async () => {
    state.leads = null
    await expect(buildJobWorkbook(USER, JOB)).resolves.toEqual({ ok: false, reason: 'unavailable' })
  })

  it('refuses when the job lookup itself errors', async () => {
    state.jobError = { message: 'boom' }
    await expect(buildJobWorkbook(USER, JOB)).resolves.toEqual({ ok: false, reason: 'unavailable' })
  })

  it('says a run with no rows is empty', async () => {
    state.leads = []
    await expect(buildJobWorkbook(USER, JOB)).resolves.toEqual({ ok: false, reason: 'empty' })
  })

  /*
   * The ceiling bounds the work one click can cause. Tested at its exact edge:
   * a job of exactly the limit is built with every row, one more is refused
   * before any workbook is assembled.
   */
  it('builds exactly at the row ceiling and refuses one row over it', async () => {
    state.leads = Array.from({ length: MAX_WORKBOOK_ROWS }, () => lead)
    await expect(buildJobWorkbook(USER, JOB)).resolves.toMatchObject({ ok: true })
    expect(toXlsx).toHaveBeenCalledTimes(1)
    expect(toXlsx.mock.calls[0]?.[0].rows).toHaveLength(MAX_WORKBOOK_ROWS)

    toXlsx.mockClear()
    state.leads = Array.from({ length: MAX_WORKBOOK_ROWS + 1 }, () => lead)
    await expect(buildJobWorkbook(USER, JOB)).resolves.toEqual({ ok: false, reason: 'too_large' })
    expect(toXlsx).not.toHaveBeenCalled()

    state.job = { id: JOB, kind: 'account_list', status: 'completed' }
    state.accounts = Array.from({ length: MAX_WORKBOOK_ROWS + 1 }, () => ({}))
    await expect(buildJobWorkbook(USER, JOB)).resolves.toEqual({ ok: false, reason: 'too_large' })
    expect(toXlsx).not.toHaveBeenCalled()
  })

  it('keeps the ceiling well above any real job', () => {
    // 100 saved pages of ~25 rows is the practical maximum for one upload.
    expect(MAX_WORKBOOK_ROWS).toBeGreaterThanOrEqual(100 * 25 * 4)
  })

  it('names the file from the job id only', async () => {
    const result = await buildJobWorkbook(USER, JOB)
    expect(result).toMatchObject({ ok: true, filename: 'outlio-leads-22222222.xlsx' })
  })

  it('builds account lists from the account loader', async () => {
    state.job = { id: JOB, kind: 'account_list', status: 'completed' }
    state.accountsThrow = true
    await expect(buildJobWorkbook(USER, JOB)).resolves.toEqual({ ok: false, reason: 'unavailable' })

    state.accountsThrow = false
    state.accounts = []
    await expect(buildJobWorkbook(USER, JOB)).resolves.toEqual({ ok: false, reason: 'empty' })
  })
})
