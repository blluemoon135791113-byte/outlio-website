/**
 * Gradual volume ramp — M5 Phase 13.
 *
 * M5 ACCEPTANCE CRITERION 5: "ramp limits enforced by scheduler."
 *
 * This is the honest alternative to a warmup network: send a few real emails
 * to real people and increase slowly. No manufactured engagement.
 */
import { describe, expect, it } from 'vitest'

import {
  checkRampAllowance,
  dailyAllowance,
  daysBetween,
  isRamping,
  RAMP_DEFAULTS,
  type RampSettings,
} from '@/lib/email/ramp'

function settings(over: Partial<RampSettings> = {}): RampSettings {
  return {
    enabled: true,
    startedOn: '2026-08-01',
    initialDaily: RAMP_DEFAULTS.initialDaily,
    dailyIncrement: RAMP_DEFAULTS.dailyIncrement,
    targetDaily: RAMP_DEFAULTS.targetDaily,
    configuredDailyLimit: null,
    ...over,
  }
}

describe('the ramp climbs slowly and stops at the target', () => {
  it('allows the opening volume on day one', () => {
    expect(dailyAllowance(settings(), '2026-08-01')).toBe(20)
  })

  it('adds the increment each day', () => {
    expect(dailyAllowance(settings(), '2026-08-02')).toBe(25)
    expect(dailyAllowance(settings(), '2026-08-11')).toBe(70)
  })

  it('stops climbing at the target rather than growing forever', () => {
    // Day 36 would be 200; day 100 must still be 200.
    expect(dailyAllowance(settings(), '2026-09-06')).toBe(200)
    expect(dailyAllowance(settings(), '2026-12-01')).toBe(200)
  })

  it('starts conservatively, because the failure is asymmetric', () => {
    // Starting too low costs a few days. Starting too high burns the domain
    // and there is no undo.
    expect(RAMP_DEFAULTS.initialDaily).toBeLessThanOrEqual(20)
    expect(RAMP_DEFAULTS.dailyIncrement).toBeLessThanOrEqual(5)
  })
})

describe('the lowest limit always wins', () => {
  it('honours a customer ceiling below the ramp', () => {
    expect(dailyAllowance(settings({ configuredDailyLimit: 10 }), '2026-08-11')).toBe(10)
  })

  it('does NOT let a larger customer ceiling override the ramp', () => {
    /*
     * Taking the larger would let a ramping mailbox ignore the ramp the moment
     * someone typed a bigger number into settings — which is precisely the
     * mistake the ramp exists to prevent.
     */
    expect(dailyAllowance(settings({ configuredDailyLimit: 5000 }), '2026-08-02')).toBe(25)
  })

  it('falls back to the target when the ramp is off and no ceiling is set', () => {
    // An accidental "unlimited" is how a domain dies overnight, so the target
    // acts as a backstop rather than meaning no limit.
    expect(dailyAllowance(settings({ enabled: false }), '2026-08-02')).toBe(200)
  })

  it('uses the customer ceiling when the ramp is off', () => {
    expect(
      dailyAllowance(settings({ enabled: false, configuredDailyLimit: 500 }), '2026-08-02'),
    ).toBe(500)
  })

  it('gives the opening allowance when the ramp has not started', () => {
    expect(dailyAllowance(settings({ startedOn: null }), '2026-08-02')).toBe(20)
  })
})

describe('ramp status', () => {
  it('is ramping while below the target', () => {
    expect(isRamping(settings(), '2026-08-05')).toBe(true)
  })

  it('is not ramping once the target is reached', () => {
    expect(isRamping(settings(), '2026-10-01')).toBe(false)
  })

  it('is never ramping when disabled', () => {
    expect(isRamping(settings({ enabled: false }), '2026-08-02')).toBe(false)
  })
})

describe('the scheduler gate', () => {
  it('allows a send below the allowance and reports what is left', () => {
    const decision = checkRampAllowance(settings(), 12, '2026-08-01')
    expect(decision.allowed).toBe(true)
    if (decision.allowed) expect(decision.remaining).toBe(8)
  })

  it('refuses once the allowance is used up', () => {
    const decision = checkRampAllowance(settings(), 20, '2026-08-01')
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) {
      expect(decision.reason).toContain('20')
      // The message explains the ramp rather than reading as a hard failure.
      expect(decision.reason).toContain('rises by 5 a day')
    }
  })

  it('refuses when already over the allowance', () => {
    // A limit lowered mid-day must take effect immediately, not next day.
    expect(checkRampAllowance(settings(), 999, '2026-08-01').allowed).toBe(false)
  })

  it('explains a plain daily limit differently from a ramp', () => {
    const decision = checkRampAllowance(
      settings({ enabled: false, configuredDailyLimit: 100 }),
      100,
      '2026-08-01',
    )
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) expect(decision.reason).toContain('daily limit of 100')
  })
})

describe('day arithmetic', () => {
  it('counts whole days', () => {
    expect(daysBetween('2026-08-01', '2026-08-11')).toBe(10)
  })

  it('counts a month boundary correctly', () => {
    expect(daysBetween('2026-08-25', '2026-09-01')).toBe(7)
  })

  it('never returns a negative for a future start date', () => {
    // A clock skew or a back-dated setting must not hand out a bigger
    // allowance than day one.
    expect(daysBetween('2026-09-01', '2026-08-01')).toBe(0)
  })

  it('is unaffected by a DST transition', () => {
    // 29 March 2026 is the UK spring-forward. Counted in UTC days, the
    // interval is still exactly 7.
    expect(daysBetween('2026-03-26', '2026-04-02')).toBe(7)
  })
})
