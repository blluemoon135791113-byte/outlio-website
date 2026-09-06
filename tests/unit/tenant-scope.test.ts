/**
 * The tenancy map must agree with the actual schema, for every table.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS CODEBASE HAS TWO TENANCY MODELS AND BOTH ARE LIVE.                 ║
 * ║                                                                           ║
 * ║  64 tables carry `workspace_id`, 42 carry only `user_id`, and 18 carry    ║
 * ║  neither. The split is a fossil of the product's history: everything was  ║
 * ║  user-scoped before the CRM, and nothing was migrated.                   ║
 * ║                                                                           ║
 * ║  ⚠️ THE DANGEROUS PART IS THAT THE WRONG FILTER STILL RUNS.               ║
 * ║  `.eq('workspace_id', …)` against a user-scoped table does not error —    ║
 * ║  PostgREST returns a 400 for an unknown column on some paths and an empty ║
 * ║  set on others, and an empty set reads exactly like "this tenant has no   ║
 * ║  data yet". The opposite mistake is worse: treating a workspace table as  ║
 * ║  global returns EVERY tenant's rows and looks like a feature working.    ║
 * ║                                                                           ║
 * ║  So `TABLE_TENANCY` is not documentation. This file makes it a claim      ║
 * ║  about the schema that fails when it stops being true.                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  TABLE_TENANCY,
  assertKnownTable,
  tenantColumn,
  UnscopedTableError,
} from '@/lib/auth/scope'

const MIGRATIONS = join(__dirname, '..', '..', 'supabase', 'migrations')

const SQL = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
  .join('\n')

/**
 * Every table and the columns its CREATE declares.
 *
 * ⚠️ COLUMNS ADDED LATER BY `alter table ... add column` ARE FOLDED IN. A table
 * that gained `workspace_id` in a later migration is workspace-scoped now, and
 * reading only the CREATE would classify it by its original shape — which is
 * precisely the fossil this file exists to track.
 */
function schema(): Map<string, string[]> {
  const out = new Map<string, string[]>()

  for (const m of SQL.matchAll(
    /create table (?:if not exists )?public\.(\w+)\s*\(([\s\S]*?)\n\);/g,
  )) {
    const columns = [...m[2]!.matchAll(/^\s{2}(\w+)\s+/gm)].map((c) => c[1]!)
    out.set(m[1]!, [...(out.get(m[1]!) ?? []), ...columns])
  }

  for (const m of SQL.matchAll(
    /alter table (?:public\.)?(\w+)\s+add column (?:if not exists )?(\w+)/g,
  )) {
    const existing = out.get(m[1]!)
    if (existing) existing.push(m[2]!)
  }

  return out
}

const SCHEMA = schema()

describe('the scanner itself', () => {
  it('reads the schema', () => {
    // Without this every assertion below is vacuous against an empty map.
    expect(SCHEMA.size).toBeGreaterThan(100)
    expect(SCHEMA.get('crm_contacts')).toContain('workspace_id')
    expect(SCHEMA.get('extracted_leads')).toContain('user_id')
  })

  it('picks up a column added by a later migration', () => {
    /*
     * `workspaces.sender_postal_address` arrives in 0111 via `alter table`, not
     * in the 0070 CREATE. A scanner that read only CREATEs would miss it — and
     * would miss a `workspace_id` added the same way, which is the case that
     * matters.
     */
    expect(SCHEMA.get('workspaces')).toContain('sender_postal_address')
  })
})

describe('every table is classified, and the classification is true', () => {
  for (const [table, columns] of SCHEMA) {
    it(table, () => {
      const expected = tenantColumn(table)

      if (expected === null) {
        /*
         * Declared global. Assert it really has no tenant column — a table that
         * HAS `workspace_id` and is marked global returns every tenant's rows,
         * which is the worst of the two mistakes and the one that looks like a
         * working feature.
         */
        const stray = ['workspace_id', 'user_id'].filter((c) => columns.includes(c))
        expect(
          stray,
          `${table} is classified 'global' in TABLE_TENANCY but declares ${stray.join(
            ' and ',
          )}. A global read of a tenant table returns EVERY tenant's rows and ` +
            `looks like the feature working. Reclassify it.`,
        ).toEqual([])
        return
      }

      expect(
        columns,
        `${table} is treated as ${TABLE_TENANCY[table] ?? 'workspace'}-scoped, so ` +
          `queries filter on ${expected} — but the table has no such column. That ` +
          `filter matches nothing and renders as an empty state, so nobody notices. ` +
          `Add ${table} to TABLE_TENANCY with its real tenancy.`,
      ).toContain(expected)
    })
  }
})

describe('assertKnownTable', () => {
  it('accepts a table whose columns match its classification', () => {
    expect(() => assertKnownTable('crm_contacts', ['id', 'workspace_id'])).not.toThrow()
    expect(() => assertKnownTable('extracted_leads', ['id', 'user_id'])).not.toThrow()
  })

  it('accepts a global table without asserting anything', () => {
    expect(() => assertKnownTable('plans', ['id'])).not.toThrow()
  })

  it('throws when the tenant column is absent', () => {
    // The failure this converts from silent to loud.
    expect(() => assertKnownTable('crm_contacts', ['id'])).toThrow(UnscopedTableError)
  })
})

describe('the default is workspace, and that is deliberate', () => {
  it('an unlisted table is treated as workspace-scoped', () => {
    /*
     * ⚠️ THE DEFAULT IS SAFE ONLY BECAUSE THE SUITE ABOVE CHECKS IT. A new table
     * without `workspace_id` inherits this default and immediately fails its
     * generated test, naming itself. Defaulting to 'global' would instead let a
     * new tenant table be read across tenants with nothing to notice.
     */
    expect(tenantColumn('some_table_added_next_week')).toBe('workspace_id')
  })

  it('lists only the exceptions, so the map cannot rot', () => {
    // 64 workspace tables are NOT listed on purpose; enumerating them would
    // create a second source of truth that drifts from the schema.
    const listed = Object.keys(TABLE_TENANCY)
    expect(listed.every((t) => TABLE_TENANCY[t] !== 'workspace')).toBe(true)
  })
})
