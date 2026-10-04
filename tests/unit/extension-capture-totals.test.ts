import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }))
import { settleCaptureJob } from '@/lib/extension/capture'

beforeEach(() => {
  vi.clearAllMocks()
  const query = { select: vi.fn(() => query), eq: db.eq, maybeSingle: db.maybeSingle }
  db.eq.mockReturnValue(query)
  db.from.mockReturnValue(query)
  db.maybeSingle.mockResolvedValue({ data: { id: 'page', status: 'queued' }, error: null })
  db.rpc.mockResolvedValue({ error: null })
})

describe('extension capture progress for leads and accounts', () => {
  it('rolls saved account totals with explicit owner and job scoping', async () => {
    await settleCaptureJob({ userId: 'owner', jobId: 'account-job', found: 25, kept: 24, status: 'processed' })
    expect(db.eq).toHaveBeenCalledWith('user_id', 'owner')
    expect(db.eq).toHaveBeenCalledWith('extraction_job_id', 'account-job')
    expect(db.rpc).toHaveBeenCalledWith('roll_capture_totals', {
      p_page_id: 'page', p_user_id: 'owner', p_job_id: 'account-job', p_leads_found: 25, p_leads_kept: 24, p_status: 'processed',
    })
  })
  it.each(['processed', 'failed'])('does not add counters a second time for a %s page', async (status) => {
    db.maybeSingle.mockResolvedValue({ data: { id: 'page', status }, error: null })
    await settleCaptureJob({ userId: 'owner', jobId: 'job', found: 25, kept: 25, status: 'processed' })
    expect(db.rpc).not.toHaveBeenCalled()
  })
  it('ignores pages outside this owner and lookup failures', async () => {
    db.maybeSingle.mockResolvedValue({ data: null, error: null })
    await settleCaptureJob({ userId: 'other', jobId: 'job', found: 25, kept: 25, status: 'processed' })
    db.maybeSingle.mockResolvedValue({ data: { id: 'page' }, error: { message: 'unavailable' } })
    await settleCaptureJob({ userId: 'owner', jobId: 'job', found: 25, kept: 25, status: 'processed' })
    expect(db.rpc).not.toHaveBeenCalled()
  })
  it('keeps an extracted job usable when cosmetic progress fails', async () => {
    db.rpc.mockRejectedValue(new Error('offline'))
    await expect(settleCaptureJob({ userId: 'owner', jobId: 'job', found: 0, kept: 0, status: 'failed' })).resolves.toBeUndefined()
  })
  it('wires settlement before the account early return and on the lead path', () => {
    const worker = readFileSync('lib/worker/process-job.ts', 'utf8')
    expect(worker).toMatch(/if \(job\.capture_session_id\)\s*\{\s*await settleCaptureJob\(\{ userId, jobId, found: allAccounts\.length, kept: persisted\.accountCount, status: 'processed' \}\)\s*\}\s*return/)
    expect(worker).toContain('found: report.totalParsed, kept: report.uniqueKept')
  })
})
