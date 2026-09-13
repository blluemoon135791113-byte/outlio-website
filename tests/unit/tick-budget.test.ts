/**
 * The tick's time budget.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  MEASURED ON PRODUCTION, NOT IMAGINED.                                   ║
 * ║                                                                           ║
 * ║  Of the last 20 scheduled ticks, 5 failed. Every failure took 61-62       ║
 * ║  seconds; every success took 6-13. They were not flaky — they were being  ║
 * ║  killed at the route's 60s `maxDuration`, because no job had a timeout.   ║
 * ║                                                                           ║
 * ║  Killed at the wall is the worst outcome available: jobs ordered after    ║
 * ║  the hung one never run, and nothing records that they were skipped.      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { describe, expect, it, vi } from 'vitest'

import {
  JOB_BUDGET_MS,
  TICK_BUDGET_MS,
  runJob,
  type TickResult,
} from '@/lib/workers/tick'

function emptyResult(): TickResult {
  return { jobs: {}, startedAt: new Date().toISOString(), durationMs: 0 }
}

/** A start time chosen so `remaining` is exactly `ms`. */
function beganSoThatRemainingIs(ms: number): number {
  return Date.now() - (TICK_BUDGET_MS - ms)
}

const never = () => new Promise<string>(() => {})

describe('runJob time budget', () => {
  it('records a fast job normally', async () => {
    const result = emptyResult()
    await runJob(result, 'quick', async () => 'did the thing', Date.now())
    expect(result.jobs.quick).toEqual({ ok: true, detail: 'did the thing' })
  })

  it('abandons a job that hangs, instead of waiting for the platform to kill the tick', async () => {
    /*
     * ⚠️ FAKE TIMERS FOR THE SAME REASON AS THE BOUNDARY CASE BELOW, though
     * this one has 80ms of slack rather than sitting on the edge. On real
     * timers an 80ms stall between `beganSoThatRemainingIs` and `runJob`'s
     * first `Date.now()` — a GC pause on a loaded runner will do it — makes
     * `remaining <= 0`, and the job is reported 'skipped' rather than 'timed
     * out'. Deterministic here, and the suite stops waiting 80ms for it.
     */
    vi.useFakeTimers()
    try {
      const result = emptyResult()
      const hung = runJob(result, 'stuck', never, beganSoThatRemainingIs(80))
      await vi.advanceTimersByTimeAsync(80)
      await hung

      expect(result.jobs.stuck.ok).toBe(false)
      expect(result.jobs.stuck.detail).toContain('timed out')
    } finally {
      vi.useRealTimers()
    }
  })

  it('lets later jobs run after an earlier one hangs — the whole point', async () => {
    /*
     * This is the production failure in miniature: before the budget existed,
     * `sync_replies` hanging on one unreachable IMAP host meant flows, webhooks
     * and the evidence bridge did not run at all, for hours.
     *
     * Fake timers because the guarantee only holds when the remaining budget
     * exceeds the per-job cap — with real ones this test would sit for 20
     * seconds. `Date.now()` advances with them, so the budget arithmetic inside
     * runJob is the real arithmetic.
     */
    vi.useFakeTimers()
    try {
      const result = emptyResult()
      const began = Date.now()

      const hung = runJob(result, 'sync_replies', never, began)
      await vi.advanceTimersByTimeAsync(JOB_BUDGET_MS)
      await hung

      const after = runJob(result, 'deliver_webhooks', async () => '3 delivered', began)
      await vi.advanceTimersByTimeAsync(0)
      await after

      expect(result.jobs.sync_replies.ok).toBe(false)
      expect(result.jobs.sync_replies.detail).toContain('timed out')
      expect(result.jobs.deliver_webhooks).toEqual({ ok: true, detail: '3 delivered' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('a hang exhausts a nearly-spent budget, and the rest are marked skipped', async () => {
    /*
     * The other side of the same coin, and the reason the skip message exists:
     * late in a tick there may be nothing left to give, and that must be
     * visible rather than silent.
     *
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  ⚠️ FAKE TIMERS, BECAUSE THIS ASSERTION SITS EXACTLY ON THE BOUNDARY. ║
     * ║                                                                       ║
     * ║  `runJob` skips when `remaining <= 0`, and with 120ms left the hung   ║
     * ║  job must consume the last of it — measured by `Date.now()`. Node's   ║
     * ║  timers run off libuv's cached loop time rather than `Date.now()`,    ║
     * ║  and can fire a millisecond EARLY against it. One millisecond left is ║
     * ║  `remaining = 1`, the second job runs, and the assertion reads        ║
     * ║  '3 delivered'.                                                       ║
     * ║                                                                       ║
     * ║  It flipped on runner speed: observed passing and failing on the SAME ║
     * ║  commit (ad45a29, a two-file SQL change that cannot touch this code). ║
     * ║  A required check that fails for reasons unrelated to the diff is one ║
     * ║  people learn to re-run without reading — the vacuous-guard failure   ║
     * ║  this repository has already recorded twice.                          ║
     * ║                                                                       ║
     * ║  Under fake timers `Date.now()` advances in lockstep with the         ║
     * ║  scheduler, so 120ms advanced is 120ms elapsed, exactly. Same pattern ║
     * ║  the test above already uses, and for the same underlying reason.     ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     */
    vi.useFakeTimers()
    try {
      const result = emptyResult()
      const began = beganSoThatRemainingIs(120)

      const hung = runJob(result, 'sync_replies', never, began)
      await vi.advanceTimersByTimeAsync(120)
      await hung

      await runJob(result, 'deliver_webhooks', async () => '3 delivered', began)

      expect(result.jobs.sync_replies.detail).toContain('timed out')
      expect(result.jobs.deliver_webhooks.detail).toBe('skipped — tick budget exhausted')
    } finally {
      vi.useRealTimers()
    }
  })

  it('records budget-exhausted jobs as skipped rather than dropping them', async () => {
    // Silence is what made the original bug invisible. A skipped job must say so.
    const result = emptyResult()
    let ran = false

    await runJob(
      result,
      'sync_contact_evidence',
      async () => {
        ran = true
        return 'should not happen'
      },
      beganSoThatRemainingIs(-1),
    )

    expect(ran).toBe(false)
    expect(result.jobs.sync_contact_evidence).toEqual({
      ok: false,
      detail: 'skipped — tick budget exhausted',
    })
  })

  it('caps a single job below the whole tick budget', () => {
    /*
     * If one job could spend the entire budget there would be nothing left for
     * the six others, which is the situation being fixed.
     */
    expect(JOB_BUDGET_MS).toBeLessThan(TICK_BUDGET_MS)
  })

  it('leaves room under the 60s maxDuration for the heartbeat write', () => {
    /*
     * The budget exists to finish BEFORE the platform kills the function. If it
     * were >= 60s the tick would still be killed and still leave no record —
     * the bug would be unchanged with more code.
     */
    expect(TICK_BUDGET_MS).toBeLessThan(60_000)
    expect(60_000 - TICK_BUDGET_MS).toBeGreaterThanOrEqual(10_000)
  })

  it('still records a job that throws, and does not treat it as a timeout', async () => {
    const result = emptyResult()
    await runJob(
      result,
      'send_email',
      async () => {
        throw new Error('SMTP 535 auth failed')
      },
      Date.now(),
    )

    expect(result.jobs.send_email.ok).toBe(false)
    expect(result.jobs.send_email.detail).toBe('SMTP 535 auth failed')
  })
})
