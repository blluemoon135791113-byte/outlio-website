/**
 * A saved view is user-authored state that later reaches a query.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE STORED DEFINITION IS NOT TRUSTWORTHY, AND THE DATABASE WILL NOT   ║
 * ║  HELP.                                                                    ║
 * ║                                                                           ║
 * ║  `crm_saved_views.definition` is `jsonb` with one constraint —            ║
 * ║  `jsonb_typeof = 'object'`. Anything object-shaped goes in. The row may   ║
 * ║  also have been written by an older version of the app, or edited         ║
 * ║  directly in the SQL editor, and it is read back long afterwards by code  ║
 * ║  that has forgotten where it came from.                                   ║
 * ║                                                                           ║
 * ║  `parseDefinition` is the only door, and these tests are what make that   ║
 * ║  claim mean something.                                                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { describe, expect, it } from 'vitest'

import { parseDefinition, viewToOptions } from '@/lib/crm/saved-views'

describe('parseDefinition keeps what it recognises', () => {
  it('accepts a full, valid definition', () => {
    const input = {
      search: 'acme',
      ownerUserId: '11111111-1111-4111-8111-111111111111',
      unassignedOnly: true,
      tagIds: ['22222222-2222-4222-8222-222222222222'],
      companyId: '33333333-3333-4333-8333-333333333333',
      createdAfter: '2026-01-01',
      hasEmail: true,
      source: 'csv_import',
      sort: 'name',
      direction: 'asc',
    }
    expect(parseDefinition(input)).toMatchObject(input)
  })

  it('keeps hasEmail: false, which is not the same as absent', () => {
    /*
     * ⚠️ THE BUG THIS PINS. `false` is falsy, so any implementation that
     * filters on truthiness drops it — and "contacts with NO email", the whole
     * point of that filter, silently becomes "no filter". The result looks
     * plausible, which is why nobody reports it.
     */
    expect(parseDefinition({ hasEmail: false })).toEqual({ hasEmail: false })
    expect(parseDefinition({})).toEqual({})
  })
})

describe('parseDefinition drops what it does not', () => {
  it('refuses a sort outside the allowlist', () => {
    /*
     * ⚠️ `sort` REACHES A DATABASE `.order()`. A stored value is no more
     * trustworthy than a query string, and the URL parameter is already
     * validated against this same allowlist (`isContactSort`). Validating one
     * and not the other would leave the back door open.
     */
    expect(parseDefinition({ sort: 'full_name; drop table --' }).sort).toBeUndefined()
    expect(parseDefinition({ sort: 'company' }).sort).toBeUndefined()
    expect(parseDefinition({ sort: 'name' }).sort).toBe('name')
  })

  it('refuses an unknown source', () => {
    expect(parseDefinition({ source: 'linkedin_scrape' }).source).toBeUndefined()
    expect(parseDefinition({ source: 'manual' }).source).toBe('manual')
  })

  it('refuses ids that are not uuids', () => {
    expect(parseDefinition({ ownerUserId: 'me' }).ownerUserId).toBeUndefined()
    expect(parseDefinition({ tagIds: ['not-a-uuid'] }).tagIds).toBeUndefined()
    expect(parseDefinition({ companyId: '1 OR 1=1' }).companyId).toBeUndefined()
  })

  it('bounds the tag list and the search string', () => {
    // An unbounded tagIds array becomes an unbounded `.in()` clause.
    const tooMany = Array.from({ length: 50 }, () => '22222222-2222-4222-8222-222222222222')
    expect(parseDefinition({ tagIds: tooMany }).tagIds).toBeUndefined()
    expect(parseDefinition({ search: 'x'.repeat(500) }).search).toBeUndefined()
  })

  it('drops one bad key without discarding the rest', () => {
    /*
     * ⚠️ A VIEW SAVED BY AN OLDER VERSION SHOULD LOSE THE FILTER THAT NO LONGER
     * EXISTS, NOT THE VIEW. Rejecting the whole object would turn a harmless
     * vocabulary change into "all your saved views vanished".
     */
    const mixed = parseDefinition({ sort: 'nonsense', search: 'acme', hasEmail: true })
    expect(mixed.sort).toBeUndefined()
    expect(mixed.search).toBe('acme')
    expect(mixed.hasEmail).toBe(true)
  })

  it('survives input that is not an object at all', () => {
    // One unparseable row must not break the whole views menu.
    for (const bad of [null, undefined, 'string', 42, []]) {
      expect(() => parseDefinition(bad)).not.toThrow()
    }
    expect(parseDefinition(null)).toEqual({})
  })
})

describe('viewToOptions', () => {
  it('always resets to page 1', () => {
    /*
     * Restoring somebody onto page 7 of a list they have not seen is
     * disorienting, and once the underlying data changes it is meaningless —
     * page 7 of a different result set is not where they left off.
     */
    const options = viewToOptions({ search: 'acme', sort: 'name' })
    expect(options.page).toBe(1)
  })

  it('carries the filters through', () => {
    const options = viewToOptions({ search: 'acme', hasEmail: false, sort: 'name' })
    expect(options.search).toBe('acme')
    expect(options.hasEmail).toBe(false)
    expect(options.sort).toBe('name')
  })
})

describe('the module is private-only by construction (DECISION-09)', () => {
  it('never writes is_shared true', async () => {
    /*
     * ⚠️ ASSERTED ON THE SOURCE because the alternative — a live insert — needs
     * a database, and this property is about what the code CAN do rather than
     * what one run did. `is_shared` exists in the schema for a future feature;
     * until DECISION-09 is revisited, writing it true from here would ship
     * sharing by accident.
     */
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const source = readFileSync(
      join(__dirname, '..', '..', 'lib/crm/saved-views.ts'),
      'utf8',
    ).replace(/^[ \t]*\/\/.*\n/gm, '')

    expect(source).toContain('is_shared: false')
    expect(source).not.toMatch(/is_shared:\s*true/)
  })

  it('every read filters by owner as well as workspace', () => {
    /*
     * Filtering by workspace alone would show every colleague's views to
     * everyone — which is the SHARED feature, arrived at by omission rather
     * than by decision.
     */
    const source = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '..', '..', 'lib/crm/saved-views.ts'),
      'utf8',
    )
    const statements = [...source.matchAll(/\.from\('crm_saved_views'\)([\s\S]{0,600}?)\n\n/g)]

    /*
     * ⚠️ INSERTS ARE EXCLUDED, AND THAT IS NOT A LOOPHOLE. An insert carries the
     * tenant in its PAYLOAD (`workspace_id: scope.workspaceId`), not in a
     * filter — there is no existing row to scope to. The first version of this
     * test swept the insert in and failed on correct code, which is the
     * fixed-window mistake in a different costume.
     */
    const reads = statements.filter(([, chain]) => !/^\s*\.insert\(/.test(chain))

    expect(reads.length, 'no read statements found — the scanner is broken').toBeGreaterThanOrEqual(3)
    for (const [, chain] of reads) {
      expect(chain).toContain("eq('workspace_id'")
      expect(chain).toContain("eq('owner_user_id'")
    }
  })
})
