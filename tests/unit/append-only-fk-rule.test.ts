/**
 * `ON DELETE SET NULL` may never point out of an append-only table.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS BUG HAS NOW BEEN FOUND TWICE, AND THE SECOND TIME WAS BECAUSE THE  ║
 * ║  FIRST FIX BELIEVED ITSELF COMPLETE.                                     ║
 * ║                                                                           ║
 * ║  Nulling a foreign key is an UPDATE. The append-only guard rejects        ║
 * ║  UPDATE. So any row referenced by an append-only table through a SET NULL ║
 * ║  foreign key becomes PERMANENTLY UNDELETABLE — and the error names the    ║
 * ║  guard, not the constraint, so the reader looks in the wrong place.       ║
 * ║                                                                           ║
 * ║    0091 fixed `email_events` and stated that `crm_activities` "has been   ║
 * ║    right all along". It had checked the ENTITY references and not the     ║
 * ║    USER ones. Four tables still carried the trap.                        ║
 * ║                                                                           ║
 * ║    0109 fixed those four, found only because deleting 121 test users      ║
 * ║    failed in production.                                                  ║
 * ║                                                                           ║
 * ║  ⚠️ NO TYPE, LINT OR BUILD STEP CAN SEE THIS. It lives in SQL, and it     ║
 * ║  only surfaces when somebody deletes a row that happens to be referenced. ║
 * ║  A migration test is the only thing standing between this and a third     ║
 * ║  occurrence.                                                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const MIGRATIONS = join(__dirname, '..', '..', 'supabase', 'migrations')

const sql = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => ({ file: f, body: readFileSync(join(MIGRATIONS, f), 'utf8') }))

const all = sql.map((s) => s.body).join('\n')

/**
 * Tables the append-only guard is attached to.
 *
 * ⚠️ THE TRIGGER MUST EXECUTE `crm_guard_append_only`. An earlier version
 * matched on `before update or delete` alone and swept in
 * `workspace_memberships`, which has an unrelated trigger — reporting a table
 * that is not append-only at all.
 */
function appendOnlyTables(): string[] {
  const found = new Set<string>()
  for (const match of all.matchAll(
    /create trigger\s+\w+\s+before update or delete on public\.(\w+)\s+for each row execute function public\.crm_guard_append_only\(\)/g,
  )) {
    found.add(match[1]!)
  }
  return [...found].sort()
}

/**
 * Every (table, column) a later migration has re-pointed at NO ACTION.
 *
 * ⚠️ TWO REPAIR STYLES, BOTH CONCRETE. 0091 re-adds the constraint by name;
 * 0109 repairs by lookup and lists the pairs it targets. An earlier version of
 * this test tried to infer repair from a loose regex over the whole file and
 * reported correctly-fixed tables as broken.
 */
function repairedPairs(): Set<string> {
  const repaired = new Set<string>()

  for (const { body } of sql) {
    /*
     * Style A — an `alter table` statement, which may carry SEVERAL
     * `add constraint` clauses. 0091 re-adds four in one statement, and an
     * earlier parser here anchored each clause to its own `alter table` and so
     * saw only the first — reporting three correctly-repaired columns as
     * broken.
     */
    for (const statement of body.matchAll(/alter table public\.(\w+)([\s\S]*?);/g)) {
      const table = statement[1]!
      for (const clause of statement[2]!.split(/,\s*(?=add constraint)/)) {
        const fk = clause.match(/add constraint \w+\s+foreign key \((\w+)\)/)
        if (fk && !/on delete set null/.test(clause)) repaired.add(`${table}.${fk[1]}`)
      }
    }

    // Style B — a values list of the (table, column) pairs a migration repairs.
    for (const match of body.matchAll(/\('(\w+)',\s*'(\w+)'\)/g)) {
      repaired.add(`${match[1]}.${match[2]}`)
    }
  }

  return repaired
}

describe('the append-only inventory', () => {
  it('finds the guarded tables', () => {
    // Guards the scanner itself: a change in how the trigger is written would
    // otherwise make every assertion below vacuous against an empty set.
    const tables = appendOnlyTables()
    expect(tables.length).toBeGreaterThanOrEqual(6)
    expect(tables).toContain('crm_activities')
    expect(tables).toContain('crm_opportunity_stage_history')
    expect(tables).toContain('email_events')
  })
})

describe('no append-only table keeps a SET NULL reference', () => {
  const tables = appendOnlyTables()

  /**
   * The columns declared `on delete set null` inside a table's CREATE, minus
   * anything a later migration re-pointed at NO ACTION.
   */
  function unfixedSetNullColumns(table: string): string[] {
    const create = all.match(
      new RegExp(`create table if not exists public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`),
    )
    if (!create) return []

    const declared = [...create[1]!.matchAll(/^\s*(\w+)\s+uuid[^,]*on delete set null/gm)].map(
      (m) => m[1]!,
    )

    // A later migration re-pointing the column at NO ACTION counts as fixed.
    const repaired = repairedPairs()
    return declared.filter((column) => !repaired.has(`${table}.${column}`))
  }

  for (const table of tables) {
    it(`${table} has no unrepaired SET NULL reference`, () => {
      const offenders = unfixedSetNullColumns(table)
      expect(
        offenders,
        `${table} nulls ${offenders.join(', ')} on delete — which is an UPDATE the ` +
          `append-only guard rejects, making the referenced row undeletable. ` +
          `Re-point it at NO ACTION, as 0091 and 0109 did.`,
      ).toEqual([])
    })
  }
})

describe('0109 repairs by lookup, not by guessed name', () => {
  const body = sql.find((s) => s.file.startsWith('0109'))?.body ?? ''

  it('exists', () => {
    expect(body, '0109 is missing').not.toBe('')
  })

  it('finds the constraint in pg_constraint rather than naming it', () => {
    /*
     * ⚠️ THE FAILURE THIS AVOIDS IS SILENT. `drop constraint if exists` against
     * a guessed name that is wrong does NOTHING; the `add` then succeeds under
     * a new name and the table keeps BOTH constraints, the old SET NULL one
     * still live. The migration would report success and change nothing.
     */
    expect(body).toContain('pg_constraint')
    expect(body).toContain("c.confdeltype = 'n'")
    expect(body).not.toMatch(/drop constraint if exists \w+_fkey/)
  })

  it('is idempotent', () => {
    // Only SET NULL constraints are touched, so a second run is a no-op.
    expect(body).toContain("and c.confdeltype = 'n'")
  })

  it('verifies its own result', () => {
    /*
     * A `do` block that finds nothing looks exactly like one that worked, and
     * this is the SECOND attempt at this bug — 0091 believed it was done.
     */
    expect(body).toContain('raise exception')
    expect(body).toContain('0109 failed')
  })

  it('covers every table 0091 missed', () => {
    for (const table of [
      'crm_activities',
      'crm_audit_logs',
      'crm_merge_events',
      'crm_opportunity_stage_history',
    ]) {
      expect(body, `${table} is not repaired`).toContain(table)
    }
  })
})
