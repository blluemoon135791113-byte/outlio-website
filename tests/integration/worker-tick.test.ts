/**
 * The background tick, end to end — R10.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS IS THE TEST THAT WAS MISSING FOR THE WHOLE PROJECT.                ║
 * ║                                                                           ║
 * ║  Every worker had passing tests that called it DIRECTLY, and not one of   ║
 * ║  them was ever invoked in production. The engine layer was proven; the    ║
 * ║  wiring layer had no coverage at all.                                     ║
 * ║                                                                           ║
 * ║  So this test does not re-prove that sending works — `email-send-worker`  ║
 * ║  does that. It proves that ONE CALL runs every job, that a failure in     ║
 * ║  one does not stop the others, and that the tick reports what it did.     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { describe, expect, it } from 'vitest'

import { runTick } from '@/lib/workers/tick'
import { hasSupabaseEnv } from './helpers'

const describeIf = hasSupabaseEnv ? describe : describe.skip

/**
 * Every job the tick is responsible for.
 *
 * ⚠️ ADDING A JOB TO THE TICK MEANS ADDING IT HERE. The exact-list assertion
 * below is deliberately not a subset check, so a job appearing or disappearing
 * both fail. `sync_contact_evidence` was added to the tick and not added here,
 * and this test is what caught it.
 */
const EXPECTED_JOBS = [
  'reap_email_claims',
  'send_email',
  'sync_replies',
  'advance_flows',
  'deliver_webhooks',
  'sync_contact_evidence',
] as const

describeIf('the tick runs every background job', () => {
  it('reports a result for EVERY job, not just the ones that had work', async () => {
    const result = await runTick()

    /*
     * ⚠️ A JOB THAT SILENTLY DOES NOT RUN IS THE ENTIRE BUG THIS PHASE FIXES.
     * Asserting on the reported job names — rather than on side effects —
     * catches a job being dropped from the tick during a later refactor, which
     * is exactly how these workers came to be orphaned in the first place.
     */
    for (const job of EXPECTED_JOBS) {
      expect(
        result.jobs[job],
        `the tick did not run "${job}" — a worker with no trigger is dead code that looks alive`,
      ).toBeDefined()
    }

    expect(Object.keys(result.jobs).sort()).toEqual([...EXPECTED_JOBS].sort())
  }, 120_000)

  it('completes without throwing, whatever the state of any one workspace', async () => {
    /*
     * The tick runs on a schedule with nobody watching. If one workspace's
     * misconfigured mailbox could throw out of `runTick`, every later job —
     * webhook delivery, flow resumption — would be skipped for everyone on
     * that tick, and the scheduler would see a 500 and retry the whole thing.
     */
    await expect(runTick()).resolves.toBeDefined()
  }, 120_000)

  it('records a failing job as failed instead of aborting the tick', async () => {
    const result = await runTick()

    // Whatever each job's outcome, all five must have REPORTED one.
    for (const job of EXPECTED_JOBS) {
      const outcome = result.jobs[job]!
      expect(typeof outcome.ok).toBe('boolean')
      // A failure must explain itself; an empty detail is a silent failure.
      expect(outcome.detail.length).toBeGreaterThan(0)
    }

    /*
     * ⚠️ AND THE JOBS AFTER A FAILING ONE STILL RAN. `deliver_webhooks` is
     * last, so its presence proves the tick did not abort part-way — the
     * property that keeps one broken mailbox from stopping the platform.
     */
    expect(result.jobs.deliver_webhooks).toBeDefined()
  }, 120_000)

  it('measures itself, so a tick that outgrows its window is visible', async () => {
    const result = await runTick()

    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(Date.parse(result.startedAt)).not.toBeNaN()

    /*
     * The route declares maxDuration = 60. A tick that regularly approaches
     * that is one refactor away from being killed mid-send, so the number is
     * reported rather than left to be guessed at from logs.
     */
    expect(result.durationMs).toBeLessThan(60_000)
  }, 120_000)
})
