/**
 * Uploads whose start request never arrived are started by the scheduler.
 *
 * Regression (job 3cc3edda, 2026-10-31): the browser's second request was
 * lost and the job waited 11 minutes for a page view. Pinned: a job is started
 * only when EVERY file is in storage, and only through finalize_upload_job
 * (credit gate and metering included); a job still receiving files waits.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const finalized: string[] = []
let stored: Record<string, string[]> = {}
let finalizeAnswer = 'ok'
const JOBS = [
  { id: '00000000-0000-4000-8000-0000000000b1', user_id: '00000000-0000-4000-8000-0000000000a1' },
  { id: '00000000-0000-4000-8000-0000000000b2', user_id: '00000000-0000-4000-8000-0000000000a1' },
]
const FILES: Record<string, string[]> = {
  '00000000-0000-4000-8000-0000000000b1': ['00000000-0000-4000-8000-0000000000a1/00000000-0000-4000-8000-0000000000b1/00000000-0000-4000-8000-0000000000c1.html', '00000000-0000-4000-8000-0000000000a1/00000000-0000-4000-8000-0000000000b1/00000000-0000-4000-8000-0000000000c2.html'],
  '00000000-0000-4000-8000-0000000000b2': ['00000000-0000-4000-8000-0000000000a1/00000000-0000-4000-8000-0000000000b2/00000000-0000-4000-8000-0000000000c3.html', '00000000-0000-4000-8000-0000000000a1/00000000-0000-4000-8000-0000000000b2/00000000-0000-4000-8000-0000000000c4.html'],
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    const query = (table: string) => {
      const filters: Record<string, string> = {}
      const chain = {
        select: () => chain,
        eq: (column: string, value: string) => { filters[column] = value; return chain },
        is: () => chain, lt: () => chain, order: () => chain, limit: () => chain,
        then: (resolve: (value: unknown) => void) => resolve(
          table === 'extraction_jobs'
            ? { data: JOBS, error: null }
            : { data: (FILES[filters.extraction_job_id!] ?? []).map((storage_path) => ({ storage_path })), error: null },
        ),
      }
      return chain
    }
    return {
      from: query,
      storage: { from: () => ({ list: async (folder: string) => ({ data: (stored[folder] ?? []).map((name) => ({ name })), error: null }) }) },
      rpc: async (_name: string, args: { p_job_id: string }) => {
        finalized.push(args.p_job_id)
        return { data: finalizeAnswer, error: null }
      },
    }
  },
}))

describe('recoverStalledUploads', () => {
  it('starts a job only when every file is in storage, through finalize', async () => {
    finalized.length = 0
    finalizeAnswer = 'ok'
    stored = { '00000000-0000-4000-8000-0000000000a1/00000000-0000-4000-8000-0000000000b1': ['00000000-0000-4000-8000-0000000000c1.html', '00000000-0000-4000-8000-0000000000c2.html'], '00000000-0000-4000-8000-0000000000a1/00000000-0000-4000-8000-0000000000b2': ['00000000-0000-4000-8000-0000000000c3.html'] }
    const { recoverStalledUploads } = await import('@/lib/upload/recover')
    expect(await recoverStalledUploads()).toEqual({ started: 1, waiting: 1, refused: 0 })
    expect(finalized).toEqual(['00000000-0000-4000-8000-0000000000b1'])
  })

  it('counts a credit refusal as refused, not started', async () => {
    finalized.length = 0
    finalizeAnswer = 'insufficient_credits'
    stored = { '00000000-0000-4000-8000-0000000000a1/00000000-0000-4000-8000-0000000000b1': ['00000000-0000-4000-8000-0000000000c1.html', '00000000-0000-4000-8000-0000000000c2.html'] }
    const { recoverStalledUploads } = await import('@/lib/upload/recover')
    expect(await recoverStalledUploads()).toMatchObject({ started: 0, refused: 1 })
  })

  it('never treats a job with no files as arrived', async () => {
    const { allFilesArrived } = await import('@/lib/upload/recover')
    expect(allFilesArrived([], new Set(['a.html']))).toBe(false)
    expect(allFilesArrived(['u/j/a.html'], new Set(['a.html']))).toBe(true)
  })
})
