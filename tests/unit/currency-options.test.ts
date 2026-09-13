/**
 * The currencies a deal may be priced in, and why the list is closed.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ AN UNQUOTABLE CURRENCY DOES NOT FAIL LOUDLY.                          ║
 * ║                                                                           ║
 * ║  The deal saves, its `fx_rate_to_workspace_currency` stays NULL,           ║
 * ║  `value_amount_base` is NULL, and `sum()` drops it. The money simply is    ║
 * ║  not in the total, and the only trace is a number in the "not included in  ║
 * ║  these values" line on Reports.                                           ║
 * ║                                                                           ║
 * ║  So offering a code the rate feed cannot quote MANUFACTURES the hole that  ║
 * ║  caveat exists to report. That is the whole reason the picker is a closed  ║
 * ║  list and the server re-checks membership rather than shape.              ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { CURRENCIES, isOfferedCurrency } from '@/lib/crm/currencies'

const ROOT = join(__dirname, '..', '..')

describe('the list is well formed', () => {
  it('is not empty and every code is ISO-shaped', () => {
    // Vacuity: an empty list would satisfy every "no bad code" assertion below.
    expect(CURRENCIES.length).toBeGreaterThanOrEqual(20)
    for (const { code, name } of CURRENCIES) {
      expect(code, `${code} is not three uppercase letters`).toMatch(/^[A-Z]{3}$/)
      expect(name.length, `${code} has no name`).toBeGreaterThan(2)
    }
  })

  it('has no duplicates', () => {
    // A duplicate renders twice in the picker and reads as a bug in the data.
    const codes = CURRENCIES.map((c) => c.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('carries the four the owner named, and the workspace default', () => {
    const codes = new Set(CURRENCIES.map((c) => c.code))
    for (const required of ['GBP', 'USD', 'PKR', 'INR']) {
      expect(codes.has(required), `${required} was named in DECISION-19`).toBe(true)
    }
  })

  it('names currencies rather than relying on symbols', () => {
    /*
     * ⚠️ `$` IS CLAIMED BY A DOZEN CURRENCIES AND `₨` BY SEVERAL. Somebody
     * choosing between the Pakistani and Sri Lankan rupee cannot do it from the
     * symbol, so the picker shows `CODE — Name`.
     */
    const rupees = CURRENCIES.filter((c) => /Rupee/i.test(c.name)).map((c) => c.code)
    expect(rupees.length, 'the ambiguous case is not even present').toBeGreaterThanOrEqual(2)
    expect(new Set(rupees).size).toBe(rupees.length)
  })
})

describe('membership is checked, not just shape', () => {
  it('accepts an offered code in any casing', () => {
    expect(isOfferedCurrency('gbp')).toBe(true)
    expect(isOfferedCurrency(' USD ')).toBe(true)
  })

  it('refuses a well-formed code that is not offered', () => {
    /*
     * ⚠️ `XYZ` PASSES THE DATABASE'S `^[A-Z]{3}$` CHECK. Shape validation alone
     * would store it, and the deal would silently become unconvertible. This is
     * the assertion that makes the closed list mean something.
     */
    expect(isOfferedCurrency('XYZ')).toBe(false)
    expect(isOfferedCurrency('ZZZ')).toBe(false)
  })

  it('refuses junk', () => {
    for (const bad of ['', 'DOLLARS', 'US', '123', '$']) {
      expect(isOfferedCurrency(bad), bad).toBe(false)
    }
  })
})

describe('the picker reaches a user, and the server does not trust it', () => {
  const FORM = readFileSync(join(ROOT, 'components/crm/NewOpportunity.tsx'), 'utf8')
  const ACTION = readFileSync(join(ROOT, 'app/(product)/crm/opportunities-actions.ts'), 'utf8')
  const OPPS = readFileSync(join(ROOT, 'lib/crm/opportunities.ts'), 'utf8')

  it('renders a select over the offered list', () => {
    /*
     * The server half of multi-currency has been correct since 0123 and could
     * not be reached by anybody — the defect this session kept finding. This is
     * the line that makes it reachable.
     */
    expect(FORM).toMatch(/name="currency"/)
    expect(FORM).toMatch(/CURRENCIES\.map\(/)
  })

  it('the action re-validates against the list, not the shape', () => {
    // A server action is a public HTTP endpoint; the select is a convenience.
    expect(ACTION).toMatch(/isOfferedCurrency\(rawCurrency\)/)
    expect(ACTION).toMatch(/currency,/)
  })

  it('nothing downstream hardcodes USD as the default', () => {
    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  ⚠️ THE DEFAULT FOLLOWS THE WORKSPACE.                                ║
     * ║                                                                       ║
     * ║  `input.currency ?? 'USD'` was harmless while every workspace reported ║
     * ║  in dollars. Once one reports in GBP, a deal created without an        ║
     * ║  explicit currency would be stored as USD, fetch a real GBP rate, and  ║
     * ║  convert — landing on a number right by arithmetic and wrong by        ║
     * ║  intent. Somebody typing "50000" in a GBP workspace means pounds.      ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     */
    expect(OPPS).toMatch(/input\.currency \?\? workspace\?\.default_currency \?\? 'USD'/)
    expect(OPPS, 'the workspace currency is no longer consulted').not.toMatch(
      /const currency = \(input\.currency \?\? 'USD'\)/,
    )
    // And the decision lives in ONE place — the action defers rather than
    // picking its own fallback.
    expect(ACTION, 'the action hardcodes a fallback of its own').not.toMatch(
      /rawCurrency \|\| 'USD'/,
    )
  })

  it('the form is given the workspace currency by every page that renders it', () => {
    /*
     * ⚠️ ASSERTED AT THE CALL SITES. The prop defaults to 'USD' when omitted,
     * so a page forgetting to pass it re-introduces the hardcoding one level up
     * — silently, and only for that screen.
     */
    for (const page of [
      'app/(product)/crm/pipeline/page.tsx',
      'app/(product)/email/inbox/[id]/page.tsx',
    ]) {
      const source = readFileSync(join(ROOT, page), 'utf8')
      expect(source, `${page} does not pass the workspace currency`).toMatch(
        /workspaceCurrency=\{ctx\.workspace\.defaultCurrency\}/,
      )
    }
  })
})
