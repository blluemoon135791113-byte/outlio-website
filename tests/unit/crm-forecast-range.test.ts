/**
 * Period-over-period comparison — M4 Phase 10.5.
 *
 * The forecast arithmetic itself lives in Postgres and is verified by
 * `supabase/smoke/0084_forecast.sql` against a real database. What is testable
 * here is the part that decides WHICH TWO WINDOWS get compared, and that is
 * where a trend report goes quietly wrong: an overlap of one day lets the same
 * activity count on both sides, and a zero base invents a percentage.
 */
import { describe, expect, it } from 'vitest'

import { previousRange, trend } from '@/lib/crm/reports'

describe('the previous period does not overlap the current one', () => {
  it('ends the day before the current period starts', () => {
    expect(previousRange({ fromDay: '2026-08-24', toDay: '2026-08-30' })).toEqual({
      fromDay: '2026-08-17',
      toDay: '2026-08-23',
    })
  })

  it('is the same length as the period it is compared against', () => {
    const days = (a: string, b: string) =>
      Math.round(
        (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000,
      ) + 1

    for (const [fromDay, toDay] of [
      ['2026-08-24', '2026-08-30'],
      ['2026-08-01', '2026-08-30'],
      ['2026-06-02', '2026-08-30'],
    ]) {
      const prior = previousRange({ fromDay: fromDay!, toDay: toDay! })
      expect(days(prior.fromDay, prior.toDay)).toBe(days(fromDay!, toDay!))
    }
  })

  it('crosses a month boundary without losing or gaining a day', () => {
    // 1–7 September compares against 25–31 August, not 26 August–1 September.
    expect(previousRange({ fromDay: '2026-09-01', toDay: '2026-09-07' })).toEqual({
      fromDay: '2026-08-25',
      toDay: '2026-08-31',
    })
  })

  it('crosses a year boundary', () => {
    expect(previousRange({ fromDay: '2027-01-01', toDay: '2027-01-07' })).toEqual({
      fromDay: '2026-12-25',
      toDay: '2026-12-31',
    })
  })

  it('handles a single day', () => {
    expect(previousRange({ fromDay: '2026-08-30', toDay: '2026-08-30' })).toEqual({
      fromDay: '2026-08-29',
      toDay: '2026-08-29',
    })
  })
})

describe('a trend from nothing is not a percentage', () => {
  it('returns null when the previous period was zero', () => {
    // 0 → 5 is not "+500%" and not "+100%". Any percentage there is invented,
    // and the page shows the previous figure instead.
    expect(trend(5, 0)).toBeNull()
  })

  it('returns null even when both periods were zero', () => {
    // "0%" here would read as "flat", which is a claim about performance that
    // nothing supports.
    expect(trend(0, 0)).toBeNull()
  })

  it('computes an ordinary rise and fall', () => {
    expect(trend(150, 100)).toBeCloseTo(0.5)
    expect(trend(50, 100)).toBeCloseTo(-0.5)
  })

  it('reports a drop to zero as -100%, which is real', () => {
    // Unlike a zero BASE, a zero result is a genuine and complete decline.
    expect(trend(0, 20)).toBe(-1)
  })

  it('reports no change as zero', () => {
    expect(trend(44, 44)).toBe(0)
  })
})
