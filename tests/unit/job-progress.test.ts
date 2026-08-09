import { describe, expect, it } from 'vitest'

import type { DashboardJob } from '@/lib/jobs/dashboard-types'
import { currentStage, fileProgress, runProgress } from '@/lib/jobs/progress'

function job(overrides: Partial<DashboardJob> = {}): DashboardJob {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    status: 'processing',
    dedupe_mode: 'remove_exact',
    file_count: 18,
    total_bytes: 1,
    progress_step: 'Processing file 5 of 18',
    progress_current: 4,
    progress_total: 18,
    leads_parsed: 0,
    leads_kept: 0,
    duplicates_found: 0,
    duplicates_removed: 0,
    export_storage_path: null,
    error_message: null,
    started_at: null,
    completed_at: null,
    created_at: '2026-08-09T00:00:00.000Z',
    updated_at: '2026-08-09T00:00:00.000Z',
    ...overrides,
  }
}

describe('job progress presentation', () => {
  it('reports exact file completion independently from overall workflow progress', () => {
    expect(fileProgress(job())).toBe(22)
    expect(runProgress(job())).toBe(24)
  })

  it('reserves progress for cleanup and export stages', () => {
    expect(runProgress(job({ progress_step: 'Removing duplicates', progress_current: 18 }))).toBe(88)
    expect(runProgress(job({ progress_step: 'Generating export', progress_current: 18 }))).toBe(96)
  })

  it('shows completed jobs at 100 percent', () => {
    expect(runProgress(job({ status: 'completed', progress_step: 'Completed' }))).toBe(100)
  })

  it('never exceeds 100 percent when counters are malformed', () => {
    expect(fileProgress(job({ progress_current: 99, progress_total: 18 }))).toBe(100)
  })

  it('maps the persisted step to the visible stage', () => {
    expect(currentStage(job({ status: 'queued', progress_step: 'Waiting in queue' }))).toBe(0)
    expect(currentStage(job())).toBe(1)
    expect(currentStage(job({ progress_step: 'Removing duplicates' }))).toBe(2)
    expect(currentStage(job({ progress_step: 'Generating export' }))).toBe(3)
  })
})
