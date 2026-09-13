/**
 * Every module entitlement must be granted by a migration, not by hand.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ `linkedin_enabled` WAS TYPED INTO THE SUPABASE SQL EDITOR AND NEVER    ║
 * ║  WRITTEN DOWN, AND THAT IS THE ENTIRE DEFECT.                             ║
 * ║                                                                           ║
 * ║  It was applied by hand, and then a SECOND hand-applied statement set      ║
 * ║  `linkedin_senders_max` from a scratch file that had been overwritten in   ║
 * ║  between. Production ended up with a sender CAP on a module the plan was   ║
 * ║  not ENTITLED to — a shape no code path produces, because no code path     ║
 * ║  creates it.                                                              ║
 * ║                                                                           ║
 * ║  Nothing could detect it. Not `npm test`, not typecheck, not a reviewer    ║
 * ║  reading migrations in order, not a fresh environment — which would have   ║
 * ║  replayed 0002..0126 and produced a database where LinkedIn is off for     ║
 * ║  everyone, correctly, permanently, and silently. Migrations are applied by ║
 * ║  hand in this project (CLAUDE.md), so "it is in the repo" is the ONLY      ║
 * ║  durable record that an entitlement was ever meant to exist.              ║
 * ║                                                                           ║
 * ║  This test is that record's enforcement. It reads the module map in        ║
 * ║  `entitlements.ts` — not a list copied here — so a module added later is   ║
 * ║  covered the day it is added rather than the day someone remembers.       ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')

/**
 * ⚠️ COMMENTS STRIPPED BEFORE MATCHING. These migrations quote the rules they
 * obey, at length — 0127's own header names every key it sets and several it
 * deliberately does not. Searching the raw text finds the PROSE and reports a
 * grant that no statement performs. This trap has now been hit five times in
 * this codebase; it is not hypothetical.
 */
function sqlBody(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
}

const MIGRATIONS = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({
    name,
    body: sqlBody(readFileSync(join(MIGRATIONS_DIR, name), 'utf8')),
  }))

/** The module → limits-key map, read from the source of truth. */
function entitlementKeys(): string[] {
  const source = readFileSync(join(ROOT, 'lib/workspaces/entitlements.ts'), 'utf8')
  const block = source.slice(
    source.indexOf('const ENTITLEMENT_KEY'),
    source.indexOf('MODULE_FLAG'),
  )
  return [...block.matchAll(/'(\w+_enabled)'/g)].map((m) => m[1]!)
}

describe('the scanner sees what it polices', () => {
  it('reads the migrations and the module map', () => {
    // Vacuity: an empty list would make every assertion below pass over
    // nothing, which is the shape of most tests that fail to catch anything.
    expect(MIGRATIONS.length).toBeGreaterThan(120)
    expect(entitlementKeys().length).toBeGreaterThanOrEqual(7)
    expect(entitlementKeys()).toContain('linkedin_enabled')
  })

  it('strips comments rather than matching prose', () => {
    /*
     * ⚠️ PROVES THE STRIPPER WORKS, because if it silently did nothing the
     * suite would still be green — every assertion here is satisfied MORE
     * easily by unstripped text. A guard that cannot fail is decoration.
     */
    const stripped = sqlBody("-- grants foo_enabled to everyone\nselect 1;\n/* bar_enabled */\n")
    expect(stripped).not.toContain('foo_enabled')
    expect(stripped).not.toContain('bar_enabled')
    expect(stripped).toContain('select 1;')

    // And the real 0127 header talks about `starter` and `agency` WITHOUT
    // granting them anything — the precise way prose-matching would lie here.
    const raw = readFileSync(join(MIGRATIONS_DIR, '0127_linkedin_plan_entitlement.sql'), 'utf8')
    expect(raw, 'the header no longer explains the exclusions').toContain('agency')
    const body = sqlBody(raw)
    expect(body, "prose about `agency` is being read as a grant").not.toMatch(
      /where key = 'agency'/,
    )
  })
})

describe('no entitlement exists only in production', () => {
  it('every module key is granted by some migration', () => {
    const missing = entitlementKeys().filter(
      (key) => !MIGRATIONS.some(({ body }) => body.includes(key)),
    )

    expect(
      missing,
      'These module entitlements are read by `entitlements.ts` but no migration ' +
        'ever sets them. If one is live today it was applied by hand, and a ' +
        'fresh environment will silently have the module switched off for every ' +
        'plan — which is exactly how `linkedin_enabled` went missing. Add it to ' +
        'a migration.',
    ).toEqual([])
  })

  it('0103 still carries the six it always did', () => {
    // ⚠️ NAMED SEPARATELY so that deleting 0103 cannot be masked by 0127
    // happening to mention a key in passing.
    const m0103 = MIGRATIONS.find((m) => m.name.startsWith('0103'))
    expect(m0103, '0103 moved').toBeDefined()
    for (const key of [
      'crm_enabled',
      'email_enabled',
      'flows_enabled',
      'reports_enabled',
      'integrations_enabled',
      'hubble_enabled',
    ]) {
      expect(m0103!.body, `0103 no longer grants ${key}`).toContain(key)
    }
  })
})

describe('the entitlement and its cap cannot be set apart', () => {
  const CAP = 'linkedin_senders_max'
  const ENABLED = 'linkedin_enabled'

  it('no migration sets the cap without the entitlement', () => {
    /*
     * ⚠️ THE EXACT PRODUCTION SHAPE. A cap with no entitlement reads as
     * "LinkedIn is off" while carrying a number that says otherwise; an
     * entitlement with no cap connects senders without limit, which is worse.
     * §4.10 caps borrowed accounts, and an unbounded cap is not a cap.
     */
    const offenders = MIGRATIONS.filter(
      ({ body }) => body.includes(CAP) !== body.includes(ENABLED),
    ).map((m) => m.name)

    expect(
      offenders,
      'These set the LinkedIn sender cap and the LinkedIn entitlement in ' +
        'different migrations. They answer one question — may this workspace ' +
        'connect senders, and how many — and a partial apply leaves a state no ' +
        'code path expects. Set both in one statement.',
    ).toEqual([])
  })

  it('0127 sets both, per plan, in one statement each', () => {
    const m = MIGRATIONS.find((x) => x.name.startsWith('0127'))
    expect(m, '0127 moved').toBeDefined()

    for (const [plan, cap] of [
      ['trial', '2'],
      ['professional', '10'],
      ['custom', '20'],
    ] as const) {
      /*
       * ⚠️ ANCHORED ON THE WHOLE STATEMENT, not on the plan name appearing
       * somewhere near a number. `toContain('trial')` passes against a comment,
       * against `where key = 'trial'` in an unrelated UPDATE, and against a
       * statement that sets only one of the two keys — all three of which are
       * the bug rather than the fix.
       */
      const statement = m!.body
        .split(/;\s*/)
        .find((s) => s.includes(`where key = '${plan}'`) && s.includes(ENABLED))
      expect(statement, `0127 no longer grants LinkedIn to ${plan}`).toBeDefined()
      expect(statement!, `${plan} is entitled without a cap`).toContain(CAP)
      expect(statement!, `${plan}'s cap is not ${cap}`).toMatch(
        new RegExp(`'${CAP}',\\s*${cap}\\b`),
      )
    }
  })

  it('starter and agency are excluded on purpose, not by omission', () => {
    /*
     * Asserted as an ABSENCE, so that "everyone gets LinkedIn" cannot be
     * shipped as a one-word edit. starter is the tier LinkedIn is the reason to
     * leave; agency's blob is already malformed (`plan-limits-blob.test.ts`)
     * and adding keys to it would make it look more complete than it is.
     */
    const m = MIGRATIONS.find((x) => x.name.startsWith('0127'))!
    expect(m.body, 'starter was quietly entitled').not.toMatch(/where key = 'starter'/)
    expect(m.body, 'agency was quietly entitled').not.toMatch(/where key = 'agency'/)
  })

  it('the merge preserves production rather than resetting it', () => {
    /*
     * ⚠️ DIRECTION IS LOad-BEARING AND INVISIBLE. `jsonb_build_object(...) ||
     * limits` lets the EXISTING blob win, so a per-plan override survives.
     * `limits || jsonb_build_object(...)` is one character of difference, reads
     * identically, and silently resets every override made since.
     *
     * 0015 shows what the wrong direction costs: `limits = excluded.limits`
     * replaces the blob wholesale, and every entitlement added after it
     * survives only because it happens to run later in file order.
     */
    const m = MIGRATIONS.find((x) => x.name.startsWith('0127'))!
    expect(m.body).toMatch(/\)\s*\|\|\s*limits/)
    expect(m.body, 'the merge direction was flipped; overrides will be reset').not.toMatch(
      /set limits = limits \|\| jsonb_build_object/,
    )
  })

  it('the database refuses a split pair itself', () => {
    // The migration carries its own check, so the failure that wasted an
    // afternoon becomes an error with a name rather than a quiet NULL in a
    // SELECT. Verified against Postgres 16: it rejects `starter` given a cap
    // and no entitlement.
    const m = MIGRATIONS.find((x) => x.name.startsWith('0127'))!
    expect(m.body).toMatch(/raise exception/)
    expect(m.body).toMatch(/\(limits \? 'linkedin_enabled'\) <> \(limits \? 'linkedin_senders_max'\)/)
  })
})
