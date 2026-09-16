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

describe('a currency may now be supplied, because the snapshot is written', () => {
  it('⚠️ THIS GATE IS OPEN NOW, AND THAT IS THE CHANGE', () => {
    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  THIS USED TO FORBID ANY CALLER PASSING A CURRENCY.                   ║
     * ║                                                                       ║
     * ║  The reason was real: 0082 summed `value_amount` with no conversion,   ║
     * ║  so a €10,000 and a $10,000 deal added to 20,000 with nothing          ║
     * ║  erroring. That reason is gone — 0130 snapshots a rate, 0131 converts  ║
     * ║  in all eight sum sites, and an unrated deal is excluded and counted.  ║
     * ║                                                                       ║
     * ║  So the assertion is no longer "nobody may" but "if anybody does, the  ║
     * ║  snapshot is written at create". A guard kept shut after its reason    ║
     * ║  expired is a guard people learn to delete.                           ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     */
    const opportunities = readFileSync(join(ROOT, 'lib/crm/opportunities.ts'), 'utf8')

    // The rate is resolved and BOTH halves of the pair are written.
    expect(opportunities).toMatch(/resolveFxRate\(\{ from: currency, to: workspace\.default_currency \}\)/)
    expect(opportunities).toMatch(/fx_rate_to_workspace_currency: fx\?\.rate \?\? null/)
    expect(opportunities).toMatch(/fx_rate_date: fx\?\.date \?\? null/)

    /*
     * ⚠️ NEVER WRITTEN BY A CALLER. `value_amount_base` is a GENERATED column;
     * inserting it errors at runtime, and a money insert that throws after the
     * rate lookup is the worst place to find out.
     */
    expect(opportunities, 'a caller writes the generated column').not.toMatch(
      /value_amount_base:/,
    )
  })

  it('a missing rate is stored as NULL rather than defaulted to 1', () => {
    /*
     * ⚠️ THE ONE LINE THAT KEEPS THE WHOLE THING HONEST. `?? 1` here would make
     * every unconvertible deal silently worth its face value in the wrong
     * currency — the exact bug this file has guarded against since it was
     * written, just relocated into TypeScript.
     */
    const opportunities = readFileSync(join(ROOT, 'lib/crm/opportunities.ts'), 'utf8')
    expect(opportunities, 'an absent rate is being defaulted').not.toMatch(
      /fx_rate_to_workspace_currency: fx\?\.rate \?\? 1/,
    )
  })
})

describe('§5.6 is half built, and the half that is missing is named', () => {
  const FX = readFileSync(
    join(ROOT, 'supabase', 'migrations', '0130_deal_fx_snapshot.sql'),
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
     * Built (0130): the columns, the both-or-neither constraint, the identity
     * rule, the converted column, the unconvertible count.
     * Not built: a rate vendor, and therefore the close-time re-snapshot.
     */
    expect(hasFxSnapshot, '0130 is gone — the snapshot columns were dropped').toBe(true)
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

  it('the rollups convert, and every sum site moved together', () => {
    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  0131 SWITCHED ALL EIGHT SUM SITES TO `value_amount_base`.            ║
     * ║                                                                       ║
     * ║  Proven against a throwaway Postgres with mixed currencies: a $5,000   ║
     * ║  won deal plus a £10,000 won deal at 1.35 reported 15,000 before and   ║
     * ║  18,500 after. The old number was not merely adding wrong units — it   ║
     * ║  was materially wrong, in whichever direction the rate happened to go. ║
     * ║                                                                       ║
     * ║  ⚠️ ALL EIGHT OR NONE. One site left on the raw column would make two  ║
     * ║  screens disagree about the same pipeline, which is this project's     ║
     * ║  most common defect wearing a currency symbol.                        ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     */
    const converted = readFileSync(
      join(ROOT, 'supabase', 'migrations', '0131_rollups_convert_currency.sql'),
      'utf8',
    )
    /*
     * ⚠️ COUNTED ON THE COMMENT-STRIPPED BODY. The header of 0131 documents the
     * substitution by quoting both spellings, so counting the raw file finds
     * nine and the guard fails for the most annoying possible reason. This is
     * the trap `outlio-verification-habits` records — files here quote the
     * rules they obey — and it has now caught five separate guards.
     */
    const body = converted.replace(/^--.*$/gm, '')
    const sites = body.match(/sum\(o\.value_amount_base\b/g) ?? []
    expect(sites.length, 'a sum site was left on the raw amount').toBe(8)
    expect(body, 'an unconverted sum survives in 0131').not.toMatch(/sum\(o\.value_amount\)/)
  })

  it('0131 replaces every function that had a sum, and nothing else', () => {
    /*
     * ⚠️ THE BODIES ARE COPIED VERBATIM FROM 0082/0083/0084 with one
     * mechanical substitution. Retyping a reporting function from memory is how
     * a rollup quietly starts measuring something else — the same mistake that
     * produced a wrong `claim_email_messages` signature earlier in this build.
     */
    const converted = readFileSync(
      join(ROOT, 'supabase', 'migrations', '0131_rollups_convert_currency.sql'),
      'utf8',
    )
    const replaced = (converted.match(/create or replace function public\.(\w+)/g) ?? []).map(
      (m) => m.replace('create or replace function public.', ''),
    )
    expect(replaced.sort()).toEqual([
      'crm_batch_funnel',
      'crm_forecast_by_period',
      'crm_pipeline_totals',
      'crm_rollup_activity_metrics',
      'crm_win_rates',
    ])
  })

  it('the unconvertible count reaches a screen, not just the database', () => {
    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  ⚠️ `crm_unconvertible_deals()` SHIPPED WITH ZERO CALLERS.            ║
     * ║                                                                       ║
     * ║  Written in 0130, referenced only from comments — the same shape as    ║
     * ║  `suppressContact`, in code written the same day by someone who had    ║
     * ║  spent the session fixing exactly that defect.                         ║
     * ║                                                                       ║
     * ║  It matters because the count and the money deliberately disagree:     ║
     * ║  `openDeals` counts every deal, `openValue` sums only the convertible  ║
     * ║  ones. Without this on screen, that gap is invisible and an average    ║
     * ║  deal size computed from the two is simply wrong.                     ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     */
    const reports = readFileSync(join(ROOT, 'lib/crm/reports.ts'), 'utf8')
    expect(reports).toMatch(/rpc\(\s*'crm_unconvertible_deals'/)
    expect(reports).toMatch(/unconvertible:/)

    const page = readFileSync(join(ROOT, 'app/(product)/crm/reports/page.tsx'), 'utf8')
    // Rendered for BOTH the personal and the workspace money blocks — one of
    // them silently omitting the caveat is the same bug at half scale.
    const rendered = page.match(/<ExcludedDeals count=\{/g) ?? []
    expect(rendered.length, 'the caveat is missing from a money block').toBe(2)
  })

  it('a failed count adds no caveat rather than taking out the page', () => {
    /*
     * ⚠️ FAIL-OPEN HERE, AND IT IS THE OPPOSITE OF `contactIsStopped` ON
     * PURPOSE. This number only ever ADDS a footnote to a total; it never
     * changes the total. Throwing would lose the whole reports page in order to
     * explain a footnote.
     */
    const reports = readFileSync(join(ROOT, 'lib/crm/reports.ts'), 'utf8')
    expect(reports).toMatch(/unconvertibleError \? 0 :/)
  })

  it('an unconvertible deal is counted, because a total that is short must say so', () => {
    /*
     * ⚠️ THE COUNT AND THE VALUE NOW DISAGREE ON PURPOSE, and that is the part
     * a screen has to explain. With one USD and one EUR open deal,
     * `crm_pipeline_totals` returns `open_deals = 2` and `open_value = 10000` —
     * the EUR deal is real pipeline but has no rate, so it is in the count and
     * not in the money. A reader dividing one by the other gets an average
     * deal size that is wrong by half.
     *
     * `crm_unconvertible_deals()` is what makes that legible, so it must exist.
     */
    const fx = readFileSync(
      join(ROOT, 'supabase', 'migrations', '0130_deal_fx_snapshot.sql'),
      'utf8',
    )
    expect(fx).toMatch(/create or replace function public\.crm_unconvertible_deals/)
    expect(fx).toMatch(/fx_rate_to_workspace_currency is null/)
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
