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
    expect(PAGE).toContain('activeFilterCount(query)')
    expect(PAGE).toMatch(/filterCount - \(search \? 1 : 0\)/)
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
    expect(block).toMatch(/search \|\| otherFilters > 0 \? null :/)
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
