/**
 * §5.6 Money — the fx snapshot is absent, and that is safe for exactly one
 * reason. This file is what fails when that reason stops holding.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  §5.6: "Snapshot `fx_rate_to_workspace_currency` + `fx_rate_date` at      ║
 * ║  opportunity create and at close. Rollups use the snapshot. Historical    ║
 * ║  numbers never change because a rate moved today."                       ║
 * ║                                                                           ║
 * ║  Neither column exists. `crm_opportunities` has `value_amount` and        ║
 * ║  `currency`, and no rate anywhere.                                       ║
 * ║                                                                           ║
 * ║  ⚠️ THAT IS CURRENTLY FINE, FOR ONE REASON ONLY: every deal is USD.        ║
 * ║  `currency` defaults to 'USD', `createOpportunity` takes an optional      ║
 * ║  `currency` that NO CALLER PASSES — not the server action, not the flow   ║
 * ║  action — and there is no update path for it. A single-currency workspace ║
 * ║  needs no conversion, so an fx snapshot would be machinery for a          ║
 * ║  population of zero, and choosing a rate source is an owner decision with ║
 * ║  a cost attached.                                                        ║
 * ║                                                                           ║
 * ║  ⚠️ AND IT IS PRIMED TO BREAK SILENTLY. Migration 0082 rolls up won deals ║
 * ║  as `coalesce(sum(o.value_amount), 0)` with NO grouping by currency. The  ║
 * ║  day a currency picker is wired, a €10,000 deal and a $10,000 deal sum to ║
 * ║  20,000 — a number that is not money in any currency — and nothing        ║
 * ║  errors. Reporting would simply be wrong.                                ║
 * ║                                                                           ║
 * ║  So this file does not build an fx system. It makes the assumption        ║
 * ║  explicit and fails the moment it is violated, which is the only honest   ║
 * ║  thing to do with a latent money bug.                                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    let entries: string[]
    try {
      entries = readdirSync(d)
    } catch {
      return
    }
    for (const name of entries) {
      if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue
      const full = join(d, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.tsx?$/.test(full)) out.push(full)
    }
  }
  walk(dir)
  return out
}

const PRODUCT = [
  ...sourceFiles(join(ROOT, 'lib')),
  ...sourceFiles(join(ROOT, 'app')),
  ...sourceFiles(join(ROOT, 'components')),
].map((f) => ({ file: relative(ROOT, f).split('\\').join('/'), code: strip(readFileSync(f, 'utf8')) }))

/** The opportunities module owns the default; it is not a caller of itself. */
const OWNER = 'lib/crm/opportunities.ts'

/** Does the schema carry §5.6's snapshot yet? */
const MIGRATIONS = readdirSync(join(ROOT, 'supabase', 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(join(ROOT, 'supabase', 'migrations', f), 'utf8'))
  .join('\n')

const hasFxSnapshot =
  /fx_rate_to_workspace_currency/.test(MIGRATIONS) && /fx_rate_date/.test(MIGRATIONS)

/** Callers that hand `createOpportunity` a currency of their own. */
const currencyCallers = PRODUCT.filter(
  (f) =>
    f.file !== OWNER &&
    /createOpportunity\s*\(/.test(f.code) &&
    /\bcurrency\s*:/.test(f.code),
).map((f) => f.file)

describe('the scanner can see what it polices', () => {
  it('finds the opportunities module and its callers', () => {
    /*
     * Vacuity: a rename of `createOpportunity` would otherwise make the
     * assertions below pass against an empty set — the defect this project
     * keeps finding in its own guards.
     */
    expect(PRODUCT.length).toBeGreaterThan(300)
    const callers = PRODUCT.filter((f) => f.file !== OWNER && /createOpportunity\s*\(/.test(f.code))
    expect(callers.length, 'no callers of createOpportunity found — scan is broken').toBeGreaterThanOrEqual(2)
  })

  it('reads the migrations', () => {
    expect(MIGRATIONS).toContain('crm_opportunities')
  })
})

describe('money is single-currency, and the code says so', () => {
  it('no caller supplies a currency, so every deal is the default', () => {
    expect(
      currencyCallers,
      'A caller now sets a currency on an opportunity. Reporting cannot handle ' +
        'that: migration 0082 sums value_amount with no grouping by currency, so ' +
        'mixed-currency deals add together into a number that is not money. ' +
        'Implement §5.6 — fx_rate_to_workspace_currency and fx_rate_date ' +
        'snapshotted at create and at close, and a rollup that uses them — ' +
        'before wiring this up.',
    ).toEqual([])
  })

  it('the rollup still has no currency grouping, which is why the above matters', () => {
    /*
     * Asserted so the two facts stay tied together. If someone adds grouping,
     * this fails and points them at removing the single-currency assumption
     * rather than leaving a guard that no longer describes the system.
     */
    const sql = readFileSync(
      join(ROOT, 'supabase', 'migrations', '0082_reporting_aggregates.sql'),
      'utf8',
    )
    expect(sql).toContain('sum(o.value_amount)')
    expect(sql, 'the rollup now groups by currency — revisit this guard').not.toMatch(
      /group by[^\n]*currency/i,
    )
  })
})

describe('§5.6 either holds or is honestly absent', () => {
  it('the fx snapshot is absent exactly while the product is single-currency', () => {
    /*
     * ⚠️ ASSERTED IN BOTH DIRECTIONS, which is what makes this a guard rather
     * than a comment. Multi-currency without a snapshot is the silent money
     * bug. A snapshot while still single-currency is machinery for a population
     * of zero — and would mean this file is stale and should be deleted.
     */
    const multiCurrency = currencyCallers.length > 0
    expect(
      hasFxSnapshot,
      multiCurrency
        ? 'Multi-currency is now reachable and §5.6 is not implemented.'
        : 'An fx snapshot exists while every deal is still the default currency — ' +
          'either multi-currency shipped without updating this guard, or the ' +
          'snapshot is unused. Delete this file if §5.6 is genuinely implemented.',
    ).toBe(multiCurrency)
  })

  it('records the storage deviation rather than silently differing', () => {
    /*
     * §5.6 asks for `amount_minor BIGINT`. The column is `numeric(14, 2)`.
     * Both avoid binary floating point, which is what the spec is protecting
     * against, and §2's authority order puts running code above the contract —
     * so this is a deviation to record, not a migration to run on a money
     * column. Pinned so it cannot drift to a float.
     */
    const schema = readFileSync(
      join(ROOT, 'supabase', 'migrations', '0076_crm_opportunities.sql'),
      'utf8',
    )
    expect(schema).toMatch(/value_amount\s+numeric\(14,\s*2\)/)
    expect(schema, 'money must never be a binary float').not.toMatch(
      /value_amount\s+(real|double|float)/i,
    )
  })
})
