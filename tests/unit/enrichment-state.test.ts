/**
 * An upload is not finished while its contacts are still being found.
 *
 * Regression (2026-10-31): the dashboard offered the export as soon as the
 * page was parsed, minutes before enrichment ended, so the CSV had no
 * contacts. Pinned: a live enrichment run holds the export; a stale one does
 * not lock the customer out.
 */
import { describe, expect, it } from 'vitest'

import { enrichingJobIds, STALE_MS } from '@/lib/jobs/enrichment-state'

describe('enrichingJobIds', () => {
  const now = Date.parse('2026-11-01T12:00:00Z')
  const at = (msAgo: number) => new Date(now - msAgo).toISOString()

  it('holds a job while a recent enrichment run is live', () => {
    expect(enrichingJobIds([{ job_id: 'job-1', created_at: at(60_000) }], now)).toEqual(new Set(['job-1']))
  })

  it('releases a job whose only run is stuck past the stale window', () => {
    expect(enrichingJobIds([{ job_id: 'job-1', created_at: at(STALE_MS + 1) }], now)).toEqual(new Set())
  })

  it('ignores runs that belong to no upload', () => {
    expect(enrichingJobIds([{ job_id: null, created_at: at(1_000) }], now)).toEqual(new Set())
  })
})
