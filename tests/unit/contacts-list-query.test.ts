/**
 * The contacts list URL carries everything the reader chose.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE BUG: PAGE 2 OF A FILTERED LIST WAS NOT FILTERED.                    ║
 * ║                                                                           ║
 * ║  `PageLink` built its own URL from `q` and `page`. The owner filter was   ║
 * ║  simply absent from it, so pressing Next on "Unassigned" returned the     ║
 * ║  whole workspace — under a heading that still said Unassigned, with the   ║
 * ║  Unassigned tab still marked current. Nothing on screen said the list had ║
 * ║  changed meaning.                                                         ║
 * ║                                                                           ║
 * ║  ⚠️ THE CLASS OF BUG MATTERS MORE THAN THE INSTANCE. It was introduced    ║
 * ║  by adding a filter and updating every control except one. So these       ║
 * ║  tests assert that ONE function builds every contacts URL, rather than    ║
 * ║  asserting that today's three parameters survive today's four links.      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { contactsHref, type ContactsTableQuery } from '@/components/crm/ContactsTable'
import { CONTACT_SORTS, isContactSort } from '@/lib/crm/contacts-list'

const ROOT = join(__dirname, '..', '..')
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8')

const DEFAULTS: ContactsTableQuery = {
  search: '',
  owner: '',
  sort: 'created',
  direction: 'desc',
}

describe('contactsHref', () => {
  it('is bare when nothing is chosen', () => {
    // A clean URL for the default view, so the common case is shareable
    // without a trail of parameters that all mean "normal".
    expect(contactsHref(DEFAULTS)).toBe('/crm/contacts')
  })

  it('carries the owner filter into another page', () => {
    // The exact failure that shipped.
    const href = contactsHref({ ...DEFAULTS, owner: 'unassigned' }, { page: 2 })
    expect(href).toContain('owner=unassigned')
    expect(href).toContain('page=2')
  })

  it('carries the search term when the owner filter changes', () => {
    // Changing WHO you are looking at is not a request to stop searching.
    const href = contactsHref({ ...DEFAULTS, search: 'sam' }, { owner: 'unassigned' })
    expect(href).toContain('q=sam')
    expect(href).toContain('owner=unassigned')
  })

  it('carries the sort into another page', () => {
    const href = contactsHref(
      { ...DEFAULTS, sort: 'name', direction: 'asc' },
      { page: 3 },
    )
    expect(href).toContain('sort=name')
    expect(href).toContain('dir=asc')
    expect(href).toContain('page=3')
  })

  it('returns to page 1 when the sort changes', () => {
    /*
     * ⚠️ NO `page` UNLESS ASKED FOR. Re-sorting while on page 7 would
     * otherwise leave the reader on page 7 of a completely different ordering
     * — rows that have nothing to do with what they were looking at.
     */
    const href = contactsHref({ ...DEFAULTS, sort: 'created' }, { sort: 'name' })
    expect(href).not.toContain('page=')
  })

  it('escapes what it puts in the URL', () => {
    const href = contactsHref({ ...DEFAULTS, search: 'a&b=c d' })
    expect(href).toContain('q=a%26b%3Dc+d')
    // The separator count proves the ampersand was encoded rather than
    // becoming a second parameter.
    expect(href.split('&')).toHaveLength(1)
  })
})

describe('every contacts URL comes from that one function', () => {
  const page = read('app/(product)/crm/contacts/page.tsx')
  const table = read('components/crm/ContactsTable.tsx')

  it('no control builds a contacts URL by hand', () => {
    /*
     * ⚠️ VERIFIED NON-VACUOUS: restoring `PageLink`'s original
     * `` `/crm/contacts?${query}` `` fails this.
     *
     * The link to a single contact — `/crm/contacts/${row.id}` — is a
     * different thing (a record, not a filtered list) and is excluded by
     * requiring the `?`.
     */
    // The page must not assemble one at all.
    expect(
      [...page.matchAll(/['"`]\/crm\/contacts\?/g)],
      'the page assembles a contacts URL inline',
    ).toHaveLength(0)

    /*
     * `ContactsTable` contains exactly one such literal — `contactsHref`'s own
     * return. Asserting "zero" here would be wrong, and asserting nothing would
     * leave the builder's file the one place a second hand-built URL could
     * hide. So: exactly one, and inside the builder.
     */
    const inTable = [...table.matchAll(/['"`]\/crm\/contacts\?/g)]
    expect(inTable, 'more than one contacts URL literal').toHaveLength(1)

    const builderStart = table.indexOf('export function contactsHref(')
    const builderEnd = table.indexOf('\nfunction SortableHeader(')
    expect(builderStart).toBeGreaterThan(-1)
    expect(builderEnd).toBeGreaterThan(builderStart)
    expect(inTable[0]!.index!).toBeGreaterThan(builderStart)
    expect(inTable[0]!.index!).toBeLessThan(builderEnd)
  })

  it('the page uses it for pagination and for the owner filter', () => {
    // Both of the controls that previously disagreed.
    const uses = [...page.matchAll(/contactsHref\(/g)]
    expect(uses.length).toBeGreaterThanOrEqual(2)
  })

  it('PageLink takes the whole query, not just the search term', () => {
    /*
     * The signature is the guard. `PageLink` accepting a bare `search: string`
     * is what made dropping the owner filter possible in the first place —
     * the parameter it needed was not something it could be handed.
     */
    const signature = page.slice(page.indexOf('function PageLink({'))
    expect(signature).toContain('query: ContactsTableQuery')
    expect(signature).not.toMatch(/^\s*search: string$/m)
  })
})

describe('the sort parameter reaches a database order() and is validated', () => {
  it('accepts only the two columns the base query can order by', () => {
    expect(isContactSort('name')).toBe(true)
    expect(isContactSort('created')).toBe(true)
    expect(Object.keys(CONTACT_SORTS).sort()).toEqual(['created', 'name'])
  })

  it('rejects anything else, including a column that exists', () => {
    /*
     * ⚠️ THIS VALUE IS INTERPOLATED INTO `.order()`. `owner_user_id` is a real
     * column, so "it errors anyway" is not the protection — an allow-list is.
     * A URL is user input no matter how ordinary it looks.
     */
    for (const value of [
      'owner_user_id',
      'company',
      'email',
      '',
      undefined,
      'created_at',
      'name;drop',
    ]) {
      expect(isContactSort(value as string | undefined), String(value)).toBe(false)
    }
  })

  it('maps each sort key to a real column on crm_contacts', () => {
    // The mapping is what makes the allow-list safe: the URL never names a
    // column, it names a key that this table translates.
    expect(CONTACT_SORTS.name).toBe('full_name')
    expect(CONTACT_SORTS.created).toBe('created_at')

    const query = read('lib/crm/contacts-list.ts')
    for (const column of Object.values(CONTACT_SORTS)) {
      expect(query, `${column} is not selected`).toContain(column)
    }
  })

  it('orders by a stable tiebreaker so paging cannot repeat or skip a row', () => {
    /*
     * ⚠️ WITHOUT THIS, PAGINATION IS SILENTLY LOSSY. Every contact in an
     * imported batch shares a `created_at` to the second. Postgres may return
     * ties in any order, and it need not be the same order twice — so a row
     * on page 1 can reappear on page 2 while another is never returned at all.
     */
    const query = read('lib/crm/contacts-list.ts')
    expect(query).toContain(".order('id', { ascending: true })")
  })

  it('sorts nulls last in both directions', () => {
    // Postgres defaults to NULLS FIRST on DESC, which would put every unnamed
    // contact at the top of a reversed name sort and bury the answer.
    const query = read('lib/crm/contacts-list.ts')
    expect(query).toContain('nullsFirst: false')
  })
})
