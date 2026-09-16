/**
 * A campaign that cannot confirm what happened must say so — Phase 18.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  §7.5 asks that "a vendor outage surface as a visible partial, never a    ║
 * ║  silent one". There is no vendor: a human performs every LinkedIn action  ║
 * ║  and comes back to report it, so the outage equivalent is a person who    ║
 * ║  could not say whether the action landed.                                ║
 * ║                                                                           ║
 * ║  ⚠️ THE DANGEROUS OUTPUT IS A TIDY TOTAL. "12 of 20 done" is readable,    ║
 * ║  reassuring, and wrong the moment one of the twelve rests on an action    ║
 * ║  nobody could confirm — because the reader will act on it. The assertions ║
 * ║  below are mostly about refusing to produce that number.                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  campaignProgress,
  unconfirmedNote,
  type EnrollmentRow,
  type TaskRow,
} from '@/lib/linkedin/campaign-progress'

const ROOT = join(__dirname, '..', '..')
const SOURCE = readFileSync(join(ROOT, 'lib/linkedin/campaign-progress.ts'), 'utf8')

/**
 * ⚠️ COMMENTS STRIPPED, AND THIS FILE PROVED WHY ON ITS FIRST RUN. The module's
 * own header says "NO PERCENTAGE, AND THAT IS THE WHOLE DESIGN" and explains
 * what a ratio would misreport — so searching the raw text for /percent|ratio/
 * matched the EXPLANATION and reported the absence as a violation.
 *
 * Seventh time this trap has been hit in this codebase. The fix is always the
 * same: cut to the code before matching it.
 */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, ''))
  .join('\n')

const won: EnrollmentRow = { state: 'COMPLETED', terminalReason: 'GOAL_MET' }
const lost: EnrollmentRow = { state: 'COMPLETED', terminalReason: 'NOT_INTERESTED' }
const running: EnrollmentRow = { state: 'WAITING_MANUAL_ACTION', terminalReason: null }

const done: TaskRow[] = [{ outcome: 'MESSAGE_MARKED_SENT' }]
const unknown: TaskRow[] = [{ outcome: 'OUTCOME_UNKNOWN' }]
const pending: TaskRow[] = [{ outcome: null }]

describe('the buckets are what the rows say, not a guess', () => {
  it('separates succeeded from merely ended', () => {
    /*
     * ⚠️ BOTH ARE `COMPLETED`. `reasonMeansSuccess` treats GOAL_MET alone as
     * success; NOT_INTERESTED is how it ended, not how it went. A campaign that
     * counted every COMPLETED as a win would report a wall of successes to
     * somebody whose prospects all said no.
     */
    const p = campaignProgress([won, lost, running], [done, done, pending])
    expect(p.enrollments).toBe(3)
    expect(p.succeeded).toBe(1)
    expect(p.ended).toBe(1)
    expect(p.inFlight).toBe(1)
  })

  it('a terminal state with no reason is not a success', () => {
    /*
     * `terminal_reason` is set only when the state is terminal (0132), so a
     * null here is a row that ended without recording how. Counting it as
     * succeeded would invent the one fact it is missing.
     */
    const p = campaignProgress([{ state: 'COMPLETED', terminalReason: null }], [done])
    expect(p.succeeded).toBe(0)
    expect(p.ended).toBe(1)
  })

  it('counts a task nobody has acted on as pending, not as anything else', () => {
    const p = campaignProgress([running], [pending])
    expect(p.tasksPending).toBe(1)
    expect(p.tasksUnknown).toBe(0)
    expect(p.unconfirmed).toBe(0)
  })
})

describe('an unconfirmed action is never folded into a total', () => {
  it('an enrollment that succeeded on an unconfirmed action is counted in BOTH', () => {
    /*
     * ⚠️ THE CENTRAL CASE, AND THE ONE NOBODY WILL PRODUCE ON DEMAND. The
     * enrollment reached GOAL_MET, and the action underneath it is one the
     * operator could not confirm. It is a success AND unconfirmed, and saying
     * only the first is how a campaign reports work that may never have
     * happened to a real person.
     */
    const p = campaignProgress([won], [unknown])
    expect(p.succeeded).toBe(1)
    expect(p.unconfirmed).toBe(1)
    expect(p.tasksUnknown).toBe(1)
  })

  it('unconfirmed is not a fourth bucket that makes the others add up', () => {
    // succeeded + ended + inFlight === enrollments, always. `unconfirmed`
    // overlaps them deliberately and must not be subtracted from anything.
    const p = campaignProgress(
      [won, lost, running, won],
      [unknown, done, unknown, done],
    )
    expect(p.succeeded + p.ended + p.inFlight).toBe(p.enrollments)
    expect(p.unconfirmed).toBe(2)
  })

  it('one enrollment with two unconfirmed tasks is one unconfirmed person', () => {
    /*
     * The person count and the action count answer different questions: how
     * many people might have been contacted without our knowing, and how many
     * actions are in doubt. Conflating them would let one person with three
     * uncertain steps read as three people.
     */
    const p = campaignProgress(
      [won],
      [[{ outcome: 'OUTCOME_UNKNOWN' }, { outcome: 'OUTCOME_UNKNOWN' }]],
    )
    expect(p.unconfirmed).toBe(1)
    expect(p.tasksUnknown).toBe(2)
  })

  it('FAILED and SKIPPED are claims, not uncertainty', () => {
    /*
     * ⚠️ ONLY `OUTCOME_UNKNOWN` MEANS "WE CANNOT SAY". FAILED is somebody
     * having looked and found it did not happen; SKIPPED is a decision. Folding
     * either into unconfirmed would make the warning fire constantly and stop
     * being read — and §4.17 hangs the quota rule on the same distinction.
     */
    const p = campaignProgress(
      [lost, lost],
      [[{ outcome: 'FAILED' }], [{ outcome: 'SKIPPED' }]],
    )
    expect(p.unconfirmed).toBe(0)
    expect(p.tasksUnknown).toBe(0)
  })
})

describe('there is no percentage, deliberately', () => {
  it('the result exposes no completion ratio', () => {
    /*
     * ⚠️ ASSERTED AS AN ABSENCE, because adding one later is a two-line change
     * that reads like an improvement. A single "68% complete" forces `unknown`
     * into a bucket, and both choices misreport: counted as done it overstates
     * the work, counted as outstanding it implies work that may already have
     * been performed on somebody.
     */
    const p = campaignProgress([won, running], [unknown, pending])
    expect(Object.keys(p).sort()).toEqual(
      [
        'ended',
        'enrollments',
        'inFlight',
        'succeeded',
        'tasksPending',
        'tasksUnknown',
        'unconfirmed',
      ].sort(),
    )
    expect(CODE, 'a completion ratio crept in').not.toMatch(
      /percent|ratio|\/\s*enrollments\.length/i,
    )
  })
})

describe('the operator sentence', () => {
  it('says nothing when everything is confirmed', () => {
    /*
     * A line reading "0 unconfirmed" is a line people stop reading, and this
     * one has to be read the day it is not zero — the same argument
     * `ExcludedDeals` makes for rendering nothing at zero.
     */
    expect(unconfirmedNote(campaignProgress([won], [done]))).toBeNull()
  })

  it('names the people and the actions, and does not claim they happened', () => {
    const note = unconfirmedNote(campaignProgress([won, lost], [unknown, unknown]))!
    expect(note).toContain('2 people')
    expect(note).toContain('2 actions')
    // ⚠️ THE HEDGE IS THE POINT. "may or may not have happened" is the honest
    // statement; anything firmer invents a fact about somebody's inbox.
    expect(note).toMatch(/may or may not have happened/)
  })

  it('reads correctly for one person and one action', () => {
    const note = unconfirmedNote(campaignProgress([won], [unknown]))!
    expect(note).toContain('1 person')
    expect(note).toContain('an action')
    expect(note).not.toContain('1 people')
  })
})

describe('mismatched input is refused rather than misattributed', () => {
  it('throws when the task groups do not line up with the enrollments', () => {
    /*
     * ⚠️ POSITIONAL PAIRING IS SILENT WHEN IT SLIPS. One short array would
     * attribute one person's unconfirmed action to another's enrollment — a
     * wrong answer about a named individual, which is worse than no answer.
     */
    expect(() => campaignProgress([won, lost], [done])).toThrow(
      /2 enrollments but 1 task groups/,
    )
  })

  it('an enrollment with no tasks is fine, and is not unconfirmed', () => {
    // A draft enrollment legitimately has none yet. Absence of tasks is not
    // uncertainty about tasks.
    const p = campaignProgress([{ state: 'DRAFT', terminalReason: null }], [[]])
    expect(p.inFlight).toBe(1)
    expect(p.unconfirmed).toBe(0)
  })
})
