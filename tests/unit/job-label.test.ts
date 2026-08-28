import { describe, expect, it } from 'vitest'

import type { DashboardJob } from '@/lib/jobs/dashboard-types'
import { jobLabel, jobSource, jobYield } from '@/lib/jobs/label'

function job(overrides: Partial<DashboardJob> = {}): DashboardJob {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    status: 'completed',
    trashed_at: null,
    dedupe_mode: 'remove_exact',
    capture_session_id: null,
    file_count: 1,
    total_bytes: 1,
    progress_step: null,
    progress_current: 1,
    progress_total: 1,
    leads_parsed: 25,
    leads_kept: 25,
    kind: 'lead_search',
    accounts_parsed: 0,
    accounts_created: 0,
    accounts_matched: 0,
    duplicates_found: 0,
    duplicates_removed: 0,
    export_storage_path: null,
    error_message: null,
    started_at: null,
    completed_at: null,
    created_at: '2026-08-14T17:09:00.000Z',
    updated_at: '2026-08-14T17:09:00.000Z',
    ...overrides,
  }
}

describe('jobSource', () => {
  it('reads the capture session rather than guessing', () => {
    expect(jobSource(job({ capture_session_id: null }))).toBe('HTML')
    expect(
      jobSource(job({ capture_session_id: '11111111-1111-4111-8111-111111111111' })),
    ).toBe('Browser')
  })
})

describe('jobLabel', () => {
  it('names a finished run by source and what it produced', () => {
    expect(jobLabel(job())).toBe('HTML · 25 leads')
  })

  it('never carries the saved page’s filename', () => {
    // The whole point: LinkedIn's own chrome, underscored by the browser, is
    // identical on every file a user saves and so identifies nothing.
    const label = jobLabel(job())
    expect(label).not.toContain('_')
    expect(label).not.toMatch(/Sales Navigator|Lead Lists/)
  })

  it('counts an account run in companies, not leads', () => {
    const label = jobLabel(
      job({ kind: 'account_list', accounts_created: 18, accounts_matched: 7, leads_kept: 0 }),
    )
    expect(label).toBe('HTML · 25 companies')
  })

  it('does not state a final count while the run is still going', () => {
    /*
     * `leads_kept` is only written when the job finishes, so reading it mid-run
     * would title a working run "0 leads" — the failure-looks-like-empty
     * pattern. An active run is named by its size instead.
     */
    const label = jobLabel(job({ status: 'processing', file_count: 3, leads_kept: 0 }))
    expect(label).toBe('HTML · 3 files')
    expect(label).not.toContain('0 leads')
  })

  it('singularises both units', () => {
    expect(jobLabel(job({ leads_kept: 1 }))).toBe('HTML · 1 lead')
    expect(
      jobLabel(job({ kind: 'account_list', accounts_created: 1, accounts_matched: 0 })),
    ).toBe('HTML · 1 company')
    expect(jobLabel(job({ status: 'processing', file_count: 1 }))).toBe('HTML · 1 file')
  })
})

describe('jobYield', () => {
  it('reports an account run in companies even though leads_kept is 0', () => {
    expect(jobYield(job({ kind: 'account_list', accounts_created: 25, leads_kept: 0 }))).toBe(
      '25 companies',
    )
  })
})
