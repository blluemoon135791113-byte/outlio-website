/**
 * §4.10's ladder — the numbers, and the four ways the arithmetic goes wrong.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  EVERY MISTAKE AVAILABLE HERE RELEASES MORE WORK THAN IT SHOULD.          ║
 * ║                                                                           ║
 * ║  Taking the daily figure when the week is tighter, letting a zero stage    ║
 * ║  read as "busy, try later", adding the external reserve instead of         ║
 * ║  subtracting it, or letting a customer's cap RAISE a limit rather than     ║
 * ║  lower it. None of them error. Each just hands an operator more tasks      ║
 * ║  against somebody's real account.                                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { describe, expect, it } from 'vitest'

import {
  canAdvanceStage,
  KIND_FOR_TASK,
  MAX_STAGE,
  remainingBudget,
  STAGES,
  type ActionKind,
} from '@/lib/linkedin/budget'

const base = {
  kind: 'invitation' as ActionKind,
  usedToday: 0,
  usedThisWeek: 0,
  externalReservePerDay: 0,
  customerDailyCap: null,
}

describe('the ladder matches §4.10', () => {
  it('releases nothing at stage 0', () => {
    /*
     * "Release zero proactive actions until the owner reviews account status."
     * A newly linked account is unreviewed, and unreviewed is not probably fine.
     */
    for (const kind of ['invitation', 'direct_message', 'inmail', 'profile_review'] as ActionKind[]) {
      expect(remainingBudget({ ...base, stage: 0, kind }).remaining, kind).toBe(0)
    }
  })

  it('distinguishes "not reviewed" from "out of budget"', () => {
    /*
     * ⚠️ A ZERO STAGE IS NOT A ZERO REMAINING. Reporting it as `day` would tell
     * an operator the account is busy and to come back later, when what it
     * needs is a person to review it — and waiting never fixes that.
     */
    expect(remainingBudget({ ...base, stage: 0 }).limitedBy).toBe('stage')
    expect(remainingBudget({ ...base, stage: 1, usedToday: 5 }).limitedBy).toBe('day')
  })

  it('keeps the weekly cap below seven days of the daily one', () => {
    /*
     * §4.10 sets stage 1 at 5/day and 25/week, not 35. A sender must not be
     * able to spend a week's ladder in five days and call it compliant.
     */
    for (let stage = 1; stage <= MAX_STAGE; stage += 1) {
      const caps = STAGES[stage]!.invitation
      expect(caps.perWeek, `stage ${stage}`).toBeLessThan(caps.perDay * 7)
    }
  })

  it('leaves engagement off at every stage', () => {
    // §4.10: disabled in starters. Enabling it is a deliberate act, not a
    // reward for reaching stage 3.
    for (let stage = 0; stage <= MAX_STAGE; stage += 1) {
      expect(STAGES[stage]!.engagement.perDay, `stage ${stage}`).toBe(0)
    }
  })
})

describe('the tightest window wins', () => {
  it('reports the week when the week is tighter', () => {
    /*
     * ⚠️ THE ONE THAT WOULD LEAK MOST. Ten left today and two left this week is
     * two. Reporting ten lets a week's ladder be spent in an afternoon, which
     * is the burst LinkedIn names as a restriction trigger.
     */
    const out = remainingBudget({ ...base, stage: 3, usedToday: 5, usedThisWeek: 73 })

    expect(out.remaining).toBe(2)
    expect(out.limitedBy).toBe('week')
  })

  it('reports the day when the day is tighter', () => {
    const out = remainingBudget({ ...base, stage: 3, usedToday: 14, usedThisWeek: 0 })

    expect(out.remaining).toBe(1)
    expect(out.limitedBy).toBe('day')
  })

  it('never returns a negative remainder', () => {
    // Overshoot happens: a reserve can be raised after tasks were released.
    const out = remainingBudget({ ...base, stage: 1, usedToday: 99, usedThisWeek: 99 })
    expect(out.remaining).toBe(0)
  })
})

describe('the external reserve lowers the cap, it does not raise the usage', () => {
  it('subtracts from the daily allowance', () => {
    // Stage 1 invitations are 5/day; reserving 2 for manual use leaves 3.
    expect(remainingBudget({ ...base, stage: 1, externalReservePerDay: 2 }).remaining).toBe(3)
  })

  it('floors at zero when the reserve exceeds the cap', () => {
    /*
     * The reason this is a subtraction rather than added to `used`: adding
     * could push `used` past the cap and yield a negative, which a caller might
     * render as a number to a person.
     */
    expect(remainingBudget({ ...base, stage: 1, externalReservePerDay: 99 }).remaining).toBe(0)
  })
})

describe('a customer cap may only lower', () => {
  it('applies a tighter customer cap', () => {
    expect(remainingBudget({ ...base, stage: 3, customerDailyCap: 4 }).remaining).toBe(4)
  })

  it('ignores a customer cap above the stage cap', () => {
    /*
     * ⚠️ §4.10 IS EXPLICIT THAT A CUSTOMER MAY GO LOWER. If a higher number
     * won, the ladder would be advisory and a workspace could set 500.
     */
    const out = remainingBudget({ ...base, stage: 1, customerDailyCap: 500 })
    expect(out.remaining).toBe(5)
  })

  it('treats an unset cap as no cap rather than zero', () => {
    expect(remainingBudget({ ...base, stage: 1, customerDailyCap: null }).remaining).toBe(5)
  })
})

describe('a stage never advances on a timer', () => {
  const NOW = new Date('2026-09-13T12:00:00Z')
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

  it('refuses when nobody has reviewed', () => {
    /*
     * ⚠️ NO REVIEW IS NOT "LONG ENOUGH AGO". The tempting reading of null —
     * nothing recorded, so nothing to wait for — is exactly backwards, and it
     * is the same mistake the preflight's thread check makes explicit.
     */
    const out = canAdvanceStage({ stage: 1, lastOwnerReviewAt: null, now: NOW, requiredDaysAtStage: 5 })

    expect(out).toEqual({ allowed: false, reason: 'never_reviewed' })
  })

  it('refuses before the required time at the stage', () => {
    const out = canAdvanceStage({
      stage: 1, lastOwnerReviewAt: daysAgo(2), now: NOW, requiredDaysAtStage: 5,
    })
    expect(out.reason).toBe('too_soon')
  })

  it('refuses a review timestamped in the future', () => {
    // Clock skew is not readiness.
    const out = canAdvanceStage({
      stage: 1, lastOwnerReviewAt: new Date(NOW.getTime() + 86_400_000), now: NOW, requiredDaysAtStage: 5,
    })
    expect(out.reason).toBe('too_soon')
  })

  it('allows it once a real review is old enough', () => {
    const out = canAdvanceStage({
      stage: 1, lastOwnerReviewAt: daysAgo(6), now: NOW, requiredDaysAtStage: 5,
    })
    expect(out.allowed).toBe(true)
  })

  it('refuses past the top of the ladder', () => {
    const out = canAdvanceStage({
      stage: MAX_STAGE, lastOwnerReviewAt: daysAgo(90), now: NOW, requiredDaysAtStage: 5,
    })
    expect(out).toEqual({ allowed: false, reason: 'already_max' })
  })
})

describe('every manual task kind spends a budget', () => {
  it('maps all four', () => {
    // A task whose budget nobody keeps is a task with no limit.
    expect(Object.keys(KIND_FOR_TASK).sort()).toEqual(
      ['CONNECTION_REQUEST', 'DIRECT_MESSAGE', 'INMAIL', 'REVIEW_PROFILE'].sort(),
    )
  })
})
