/**
 * An upload is not finished while its contacts are still being found.
 *
 * Regression (2026-10-31): the dashboard offered the export as soon as the
 * page was parsed, minutes before enrichment ended, so the CSV had no
 * contacts. Pinned: a live enrichment run holds the export; a stale one does
 * not lock the customer out.
 */
import { describe, expect, it } from 'vitest'

import { enrichingJobIds, HANDOFF_MS, STALE_MS } from '@/lib/jobs/enrichment-state'

describe('enrichingJobIds', () => {
  const now = Date.parse('2026-11-01T12:00:00Z')
  const at = (msAgo: number) => new Date(now - msAgo).toISOString()
  const run = (status: string, msAgo: number, next: unknown[] = []) => ({ job_id: 'job-1', status, next, updated_at: at(msAgo) })

  it('holds a job while a recent enrichment run is live', () => {
    expect(enrichingJobIds([run('running', 60_000)], now)).toEqual(new Set(['job-1']))
  })

  it('holds a job in the handoff between batches, and releases it after the last', () => {
    // Batch finished seconds ago, more queued after it: not done yet.
    expect(enrichingJobIds([run('partially_complete', 5_000, [['lead']])], now)).toEqual(new Set(['job-1']))
    // The last batch finished: nothing after it.
    expect(enrichingJobIds([run('completed', 5_000, [])], now)).toEqual(new Set())
    // A handoff that never happened does not hold the export for long.
    expect(enrichingJobIds([run('completed', HANDOFF_MS + 1, [['lead']])], now)).toEqual(new Set())
  })

  it('releases a job whose only run is stuck past the stale window', () => {
    expect(enrichingJobIds([run('pending', STALE_MS + 1)], now)).toEqual(new Set())
  })

  it('ignores runs that belong to no upload', () => {
    expect(enrichingJobIds([{ ...run('running', 1_000), job_id: null }], now)).toEqual(new Set())
  })
})

describe('isStillEnriching (the server-side hold)', () => {
  /** A client answering the two reads the hold makes, from fixtures. */
  function client(runs: unknown[], leads: Array<{ id: string; extraction_job_id: string }>) {
    const chain = (rows: unknown[]) => {
      const query = {
        select: () => query, eq: () => query, gte: () => query, not: () => query,
        in: (_column: string, ids: string[]) => ({ then: (resolve: (value: unknown) => void) => resolve({ data: (rows as Array<{ id: string }>).filter((row) => ids.includes(row.id)), error: null }) }),
        then: (resolve: (value: unknown) => void) => resolve({ data: rows, error: null }),
      }
      return query
    }
    return { from: (table: string) => chain(table === 'research_runs' ? runs : leads) } as never
  }
  const live = [{ job_id: 'job-1', status: 'running', next: [], updated_at: new Date().toISOString() }]

  it('holds an upload, and leads selected from it, while it is enriched', async () => {
    const { isStillEnriching } = await import('@/lib/jobs/enrichment-state')
    const db = client(live, [{ id: 'lead-a', extraction_job_id: 'job-1' }, { id: 'lead-b', extraction_job_id: 'job-2' }])
    expect(await isStillEnriching(db, 'user', { jobId: 'job-1' })).toBe(true)
    expect(await isStillEnriching(db, 'user', { jobId: 'job-2' })).toBe(false)
    expect(await isStillEnriching(db, 'user', { leadIds: ['lead-a'] })).toBe(true)
    expect(await isStillEnriching(db, 'user', { leadIds: ['lead-b'] })).toBe(false)
  })

  it('never locks a customer out when the runs cannot be read', async () => {
    const { isStillEnriching } = await import('@/lib/jobs/enrichment-state')
    const broken = { from: () => { throw new Error('down') } } as never
    expect(await isStillEnriching(broken, 'user', { jobId: 'job-1' })).toBe(false)
  })
})
