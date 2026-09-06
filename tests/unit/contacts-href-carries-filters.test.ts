/**
 * Every filter must survive sorting and paging.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS BUG ALREADY HAPPENED ONCE, AND ITS COMMENT IS STILL IN THE SOURCE. ║
 * ║                                                                           ║
 * ║  `contactsHref`: "Pagination used to rebuild the URL from `q` and `page`  ║
 * ║  alone, so filtering to 'Unassigned' and pressing Next silently dropped   ║
 * ║  the filter and returned the full workspace under a heading that still    ║
 * ║  said Unassigned."                                                       ║
 * ║                                                                           ║
 * ║  ⚠️ THE FIX WAS "ONE BUILDER", AND THAT IS NOT ENOUGH ON ITS OWN. Phase 2 ║
 * ║  added six filters to `ContactsTableQuery`. Adding a field there and      ║
 * ║  forgetting the matching line in `contactsHref` reproduces the original   ║
 * ║  bug exactly — the filter works until you click a column header, then     ║
 * ║  quietly widens the list.                                                ║
 * ║                                                                           ║
 * ║  Nothing else can catch that. The types agree, the page renders, the      ║
 * ║  query runs. Only the round trip through the URL reveals it.             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { contactsHref, type ContactsTableQuery } from '@/components/crm/ContactsTable'

const SOURCE = readFileSync(
  join(__dirname, '..', '..', 'components/crm/ContactsTable.tsx'),
  'utf8',
)

/** A query with every filter set to something distinctive and findable. */
const FULL: ContactsTableQuery = {
  search: 'acme',
  owner: '11111111-1111-4111-8111-111111111111',
  sort: 'name',
  direction: 'asc',
  tagIds: ['22222222-2222-4222-8222-222222222222'],
  company: '33333333-3333-4333-8333-333333333333',
  createdAfter: '2026-01-01',
  createdBefore: '2026-06-01',
  hasEmail: 'no',
  source: 'csv_import',
}

describe('the fixture itself', () => {
  it('sets every field of ContactsTableQuery', () => {
    /*
     * ⚠️ THE LOAD-BEARING ASSERTION. If a future field is added to the type and
     * not to FULL, every test below still passes while ignoring it — the guard
     * would silently stop guarding the newest, least-tested filter.
     *
     * TypeScript already requires FULL to be complete, so this asserts the
     * runtime shape matches: no field left as undefined or empty.
     */
    for (const [key, value] of Object.entries(FULL)) {
      expect(value, `${key} is empty in the fixture, so nothing tests it`).toBeTruthy()
      if (Array.isArray(value)) expect(value.length).toBeGreaterThan(0)
    }
  })
})

describe('contactsHref carries every filter', () => {
  const href = contactsHref(FULL)
  const params = new URLSearchParams(href.split('?')[1] ?? '')

  it('emits a parameter for each one', () => {
    expect(params.get('q')).toBe('acme')
    expect(params.get('owner')).toBe(FULL.owner)
    expect(params.get('company')).toBe(FULL.company)
    expect(params.get('after')).toBe('2026-01-01')
    expect(params.get('before')).toBe('2026-06-01')
    expect(params.get('email')).toBe('no')
    expect(params.get('source')).toBe('csv_import')
    expect(params.getAll('tag')).toEqual(FULL.tagIds)
  })

  it('survives a sort change — the original bug', () => {
    // Clicking a column header must not widen the list.
    const sorted = new URLSearchParams(
      contactsHref(FULL, { sort: 'created', direction: 'desc' }).split('?')[1] ?? '',
    )
    expect(sorted.get('q')).toBe('acme')
    expect(sorted.get('email')).toBe('no')
    expect(sorted.getAll('tag')).toEqual(FULL.tagIds)
  })

  it('survives paging — the original bug', () => {
    const paged = new URLSearchParams(contactsHref(FULL, { page: 3 }).split('?')[1] ?? '')
    expect(paged.get('page')).toBe('3')
    expect(paged.get('company')).toBe(FULL.company)
    expect(paged.get('source')).toBe('csv_import')
  })

  it('repeats the tag key rather than joining ids', () => {
    /*
     * A joined string would split on any id containing the separator, producing
     * two ids that match nothing — an empty list that looks like "no results"
     * rather than a bug.
     */
    const two = contactsHref({ ...FULL, tagIds: ['a'.repeat(8), 'b'.repeat(8)] })
    expect(new URLSearchParams(two.split('?')[1] ?? '').getAll('tag')).toHaveLength(2)
  })

  it('omits what is empty, so the common URL stays short', () => {
    const bare = contactsHref({
      ...FULL,
      search: '',
      owner: '',
      tagIds: [],
      company: '',
      createdAfter: '',
      createdBefore: '',
      hasEmail: '',
      source: '',
      sort: 'created',
      direction: 'desc',
    })
    expect(bare).toBe('/crm/contacts')
  })
})

describe('the type and the builder stay in step', () => {
  it('every field of ContactsTableQuery appears in contactsHref', () => {
    /*
     * ⚠️ THE STRUCTURAL HALF. The assertions above only cover fields somebody
     * remembered to list. This one reads the TYPE and requires each of its
     * fields to be mentioned inside the builder — so a seventh filter added
     * next month fails here on the day it is added, rather than the day
     * somebody notices their filter vanishing.
     */
    const typeBlock = /export type ContactsTableQuery = \{([\s\S]*?)\n\}/.exec(SOURCE)?.[1] ?? ''
    expect(typeBlock, 'could not read the type — the scanner is broken').toContain('search')

    const fields = [...typeBlock.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]!)
    expect(fields.length).toBeGreaterThanOrEqual(10)

    const builder = /export function contactsHref\(([\s\S]*?)\n\}/.exec(SOURCE)?.[1] ?? ''
    expect(builder).toContain('URLSearchParams')

    const missing = fields.filter((field) => !builder.includes(`merged.${field}`))
    expect(
      missing,
      `These fields are in ContactsTableQuery and never read by contactsHref, so ` +
        `they are dropped the moment a user sorts or pages — the exact bug the ` +
        `builder's own comment describes.`,
    ).toEqual([])
  })
})
