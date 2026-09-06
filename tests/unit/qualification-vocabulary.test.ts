/**
 * The qualification allow-list must match the research vocabulary.
 *
 * `qualification_rules.field` is CHECK-constrained in Postgres to a list of
 * business attributes — the compliance boundary of spec §44. `RESEARCH_FIELDS`
 * is the same list in TypeScript. They are maintained by hand, in different
 * languages, in different files.
 *
 * They drifted. Eleven fields shipped in TypeScript without reaching the
 * constraint, and because `ProfileManager.tsx` offers every research field in
 * its dropdown while `lib/qualification/actions.ts` validates with
 * `z.enum(RESEARCH_FIELDS)`, choosing one of them passed validation and then
 * died on a constraint violation the user could do nothing about.
 *
 * ⚠️ THIS TEST IS THE REASON THAT CANNOT HAPPEN AGAIN. Adding a research field
 * without a migration fails here, loudly, at the point the field is added.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { RESEARCH_FIELDS } from '@/lib/intelligence/types'

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations')

/**
 * The allow-list as the database will actually enforce it.
 *
 * Each migration that widens the vocabulary drops and recreates the constraint,
 * so the LAST definition in migration order is the live one. Reading anything
 * earlier would test a constraint that no longer exists.
 */
function liveAllowList(): string[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()

  let latest: string | null = null

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    const blocks = sql.split('add constraint qualification_rules_field_check').slice(1)
    if (blocks.length > 0) latest = blocks[blocks.length - 1]!
  }

  if (latest === null) {
    throw new Error('No qualification_rules_field_check constraint found in any migration')
  }

  const body = latest.split('));')[0] ?? ''
  return [...body.matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]!)
}

describe('the qualification allow-list and the research vocabulary', () => {
  const allowed = liveAllowList()

  it('found a constraint to check, rather than passing on an empty list', () => {
    // A parse that silently returned nothing would make every assertion below
    // vacuously true — the exact failure mode this file exists to prevent.
    expect(allowed.length).toBeGreaterThan(40)
  })

  it('allows every research field', () => {
    const missing = RESEARCH_FIELDS.filter((field) => !allowed.includes(field))

    expect(
      missing,
      `These fields exist in RESEARCH_FIELDS but the database would reject a ` +
        `qualification rule on them. Add a migration widening ` +
        `qualification_rules_field_check: ${missing.join(', ')}`,
    ).toEqual([])
  })

  it('allows nothing that is not a research field', () => {
    // A stale entry is the milder direction, but it means the compliance
    // boundary permits something no provider can produce or explain.
    const orphaned = allowed.filter((field) => !RESEARCH_FIELDS.includes(field as never))
    expect(orphaned).toEqual([])
  })

  it('lists each field exactly once', () => {
    const duplicates = allowed.filter((field, index) => allowed.indexOf(field) !== index)
    expect(duplicates).toEqual([])
  })
})
