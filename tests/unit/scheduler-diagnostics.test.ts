/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS PANEL IS READ WHEN THINGS ARE ALREADY BROKEN.                      ║
 * ║                                                                           ║
 * ║  `scheduler_diagnostics()` returns raw jsonb. If parsing it could throw,   ║
 * ║  a malformed row would take out the admin page — removing the only screen  ║
 * ║  that can diagnose the scheduler, at the exact moment it is needed.       ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { describe, expect, it } from 'vitest'

import {
  httpSummary,
  parseSchedulerDiagnostics,
  EMPTY_DIAGNOSTICS,
} from '@/lib/admin/scheduler-diagnostics'

describe('parseSchedulerDiagnostics', () => {
  it('reads a well-formed payload', () => {
    const out = parseSchedulerDiagnostics({
      jobs: [{ jobname: 'outlio-background-tick', schedule: '*/5 * * * *', active: true }],
      recent_job_runs: [
        { status: 'succeeded', return_message: '1 row', start_time: '2026-09-06T05:10:00Z' },
      ],
      recent_http: [
        { status_code: 200, error_msg: null, timed_out: false, created: '2026-09-06T05:10:00Z' },
      ],
    })

    expect(out.jobs[0]).toEqual({
      name: 'outlio-background-tick',
      schedule: '*/5 * * * *',
      active: true,
    })
    expect(out.runs[0].status).toBe('succeeded')
    expect(out.http[0].statusCode).toBe(200)
  })

  it('never throws on junk, whatever shape it is', () => {
    for (const junk of [
      null,
      undefined,
      42,
      'not an object',
      [],
      {},
      { jobs: 'nope', recent_job_runs: 7, recent_http: null },
      { jobs: [null, 3, 'x'], recent_job_runs: [[]], recent_http: [{}] },
    ]) {
      expect(() => parseSchedulerDiagnostics(junk)).not.toThrow()
    }
    expect(parseSchedulerDiagnostics(null)).toEqual(EMPTY_DIAGNOSTICS)
    expect(parseSchedulerDiagnostics({ jobs: 'nope' }).jobs).toEqual([])
  })

  it('treats an unreadable `active` as active, not as switched off', () => {
    /*
     * "We could not tell" must not render as "the scheduler is disabled" —
     * that sends someone to fix a job that was never broken. Only a literal
     * false is disabled.
     */
    expect(parseSchedulerDiagnostics({ jobs: [{ jobname: 'x' }] }).jobs[0].active).toBe(true)
    expect(
      parseSchedulerDiagnostics({ jobs: [{ jobname: 'x', active: false }] }).jobs[0].active,
    ).toBe(false)
  })

  it('keeps a non-numeric status code as null rather than coercing it', () => {
    // `Number('unknown')` is NaN, which would render as "NaN" in the summary.
    const out = parseSchedulerDiagnostics({ recent_http: [{ status_code: 'unknown' }] })
    expect(out.http[0].statusCode).toBeNull()
  })
})

describe('httpSummary', () => {
  it('says so when nothing has been called', () => {
    expect(httpSummary([])).toBe('No calls recorded yet.')
  })

  it('groups repeated codes rather than listing every call', () => {
    const ok = { statusCode: 200, error: null, timedOut: false, createdAt: null }
    expect(httpSummary([ok, ok, ok])).toBe('3 × 200')
  })

  it('separates a refusal from a success, which is the whole point', () => {
    /*
     * ⚠️ A 401 ON EVERY CALL LOOKS EXACTLY LIKE A HEALTHY SCHEDULER from every
     * angle except this one: the job fires on time, reports success, and
     * achieves nothing. Distinguishing them is why this summary exists.
     */
    const out = httpSummary([
      { statusCode: 401, error: null, timedOut: false, createdAt: null },
      { statusCode: 200, error: null, timedOut: false, createdAt: null },
    ])
    expect(out).toContain('1 × 401')
    expect(out).toContain('1 × 200')
  })

  it('reports a timeout as a timeout, not as its status code', () => {
    expect(
      httpSummary([{ statusCode: null, error: null, timedOut: true, createdAt: null }]),
    ).toBe('1 × timed out')
  })
})
