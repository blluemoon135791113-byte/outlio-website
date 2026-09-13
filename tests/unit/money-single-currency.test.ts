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

describe('§5.6 is half built, and the half that is missing is named', () => {
  const FX = readFileSync(
    join(ROOT, 'supabase', 'migrations', '0123_deal_fx_snapshot.sql'),
    'utf8',
  )

  it('the snapshot columns now exist', () => {
    /*
     * ⚠️ THIS ASSERTION IS INVERTED FROM WHAT IT USED TO BE, and the old
     * message is why: it said "a snapshot while still single-currency is
     * machinery for a population of zero — delete this file if §5.6 is
     * genuinely implemented". §5.6 is now genuinely HALF implemented, which is
     * neither case it anticipated, so the file stays and says which half.
     *
     * Built (0123): the columns, the both-or-neither constraint, the identity
     * rule, the converted column, the unconvertible count.
     * Not built: a rate vendor, and therefore the close-time re-snapshot.
     */
    expect(hasFxSnapshot, '0123 is gone — the snapshot columns were dropped').toBe(true)
    expect(FX).toMatch(/fx_rate_to_workspace_currency\s+numeric/)
    expect(FX).toMatch(/fx_rate_date\s+date/)
  })

  it('a rate of 1 is only ever written when the currencies are identical', () => {
    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  ⚠️ THE WHOLE SAFETY ARGUMENT FOR SHIPPING WITHOUT A VENDOR.          ║
     * ║                                                                       ║
     * ║  Writing 1 when the deal currency equals the workspace currency is an  ║
     * ║  IDENTITY — a restatement of a fact the row already carries. Writing 1 ║
     * ║  for any other pair is inventing an exchange rate, which is rule 4     ║
     * ║  with a decimal point in it, and it would make €10,000 worth $10,000.  ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     */
    // The trigger fills only a NULL rate, and only on a currency match.
    expect(FX).toMatch(/new\.currency = v_workspace_currency/)
    expect(FX).toMatch(/new\.fx_rate_to_workspace_currency is null/)
    // The backfill applies the same rule rather than a bulk guess.
    expect(FX).toMatch(/and o\.currency = w\.default_currency/)
    // And no unconditional default anywhere.
    expect(FX, 'a rate is being defaulted to 1 without a currency check').not.toMatch(
      /fx_rate_to_workspace_currency\s+numeric\([^)]*\)\s+not null\s+default/i,
    )
  })

  it('an unknown rate makes a deal unconvertible rather than free', () => {
    // NULL through the generated column, so `sum()` drops the row instead of
    // adding a foreign amount at face value.
    expect(FX).toMatch(/value_amount_base/)
    expect(FX).toMatch(/fx_rate_to_workspace_currency is null then null/)
    // And the shortfall is counted, because a total nobody knows is short is
    // worse than a total that is wrong.
    expect(FX).toMatch(/function public\.crm_unconvertible_deals/)
  })

  it('a rate cannot be stored without the date that audits it', () => {
    /*
     * ⚠️ ANCHORED ON THE DDL, NOT THE NAME. `toMatch(/crm_opportunities_fx_pair/)`
     * passed against a constraint renamed to `..._fx_pair_DISABLED` — the same
     * substring mistake that let `/suppressContact\(\{/` match inside
     * `unsuppressContact({`. Matching the `add constraint … check` keeps the
     * assertion tied to the constraint existing rather than to its name
     * appearing somewhere in the file.
     */
    expect(FX).toMatch(/add constraint crm_opportunities_fx_pair\s+check/)
    expect(FX).toMatch(/fx_rate_to_workspace_currency is null\) = \(fx_rate_date is null/)
    expect(FX).toMatch(/add constraint crm_opportunities_fx_rate_positive\s+check/)
  })

  it('⚠️ THE ROLLUPS STILL DO NOT CONVERT, which is why the gate above stands', () => {
    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  0123 GAVE EVERY DEAL A CONVERTED AMOUNT. NOTHING READS IT YET.       ║
     * ║                                                                       ║
     * ║  Eight `sum(value_amount)` sites across 0082, 0083 and 0084 still add  ║
     * ║  raw amounts across currencies. Today that is harmless — every deal is ║
     * ║  the workspace currency, so converted and raw are the same number —    ║
     * ║  and it is exactly why no caller may pass a currency until they are    ║
     * ║  switched to `value_amount_base`.                                     ║
     * ║                                                                       ║
     * ║  Asserted so the two facts stay tied: the day the rollups convert,     ║
     * ║  this fails and points at reopening the currency gate above.          ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     */
    const unconverted = ['0082_reporting_aggregates', '0083_crm_funnel', '0084_crm_forecast']
      .map((f) => readFileSync(join(ROOT, 'supabase', 'migrations', `${f}.sql`), 'utf8'))
      .join('\n')

    expect(unconverted).toMatch(/sum\(o\.value_amount\)/)
    expect(
      unconverted,
      'A rollup now sums the converted column. Multi-currency may be safe to ' +
        'open — revisit the caller gate in this file rather than leaving it shut.',
    ).not.toMatch(/sum\(o\.value_amount_base\)/)
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
