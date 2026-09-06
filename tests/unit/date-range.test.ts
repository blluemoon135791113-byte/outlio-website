/**
 * Calendar ranges for the intelligence scope picker.
 *
 * The upper bound is the whole test. Getting it wrong drops a full day of
 * leads from a run and shows nothing to say anything was excluded.
 */
import { describe, expect, it } from 'vitest'

import {
  dateRangeBounds,
  dayCount,
  formatRange,
  isCalendarDate,
  isWithinRange,
  monthGrid,
  toDateInput,
} from '@/lib/intelligence/date-range'

describe('dateRangeBounds', () => {
  it('INCLUDES the whole of the last day', () => {
    /*
     * "1 Aug to 14 Aug" means the whole of the 14th. An upper bound of
     * `<= 2026-08-14` compares against midnight at the START of the 14th and
     * silently excludes every lead extracted that day.
     */
    const bounds = dateRangeBounds('2026-08-01', '2026-08-14')

    expect(bounds).toEqual({
      fromInclusive: '2026-08-01T00:00:00.000Z',
      toExclusive: '2026-08-15T00:00:00.000Z',
    })
  })

  it('covers a single day as a full 24 hours', () => {
    expect(dateRangeBounds('2026-08-14', '2026-08-14')).toEqual({
      fromInclusive: '2026-08-14T00:00:00.000Z',
      toExclusive: '2026-08-15T00:00:00.000Z',
    })
  })

  it('swaps a reversed range instead of rejecting it', () => {
    // Dragging a calendar backwards is a normal way to pick a range.
    expect(dateRangeBounds('2026-08-14', '2026-08-01')).toEqual(
      dateRangeBounds('2026-08-01', '2026-08-14'),
    )
  })

  it('crosses a month and a year boundary', () => {
    expect(dateRangeBounds('2025-12-30', '2026-01-02')?.toExclusive).toBe(
      '2026-01-03T00:00:00.000Z',
    )
  })

  it('handles a leap day', () => {
    expect(dateRangeBounds('2028-02-28', '2028-02-29')?.toExclusive).toBe(
      '2028-03-01T00:00:00.000Z',
    )
  })

  it('returns null for anything unparseable', () => {
    expect(dateRangeBounds('nonsense', '2026-08-14')).toBeNull()
    expect(dateRangeBounds('2026-08-01', '')).toBeNull()
  })
})

describe('isCalendarDate', () => {
  it('accepts a calendar date', () => {
    expect(isCalendarDate('2026-08-14')).toBe(true)
  })

  it('rejects other shapes', () => {
    for (const value of ['2026-8-14', '14/08/2026', '2026-08-14T00:00:00Z', '', 'today']) {
      expect(isCalendarDate(value), value).toBe(false)
    }
  })
})

describe('dayCount', () => {
  it('is inclusive of both ends', () => {
    expect(dayCount('2026-08-01', '2026-08-14')).toBe(14)
    expect(dayCount('2026-08-14', '2026-08-14')).toBe(1)
  })

  it('is zero for an unusable range', () => {
    expect(dayCount('nope', '2026-08-14')).toBe(0)
  })
})

describe('formatRange', () => {
  it('reads as a range', () => {
    expect(formatRange('2026-08-01', '2026-08-14')).toBe('1 Aug 2026 – 14 Aug 2026')
  })

  it('collapses a single day', () => {
    expect(formatRange('2026-08-14', '2026-08-14')).toBe('14 Aug 2026')
  })

  it('orders a reversed range', () => {
    expect(formatRange('2026-08-14', '2026-08-01')).toBe('1 Aug 2026 – 14 Aug 2026')
  })
})

describe('monthGrid', () => {
  it('pads to whole weeks starting on Monday', () => {
    // August 2026 starts on a Saturday.
    const grid = monthGrid(2026, 7)

    expect(grid.length % 7).toBe(0)
    expect(grid.slice(0, 5)).toEqual([null, null, null, null, null])
    expect(grid[5]).toBe('2026-08-01')
  })

  it('contains every day of the month exactly once', () => {
    const days = monthGrid(2026, 1).filter(Boolean)
    expect(days).toHaveLength(28)
    expect(new Set(days).size).toBe(28)
  })

  it('handles a February with 29 days', () => {
    expect(monthGrid(2028, 1).filter(Boolean)).toHaveLength(29)
  })

  it('handles a month starting on Monday with no leading blanks', () => {
    // June 2026 starts on a Monday.
    expect(monthGrid(2026, 5)[0]).toBe('2026-06-01')
  })
})

describe('isWithinRange', () => {
  it('includes both endpoints', () => {
    expect(isWithinRange('2026-08-01', '2026-08-01', '2026-08-14')).toBe(true)
    expect(isWithinRange('2026-08-14', '2026-08-01', '2026-08-14')).toBe(true)
    expect(isWithinRange('2026-08-07', '2026-08-01', '2026-08-14')).toBe(true)
  })

  it('excludes days outside', () => {
    expect(isWithinRange('2026-07-31', '2026-08-01', '2026-08-14')).toBe(false)
    expect(isWithinRange('2026-08-15', '2026-08-01', '2026-08-14')).toBe(false)
  })

  it('highlights nothing while only one end is picked', () => {
    expect(isWithinRange('2026-08-07', '2026-08-01', null)).toBe(false)
  })
})

describe('toDateInput', () => {
  it('formats in UTC, the calendar the bounds use', () => {
    expect(toDateInput(new Date('2026-08-14T23:30:00.000Z'))).toBe('2026-08-14')
  })
})
