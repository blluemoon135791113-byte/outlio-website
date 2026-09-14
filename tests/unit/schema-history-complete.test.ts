/**
 * Every object the live database has, a migration in this repo creates.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE MIGRATION HISTORY IS SUPPOSED TO BE ABLE TO REBUILD PRODUCTION.      ║
 * ║  RIGHT NOW IT CANNOT, AND NOTHING SAID SO.                                ║
 * ║                                                                           ║
 * ║  `linkedin_enrollments`, `linkedin_tasks` and `crm_unconvertible_deals`   ║
 * ║  exist in BOTH production and staging. No file under supabase/migrations  ║
 * ║  creates any of them. They were applied by hand and the migration was     ║
 * ║  never written — CLAUDE.md says migrations are applied by hand in the SQL ║
 * ║  editor, which is exactly the workflow that lets this happen.             ║
 * ║                                                                           ║
 * ║  ⚠️ THE FAILURE IS INVISIBLE UNTIL IT IS TOTAL. Every environment that     ║
 * ║  already has the objects keeps working forever. The bill arrives the      ║
 * ║  first time somebody builds a new one — a fresh staging project, a        ║
 * ║  disaster-recovery restore, a contributor's local stack — and it comes    ║
 * ║  back as a table that simply is not there.                                ║
 * ║                                                                           ║
 * ║  `scripts/check-migration.sh` cannot catch this. It replays the           ║
 * ║  prerequisites a migration names and asks whether THAT migration applies. ║
 * ║  An object no migration mentions is invisible to it by construction.      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ WHAT THIS CAN AND CANNOT SEE. `types/database.ts` is generated from the
 * production project by `npm run db:types`, so it is the only description of
 * the live schema that lives in the repo. That makes it a SNAPSHOT, not a live
 * read: this guard catches hand-applied SQL that was followed by a type
 * regeneration — which is precisely how the three below got here — and is blind
 * to hand-applied SQL that was not. It is the strongest production signal
 * available offline, not a complete one.
 *
 * ⚠️ FUNCTIONS ARE CHECKED IN ONE DIRECTION ONLY. `supabase gen types` lists
 * only what PostgREST can call, so trigger functions and internal helpers —
 * `crm_guard_append_only`, `set_updated_at`, `handle_new_user` — never appear
 * in the generated block at all. Asking "which migration functions are missing
 * from production?" against this file returns 25 false alarms, every one of
 * them a function that demonstrably exists. So the question asked here is only
 * ever "does the repo create what the types say is live?".
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')

/**
 * Objects that are live but that no migration creates.
 *
 * ⚠️ EMPTYING THIS LIST IS THE POINT. Each entry is a thing the history cannot
 * rebuild; the entry is a record of the debt, not permission to keep it.
 */
const KNOWN_MISSING = new Map<string, string>([
  [
    'linkedin_enrollments',
    'Applied by hand alongside the LinkedIn logic layer. 0122 created ' +
      'linkedin_senders / _sender_links / _sender_actions and stopped there — ' +
      'module-reachability.test.ts already records that the release pipeline ' +
      'was never built. Present in production and staging.',
  ],
  [
    'linkedin_tasks',
    'Same origin as linkedin_enrollments, which it references. Present in ' +
      'production and staging.',
  ],
  [
    'crm_unconvertible_deals',
    'A function, not a table — (p_workspace_id uuid, p_status text) returns ' +
      'integer. Present in production and staging; created by no migration.',
  ],
])

// ---------------------------------------------------------------------------
// What the live database has, according to the generated types.
// ---------------------------------------------------------------------------

const TYPES = readFileSync(join(ROOT, 'types', 'database.ts'), 'utf8')

/**
 * The generated block is one `public: { Tables: {…} Views: {…} Functions: {…}
 * Enums: {…} }` object, and every member sits at a fixed indent. Slicing
 * between the section headers is what keeps a table named like a function from
 * being counted as one.
 */
function section(name: string): number {
  const at = TYPES.search(new RegExp(`^ {4}${name}: \\{$`, 'm'))
  expect(at, `types/database.ts has no ${name} section — the generator changed shape`)
    .toBeGreaterThan(-1)
  return at
}

function membersOf(from: number, to: number): string[] {
  const names = TYPES.slice(from, to).match(/^ {6}([a-z_][a-z0-9_]*): \{$/gm) ?? []
  return names.map((line) => line.trim().replace(': {', ''))
}

const TABLES_AT = section('Tables')
const VIEWS_AT = section('Views')
const FUNCTIONS_AT = section('Functions')
const ENUMS_AT = section('Enums')

const liveTables = membersOf(TABLES_AT, VIEWS_AT)
const liveViews = membersOf(VIEWS_AT, FUNCTIONS_AT)
const liveFunctions = membersOf(FUNCTIONS_AT, ENUMS_AT)

// ---------------------------------------------------------------------------
// What the migrations create.
// ---------------------------------------------------------------------------

/*
 * ⚠️ COMMENTS ARE STRIPPED FIRST, AND `\r?\n` IS NOT OPTIONAL. A commented-out
 * `create table` would otherwise count as creating it, and `.` does not match
 * `\r`, so a `//`-style strip written with a bare `\n` silently does nothing
 * against a CRLF checkout. This repo has now hit that exact regression three
 * times in three different guards.
 */
const MIGRATIONS = readdirSync(join(ROOT, 'supabase', 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(join(ROOT, 'supabase', 'migrations', f), 'utf8'))
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/--.*\r?\n/g, '\n')
  .toLowerCase()

const q = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function createsTable(name: string): boolean {
  return new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${q(name)}\\b`)
    .test(MIGRATIONS)
}

function createsView(name: string): boolean {
  return new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?(?:materialized\\s+)?view\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${q(name)}\\b`,
  ).test(MIGRATIONS)
}

function createsFunction(name: string): boolean {
  return new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${q(name)}\\s*\\(`,
  ).test(MIGRATIONS)
}

// ---------------------------------------------------------------------------

describe('the migration history can rebuild the live schema', () => {
  const checks: [string, string[], (name: string) => boolean][] = [
    ['table', liveTables, createsTable],
    ['view', liveViews, createsView],
    ['function', liveFunctions, createsFunction],
  ]

  for (const [kind, live, creates] of checks) {
    it(`every live ${kind} is created by a migration`, () => {
      const missing = live.filter((name) => !creates(name) && !KNOWN_MISSING.has(name))

      expect(
        missing,
        `${missing.length} ${kind}(s) exist in the live database that no migration ` +
          `creates. A fresh environment built from supabase/migrations will not have ` +
          `them. Write the migration, or add an entry to KNOWN_MISSING saying why ` +
          `the debt is being carried.`,
      ).toEqual([])
    })
  }

  it('nothing in KNOWN_MISSING has quietly been fixed', () => {
    /*
     * ⚠️ AN ALLOWLIST THAT OUTLIVES ITS REASON IS A BLINDFOLD. Once the
     * migration lands, the entry must go — otherwise the next object to drift
     * under the same name is waved straight through.
     */
    const creates = new Map<string, (name: string) => boolean>([
      ...liveTables.map((n) => [n, createsTable] as const),
      ...liveViews.map((n) => [n, createsView] as const),
      ...liveFunctions.map((n) => [n, createsFunction] as const),
    ])

    const stale = [...KNOWN_MISSING.keys()].filter((name) => creates.get(name)?.(name))

    expect(
      stale,
      'a migration now creates these, so their KNOWN_MISSING entries are obsolete',
    ).toEqual([])
  })
})

describe('the scan is real, not an artefact of a broken parse', () => {
  /*
   * Every assertion above is of the form "this list is empty", which is exactly
   * what a parse that found nothing also reports. These are what separate the
   * two.
   */
  it('read the whole generated schema', () => {
    expect(liveTables.length).toBeGreaterThan(100)
    expect(liveFunctions.length).toBeGreaterThan(50)
  })

  it('read the whole migration corpus', () => {
    expect(MIGRATIONS.length).toBeGreaterThan(200_000)
  })

  it('recognises a create statement it should recognise', () => {
    // Spot-checked against real migrations: 0071 and 0122 create these.
    expect(createsTable('crm_contacts')).toBe(true)
    expect(createsTable('linkedin_senders')).toBe(true)
    expect(createsFunction('crm_win_rates')).toBe(true)
  })

  it('does not recognise a create statement that is not there', () => {
    expect(createsTable('crm_contacts_that_do_not_exist')).toBe(false)
    expect(createsFunction('not_a_real_function')).toBe(false)
  })

  it('still reports the three objects this guard was written for', () => {
    /*
     * ⚠️ THE REGRESSION THIS GUARD MOST NEEDS TO SURVIVE is somebody "fixing"
     * it by loosening the matcher until the list is empty. If these three ever
     * start looking created, the matcher became wrong before the schema became
     * right.
     */
    expect(createsTable('linkedin_enrollments')).toBe(false)
    expect(createsTable('linkedin_tasks')).toBe(false)
    expect(createsFunction('crm_unconvertible_deals')).toBe(false)

    expect(liveTables).toContain('linkedin_enrollments')
    expect(liveTables).toContain('linkedin_tasks')
    expect(liveFunctions).toContain('crm_unconvertible_deals')
  })
})
