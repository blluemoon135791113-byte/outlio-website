/**
 * Paging and search for the extracted-leads table.
 *
 * The clamping and the escaping are the parts that matter. Both fail quietly
 * when they are wrong: an out-of-range page renders an empty table on an
 * account with thousands of leads, and an unescaped term silently changes the
 * query rather than raising anything.
 */
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_LEAD_PAGE_SIZE,
  LEAD_PAGE_SIZES,
  escapeSearchTerm,
  leadSearchFilter,
  pageNumbers,
  pageView,
  toPageSize,
} from '@/lib/jobs/lead-pagination'

describe('toPageSize', () => {
  it('accepts exactly the offered sizes', () => {
    expect(LEAD_PAGE_SIZES).toEqual([25, 50, 100])
    for (const size of LEAD_PAGE_SIZES) expect(toPageSize(size)).toBe(size)
  })

  it('accepts the string a <select> hands back', () => {
    expect(toPageSize('50')).toBe(50)
  })

  it('falls back to the default for anything else', () => {
    for (const value of [null, undefined, 0, -25, 30, 1000, 'abc', {}, NaN]) {
      expect(toPageSize(value), JSON.stringify(value)).toBe(DEFAULT_LEAD_PAGE_SIZE)
    }
  })

  it('defaults to 25, the size the table opens on', () => {
    expect(DEFAULT_LEAD_PAGE_SIZE).toBe(25)
  })
})

describe('pageView', () => {
  it('computes the range PostgREST needs', () => {
    expect(pageView({ page: 0, pageSize: 25, total: 100 })).toMatchObject({ from: 0, to: 24 })
    expect(pageView({ page: 2, pageSize: 25, total: 100 })).toMatchObject({ from: 50, to: 74 })
    expect(pageView({ page: 1, pageSize: 100, total: 250 })).toMatchObject({ from: 100, to: 199 })
  })

  it('counts pages, including a partial last one', () => {
    expect(pageView({ page: 0, pageSize: 25, total: 100 }).pageCount).toBe(4)
    expect(pageView({ page: 0, pageSize: 25, total: 101 }).pageCount).toBe(5)
    expect(pageView({ page: 0, pageSize: 25, total: 1 }).pageCount).toBe(1)
  })

  it('CLAMPS a page that no longer exists', () => {
    /*
     * Deleting rows, or narrowing a search, can strand the user past the end.
     * PostgREST answers an out-of-range request with zero rows — an empty table
     * on an account that has thousands of leads.
     */
    const view = pageView({ page: 40, pageSize: 25, total: 100 })
    expect(view.page).toBe(3)
    expect(view.from).toBe(75)
    expect(view.hasNext).toBe(false)
  })

  it('clamps a negative page', () => {
    expect(pageView({ page: -5, pageSize: 25, total: 100 }).page).toBe(0)
  })

  it('reports human row numbers, and the last page being short', () => {
    const view = pageView({ page: 4, pageSize: 25, total: 101 })
    expect(view.firstRow).toBe(101)
    expect(view.lastRow).toBe(101)
  })

  it('survives an empty account without claiming to show row 1', () => {
    const view = pageView({ page: 0, pageSize: 25, total: 0 })
    expect(view).toMatchObject({
      pageCount: 1,
      firstRow: 0,
      lastRow: 0,
      hasPrevious: false,
      hasNext: false,
    })
  })

  it('treats a missing count as empty rather than throwing', () => {
    // `count: 'exact'` can come back null while a request is in flight.
    expect(pageView({ page: 0, pageSize: 25, total: Number.NaN }).pageCount).toBe(1)
  })

  it('sets the navigation flags at both ends', () => {
    expect(pageView({ page: 0, pageSize: 25, total: 100 })).toMatchObject({
      hasPrevious: false,
      hasNext: true,
    })
    expect(pageView({ page: 3, pageSize: 25, total: 100 })).toMatchObject({
      hasPrevious: true,
      hasNext: false,
    })
  })
})

describe('pageNumbers', () => {
  it('lists every page when there are few', () => {
    expect(pageNumbers(0, 4)).toEqual([0, 1, 2, 3])
  })

  it('elides the middle for a long run, keeping first, last and a window', () => {
    expect(pageNumbers(10, 40)).toEqual([0, null, 9, 10, 11, null, 39])
  })

  it('does not elide a gap of exactly one page', () => {
    // A "…" standing in for a single page is wider than the page number.
    expect(pageNumbers(2, 5)).toEqual([0, 1, 2, 3, 4])
  })

  it('handles a single page', () => {
    expect(pageNumbers(0, 1)).toEqual([0])
    expect(pageNumbers(0, 0)).toEqual([0])
  })
})

describe('escapeSearchTerm — filter injection', () => {
  it('keeps an ordinary term intact', () => {
    expect(escapeSearchTerm('  Acme Systems ')).toBe('Acme Systems')
  })

  it('STRIPS the PostgREST grammar characters', () => {
    /*
     * `or=(col.ilike.value,col2.ilike.value)` is a grammar. A comma ends the
     * condition and a dot changes the operator, so `a,id.gt.0` would append a
     * condition the user never wrote.
     */
    const escaped = escapeSearchTerm('a,id.gt.0')
    expect(escaped).not.toContain(',')
    expect(escaped).not.toContain('.')
  })

  it('strips parentheses, quotes and backslashes', () => {
    for (const char of ['(', ')', '"', "'", '\\', ':']) {
      expect(escapeSearchTerm(`acme${char}corp`), char).toBe('acme corp')
    }
  })

  it('strips ilike wildcards, so "50%" searches for the digits', () => {
    expect(escapeSearchTerm('50%')).toBe('50')
    expect(escapeSearchTerm('a_b')).toBe('a b')
  })

  it('returns null when nothing searchable is left', () => {
    // The caller omits the filter entirely rather than sending a pattern that
    // matches nothing and looks like "no results".
    for (const value of ['', '   ', ',,,', '%%%', '()']) {
      expect(escapeSearchTerm(value), JSON.stringify(value)).toBeNull()
    }
  })

  it('caps a pathological length', () => {
    expect(escapeSearchTerm('a'.repeat(5_000))!.length).toBe(120)
  })
})

describe('leadSearchFilter', () => {
  it('searches name, title and company', () => {
    expect(leadSearchFilter('acme')).toBe(
      'full_name.ilike.*acme*,job_title.ilike.*acme*,company_name.ilike.*acme*',
    )
  })

  it('is null for an unsearchable term, so no filter is applied', () => {
    expect(leadSearchFilter('   ')).toBeNull()
  })

  it('never emits a term that could break out of the filter', () => {
    const filter = leadSearchFilter('x,id.gt.0')!
    // Three conditions, one per column — not four.
    expect(filter.split(',')).toHaveLength(3)
  })
})
