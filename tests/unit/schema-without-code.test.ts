/**
 * Every table the migrations create must be read or written by something.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  `crm_saved_views` HAS A TABLE, A PRIMARY KEY, RLS POLICIES AND INDEXES. ║
 * ║  IT HAS ZERO REFERENCES IN `app/`, `lib/` AND `components/`.             ║
 * ║                                                                           ║
 * ║  This is not dead code. It is the opposite: a schema nobody ever wrote    ║
 * ║  code against. Nothing can detect it, because there is no code to inspect ║
 * ║  — the defect lives entirely in the gap between two artefacts that are    ║
 * ║  each individually fine.                                                  ║
 * ║                                                                           ║
 * ║  ⚠️ IT COSTS MORE THAN AN UNUSED TABLE. Migrations are the most           ║
 * ║  authoritative description of the product most readers will find. A table ║
 * ║  called `crm_saved_views` with sensible columns reads as "saved views     ║
 * ║  exist", and Phase 0 had to check production row counts to establish that ║
 * ║  they do not.                                                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const MIGRATIONS = join(ROOT, 'supabase', 'migrations')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, entry)
    if (statSync(join(ROOT, rel)).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue
      out.push(...walk(rel))
    } else if (/\.tsx?$/.test(entry)) {
      out.push(rel)
    }
  }
  return out
}

const CODE = [...walk('app'), ...walk('lib'), ...walk('components'), ...walk('types')]
  .map((f) => readFileSync(join(ROOT, f), 'utf8'))
  .join('\n')

const SQL = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
  .join('\n')

/** Every table created in the migrations. */
function declaredTables(): string[] {
  const found = new Set<string>()
  for (const m of SQL.matchAll(/create table (?:if not exists )?public\.(\w+)/g)) {
    found.add(m[1]!)
  }
  return [...found].sort()
}

/**
 * The bodies of every SQL function in the migrations, comments stripped.
 *
 * ⚠️ WITHOUT THIS THE GUARD IS WRONG, AND ITS FIRST VERSION WAS. Plenty of
 * tables here are never named in TypeScript because the application reaches
 * them through a function: `rate_limits` via the `consume_rate_limit` RPC,
 * `fastspring_orders` written inside a webhook handler in 0069, the three
 * `signup_*_claims` tables written by `handle_new_user`. Scanning only
 * `.from()` reported 26 live tables as dead — and a guard that accuses 26
 * innocents is one nobody will keep.
 */
const SQL_FUNCTION_BODIES = [...SQL.matchAll(/as \$\$([\s\S]*?)\$\$;/g)]
  .map((m) => m[1]!)
  .join('\n')
  .replace(/^\s*--.*$/gm, '')

/**
 * Whether anything — application or database — has code that uses this table.
 *
 * ⚠️ A BARE NAME MATCH IS NOT ENOUGH. `profiles` appears in prose constantly,
 * so substring matching would call every table live. This looks for the shapes
 * that actually reach a table: a PostgREST query, the generated row types, or a
 * qualified reference inside a SQL function body.
 */
function isReferenced(table: string): boolean {
  const inApp = [
    new RegExp(`\\.from\\(\\s*['"\`]${table}['"\`]`),
    new RegExp(`['"\`]${table}['"\`]\\s*:\\s*\\{`), // generated Database type key
  ].some((p) => p.test(CODE))

  // `public.x` or a bare `x` in a from/join/into position — never a loose
  // substring, so `crm_contacts` cannot vouch for `crm_contacts_archive`.
  const inSql = new RegExp(
    `(?:public\\.${table}\\b)|(?:\\b(?:from|join|into|update|table)\\s+${table}\\b)`,
  ).test(SQL_FUNCTION_BODIES)

  return inApp || inSql
}

/**
 * Tables known to have schema and no code at all.
 *
 * ⚠️ MAY ONLY EVER SHRINK. Each entry is a decision owed: build it or drop the
 * table. Phase 0 filed `crm_saved_views` as NOT_IMPLEMENTED for exactly this.
 */
const KNOWN_UNUSED = new Set([
  // Phase 0, evidence #5 — the one found by hand.
  'crm_saved_views',
  /*
   * The eight below were found by this guard. Phase 0's manual audit found ONE
   * of the nine, which is the argument for automating it. Each was verified to
   * have zero `.from()` calls and no SQL function body touching it.
   *
   * Three clusters, and they are different problems:
   *   • crm_custom_field_definitions — the table half of evidence #4, whose
   *     library half (lib/crm/custom-fields.ts) is in orphan-module.test.ts.
   *     Note its sibling `crm_custom_field_values` is NOT here: it is named in
   *     a SQL function, so only half the feature is unreachable.
   *   • web_research_* (3) — a research subsystem superseded by lib/hubble.
   *   • email_templates, email_webhook_deliveries, export_destinations,
   *     company_links, company_signals — built ahead of the features.
   */
  'company_links',
  'company_signals',
  'crm_custom_field_definitions',
  'email_templates',
  'email_webhook_deliveries',
  'export_destinations',
  'web_research_cache',
  'web_research_jobs',
  'web_research_lead_results',
])

describe('the scanner itself', () => {
  it('finds the declared tables', () => {
    const tables = declaredTables()
    expect(tables.length).toBeGreaterThan(80)
    expect(tables).toContain('crm_contacts')
    expect(tables).toContain('crm_saved_views')
  })

  it('recognises a table the app really uses', () => {
    // Without this, a change to how queries are written would report every
    // table as unused and the guard would be muted.
    expect(isReferenced('crm_contacts')).toBe(true)
  })

  it('recognises a table reached only through a SQL function', () => {
    /*
     * ⚠️ THE REGRESSION THIS PINS. `rate_limits` is never named in TypeScript —
     * the app calls the `consume_rate_limit` RPC. An app-only scan called it
     * dead, along with 25 others.
     */
    expect(/\.from\(\s*['"`]rate_limits['"`]/.test(CODE)).toBe(false)
    expect(isReferenced('rate_limits')).toBe(true)
  })

  it('does not count a table named only in prose', () => {
    // The reason `isReferenced` looks for call shapes rather than bare names.
    expect(/\.from\(\s*['"`]totally_made_up_table['"`]/.test(CODE)).toBe(false)
  })
})

describe('no table exists without code that uses it', () => {
  const unused = declaredTables().filter(
    (t) => !isReferenced(t) && !KNOWN_UNUSED.has(t),
  )

  it('every declared table is reachable from the application', () => {
    expect(
      unused,
      `These tables are created by a migration and never queried. A schema with ` +
        `no code reads to the next person as a feature that exists — which is how ` +
        `crm_saved_views survived. Either write the code, drop the table, or add ` +
        `it to KNOWN_UNUSED with a decision recorded in 03_ADRS.md.`,
    ).toEqual([])
  })

  for (const known of KNOWN_UNUSED) {
    it(`${known} still has no code (remove from the list once built)`, () => {
      // Both directions, so the allowlist cannot become a permanent exemption.
      expect(
        isReferenced(known),
        `${known} is now referenced — remove it from KNOWN_UNUSED.`,
      ).toBe(false)
    })
  }
})
