/**
 * The tick's job list and the test that checks it must name the same jobs.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ `worker-tick.test.ts` ALREADY SAYS "ADDING A JOB TO THE TICK MEANS    ║
 * ║  ADDING IT HERE" — AND THE LIST WENT STALE THREE TIMES ANYWAY.            ║
 * ║                                                                           ║
 * ║  `sync_contact_evidence` the first time. Then `drain_extraction_queue`     ║
 * ║  and `rollup_reporting` together, which is how this file came to exist.    ║
 * ║                                                                           ║
 * ║  The instruction was not the problem. The FEEDBACK LOOP was: the only      ║
 * ║  thing checking it is an integration test that needs live Supabase         ║
 * ║  credentials, takes ~16 seconds, and is NOT in `npm test`. Nobody adding a ║
 * ║  job to the tick runs it, so the drift is found weeks later by whoever     ║
 * ║  happens to run the full suite — which is exactly what happened.          ║
 * ║                                                                           ║
 * ║  This is the same check, moved to where it fires: source-only, offline,    ║
 * ║  milliseconds, in the default loop.                                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ THIS DOES NOT REPLACE THE INTEGRATION TEST, and must not be made to. It
 * proves the two LISTS agree; the integration test proves the tick actually
 * RUNS and REPORTS each one. A job could be named in both files and still throw
 * on its first line — only the runtime assertion catches that.
 *
 * ⚠️ AND THE LIST STAYS HAND-WRITTEN. Deriving `EXPECTED_JOBS` from `tick.ts`
 * would make the integration test's exact-list assertion vacuously true: it
 * would compare the tick against itself and pass for any roster at all,
 * including an empty one. An independent restatement is the whole mechanism.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')

const TICK_SOURCE = readFileSync(join(ROOT, 'lib/workers/tick.ts'), 'utf8')
const TEST_SOURCE = readFileSync(
  join(ROOT, 'tests/integration/worker-tick.test.ts'),
  'utf8',
)

/** Job names the tick actually runs, in the order it runs them. */
function jobsInTick(): string[] {
  return [...TICK_SOURCE.matchAll(/await runJob\(result, '(\w+)'/g)].map((m) => m[1]!)
}

/**
 * Job names the integration test expects.
 *
 * ⚠️ SCOPED TO THE ARRAY, NOT THE WHOLE FILE. The file quotes job names
 * throughout its prose — the header alone names `sync_contact_evidence`,
 * `advance_sequences` and `send_email` while explaining why the list exists.
 * Matching the file would read those comments as roster entries and pass over a
 * list that had lost every one of them. This codebase has been bitten by
 * comment-matching five times; the fix is always to cut to the code first.
 */
function jobsInExpectedList(): string[] {
  const open = TEST_SOURCE.indexOf('const EXPECTED_JOBS = [')
  const close = TEST_SOURCE.indexOf('] as const', open)
  expect(open, 'EXPECTED_JOBS was renamed or removed').toBeGreaterThan(-1)
  expect(close, 'EXPECTED_JOBS is no longer closed with `] as const`').toBeGreaterThan(open)

  const body = TEST_SOURCE.slice(open, close)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')

  return [...body.matchAll(/'(\w+)'/g)].map((m) => m[1]!)
}

describe('the scanner sees what it polices', () => {
  it('finds jobs on both sides', () => {
    // Vacuity: two empty lists are equal, and would make the assertion below
    // pass while proving nothing at all.
    expect(jobsInTick().length).toBeGreaterThanOrEqual(9)
    expect(jobsInExpectedList().length).toBeGreaterThanOrEqual(9)
  })

  it('cuts the comments out before reading the list', () => {
    /*
     * ⚠️ PROVES THE STRIP IS LOAD-BEARING. Unstripped, the array's own comment
     * block mentions `advance_sequences` and `send_email` — so a broken
     * stripper would still yield those names and the equality check would pass
     * for the wrong reason. Asserted against a fixture so it cannot go quiet.
     */
    const withProse = "const EXPECTED_JOBS = [\n  /* mentions 'ghost_job' */\n  'real_job', // and 'other_ghost'\n] as const"
    const stripped = withProse
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n')
    const names = [...stripped.matchAll(/'(\w+)'/g)].map((m) => m[1]!)
    expect(names).toEqual(['real_job'])
  })
})

describe('the tick and its expectations do not drift', () => {
  it('names exactly the same jobs', () => {
    const inTick = jobsInTick()
    const expected = jobsInExpectedList()

    const missing = inTick.filter((j) => !expected.includes(j))
    const extra = expected.filter((j) => !inTick.includes(j))

    expect(
      { missing, extra },
      'The tick and `worker-tick.test.ts` disagree about which background jobs ' +
        'exist. `missing` are jobs the tick runs that the test does not check — ' +
        'a worker with no assertion is how these came to be orphaned in the ' +
        'first place. `extra` are jobs the test still expects that the tick no ' +
        'longer runs — dead expectations that will fail against live Supabase ' +
        'long after the change that caused them.',
    ).toEqual({ missing: [], extra: [] })
  })

  it('no job is registered twice', () => {
    /*
     * Two `runJob` calls with one name would have the second silently overwrite
     * the first in `result.jobs`, so the tick would report one job having done
     * the other's work — and the exact-list assertion would still pass.
     */
    const inTick = jobsInTick()
    expect(inTick, 'a job name is registered twice in the tick').toEqual([
      ...new Set(inTick),
    ])
  })

  it('the two most recently orphaned workers are still triggered', () => {
    /*
     * ⚠️ NAMED, NOT JUST COUNTED. Both were written, tested, and called from
     * nowhere: `drain_extraction_queue` is the only thing that finds an
     * extraction whose `after()` nudge never ran, and `rollup_reporting` is the
     * only thing that writes `crm_reporting_daily` — without it `/crm/reports`
     * renders a full screen of zeroes that reads as "you did nothing".
     *
     * A `.filter()` refactor that dropped either would leave both lists equal
     * and this file green, because they would drift together.
     */
    expect(jobsInTick()).toContain('drain_extraction_queue')
    expect(jobsInTick()).toContain('rollup_reporting')
  })

  it('rollup runs last, after the jobs that create the activities it counts', () => {
    /*
     * The tick's own comment: rolling up before `send_email` and `sync_replies`
     * "would make every number exactly one tick stale". Ordering is invisible
     * in a set comparison, so it is asserted separately.
     */
    const inTick = jobsInTick()
    expect(inTick.indexOf('rollup_reporting')).toBe(inTick.length - 1)
    expect(inTick.indexOf('advance_sequences')).toBeLessThan(inTick.indexOf('send_email'))
  })
})
