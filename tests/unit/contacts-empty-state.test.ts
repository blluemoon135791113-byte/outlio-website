/**
 * The contact list's empty state — three reasons, not two.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  "NO CONTACTS YET" WAS A CLAIM ABOUT THE WORKSPACE, MADE FROM A FILTERED  ║
 * ║  QUERY.                                                                   ║
 * ║                                                                           ║
 * ║  The state branched on `search` alone, but the query has ten dimensions    ║
 * ║  that change membership — owner, tags, company, created range, has-email,  ║
 * ║  source. A workspace holding five thousand contacts, narrowed by one tag   ║
 * ║  to zero rows, was told it had no contacts.                               ║
 * ║                                                                           ║
 * ║  Same shape as the credit balance that rendered `?? 0`: the most           ║
 * ║  discouraging available reading of a filtered result, presented as a fact  ║
 * ║  about their data.                                                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ STRUCTURAL, AND THAT IS A LIMITATION WORTH STATING. `EmptyContacts` is a
 * private function in a Server Component page, so it cannot be imported and
 * called. These read the source. They can prove the branch exists and that the
 * counting is right; they cannot prove what renders.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { emptyReason, otherFilterCount } from '@/lib/crm/empty-reason'

const ROOT = join(__dirname, '..', '..')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const PAGE = strip(readFileSync(join(ROOT, 'app/(product)/crm/contacts/page.tsx'), 'utf8'))
const FILTERS = strip(
  readFileSync(join(ROOT, 'components/crm/ContactFilters.tsx'), 'utf8'),
)

describe('the empty state distinguishes all three reasons', () => {
  it('does not claim the workspace is empty when filters are applied', () => {
    /*
     * ⚠️ THE DEFECT. `No contacts yet` must be reachable only when nothing is
     * filtering — otherwise it is a false statement about somebody's database.
     */
    expect(PAGE).toContain('No contacts match these filters')
    expect(PAGE).toContain('No contacts yet')
    expect(PAGE).toMatch(/otherFilters > 0/)
  })

  it('decides from the filter count, not from the search box alone', () => {
    // The page feeds the real count in; the arithmetic itself is asserted
    // behaviourally against `otherFilterCount` below.
    expect(PAGE).toContain('activeFilterCount(query)')
    expect(PAGE).toContain('otherFilterCount(search, filterCount)')
  })

  it('does not send a tag-filtered user to fix their spelling', () => {
    // "Try part of a name" is advice about the wrong control when the zero came
    // from a tag or a date range.
    const block = PAGE.slice(PAGE.indexOf('function EmptyContacts'))
    const nameAdvice = block.indexOf('Try part of a name')
    const filterBranch = block.indexOf('No contacts match these filters')
    expect(nameAdvice).toBeGreaterThan(-1)
    expect(filterBranch).toBeGreaterThan(-1)
    // The filter-only branch must not reach the spelling advice.
    expect(block.slice(filterBranch, filterBranch + 400)).not.toContain('Try part of a name')
  })
})

describe('every branch offers a way out', () => {
  it('gives each state an action', () => {
    /*
     * The previous version described how contacts arrive and gave nothing to
     * click — a dead end on the screen setters spend their day in.
     */
    const block = PAGE.slice(PAGE.indexOf('function EmptyContacts'))
    expect(block).toContain('Clear filters')
    expect(block).toContain('Clear search and filters')
    expect(block).toContain('Import a CSV')
  })

  it('offers lead search only when nothing is filtered', () => {
    // "Find leads" is the right next step for a genuinely empty workspace and
    // the wrong one for somebody who over-filtered.
    const block = PAGE.slice(PAGE.indexOf('function EmptyContacts'))
    expect(block).toContain("reason === 'none_yet' ? (")
  })

  it('clears by linking to the bare route rather than rebuilding the query', () => {
    // The filters live entirely in the URL, so dropping it is the whole reset.
    const block = PAGE.slice(PAGE.indexOf('function EmptyContacts'))
    expect(block).toMatch(/href: '\/crm\/contacts'/)
  })
})

describe('the count it relies on stays honest', () => {
  it('still excludes sort and direction', () => {
    /*
     * ⚠️ IF THIS EVER CHANGES, THE EMPTY STATE LIES AGAIN — it would offer to
     * "clear 2 filters" on an unfiltered list, and worse, would take the
     * filtered branch for a workspace that genuinely has no contacts.
     */
    const fn = FILTERS.slice(FILTERS.indexOf('export function activeFilterCount'))
    const body = fn.slice(0, fn.indexOf('}'))
    expect(body, 'sort is counted as a filter').not.toContain('query.sort')
    expect(body, 'direction is counted as a filter').not.toContain('query.direction')
  })

  it('counts search, so subtracting it once is correct', () => {
    const fn = FILTERS.slice(FILTERS.indexOf('export function activeFilterCount'))
    expect(fn.slice(0, fn.indexOf('}'))).toContain('query.search')
  })
})

describe('walking past the last page is its own reason', () => {
  /*
   * ⚠️ THESE CALL THE FUNCTION, AND THE REASON THEY DO IS A TEST THAT FAILED
   * TO FAIL.
   *
   * The branch first lived inline in the Server Component, so the only
   * available check was to read the source for the condition — and that check
   * passed against `if (false && total > 0 && page > 1)`, because the string
   * was still there. A structural assertion on a private function is an
   * assertion about spelling. The logic moved into `lib/crm/empty-reason.ts`
   * so it could be called.
   */
  it('reports past_end when rows exist on earlier pages', () => {
    expect(emptyReason({ search: '', filterCount: 0, page: 99, total: 5000 })).toBe('past_end')
  })

  it('prefers past_end over every filter explanation', () => {
    // If the reader is past the end, clearing filters is not the fix and
    // saying so sends them to the wrong control.
    expect(emptyReason({ search: 'ada', filterCount: 3, page: 4, total: 120 })).toBe('past_end')
  })

  it('does not report past_end on page 1', () => {
    expect(emptyReason({ search: '', filterCount: 0, page: 1, total: 0 })).toBe('none_yet')
  })

  it('does not report past_end when the filtered total is zero', () => {
    /*
     * Page 3 with a filter that matches nothing: going back to page 1 shows
     * nothing either, so the filters are the real answer.
     */
    expect(emptyReason({ search: '', filterCount: 2, page: 3, total: 0 })).toBe('no_match_filters')
  })

  it('treats an absent count as past_end beyond page 1', () => {
    // The companies list runs no count query, so `null` plus page > 1 is all
    // the signal there is — and it is enough.
    expect(emptyReason({ search: '', filterCount: 0, page: 2, total: null })).toBe('past_end')
    expect(emptyReason({ search: '', filterCount: 0, page: 1, total: null })).toBe('none_yet')
  })

  it('separates a search miss from a filter miss', () => {
    expect(emptyReason({ search: 'ada', filterCount: 1, page: 1, total: 0 })).toBe('no_match_search')
    expect(emptyReason({ search: '', filterCount: 1, page: 1, total: 0 })).toBe('no_match_filters')
  })

  it('never reports a negative count of other filters', () => {
    expect(otherFilterCount('ada', 1)).toBe(0)
    expect(otherFilterCount('ada', 3)).toBe(2)
    expect(otherFilterCount('', 2)).toBe(2)
  })

  it('keeps the filters when sending them back to page one', () => {
    // Returning to an unfiltered first page would throw away the view they
    // built to get there.
    const block = PAGE.slice(PAGE.indexOf('function EmptyContacts'))
    expect(block).toMatch(/contactsHref\(query, \{ page: 1 \}\)/)
  })
})

describe('companies has the same branch', () => {
  const COMPANIES = strip(
    readFileSync(join(ROOT, 'app/(product)/crm/companies/page.tsx'), 'utf8'),
  )

  it('does not claim the workspace is empty from page 9', () => {
    expect(COMPANIES).toMatch(/Nothing on page \$\{page\}/)
    expect(COMPANIES).toContain("reason === 'past_end'")
    expect(COMPANIES).toContain('No companies yet')
  })

  it('uses the shared reason rather than its own page test', () => {
    expect(COMPANIES).toContain("emptyReason({ search: '', filterCount: 0, page, total: null })")
    expect(COMPANIES, 'a count query was added').not.toMatch(/count: 'exact'/)
  })

  it('sends them to the first page rather than somewhere unrelated', () => {
    expect(COMPANIES).toMatch(/reason === 'past_end' \? '\/crm\/companies' : '\/crm\/contacts'/)
  })
})
