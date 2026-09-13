/**
 * One question — "how do we render an amount" — and it had four answers.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE LOCALE WAS `undefined` IN FOUR PLACES AND PINNED IN TWO.             ║
 * ║                                                                           ║
 * ║  `new Intl.NumberFormat(undefined, …)` follows the HOST. In a Server       ║
 * ║  Component that is the server, so the reader's own locale never enters     ║
 * ║  into it. In `components/crm/PipelineBoard.tsx` — `'use client'`, and so   ║
 * ║  server-rendered before it hydrates — the HTML carried the server's        ║
 * ║  formatting and the hydration pass carried the browser's. For a de-DE      ║
 * ║  reader those are `$1,200` and `1.200 $`: a hydration mismatch on a money  ║
 * ║  value.                                                                   ║
 * ║                                                                           ║
 * ║  Dates had already learned this and pinned `en-GB`. Money could not reuse  ║
 * ║  that answer — `en-GB` renders USD as `US$1,200` — so it pins `en-US`.     ║
 * ║  The two locales differ deliberately, which is why that fact is asserted   ║
 * ║  here rather than left to look like drift.                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { formatMoney } from '@/lib/format/money'

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
].map((f) => ({
  file: relative(ROOT, f).split('\\').join('/'),
  code: strip(readFileSync(f, 'utf8')),
}))

/** The module that is allowed to build a currency formatter. */
const OWNER = 'lib/format/money.ts'

describe('the scanner can see what it polices', () => {
  it('reads the product source', () => {
    // Vacuity: a broken walk would make every ratchet below pass over nothing.
    expect(PRODUCT.length).toBeGreaterThan(300)
    expect(PRODUCT.some((f) => f.file === OWNER)).toBe(true)
  })
})

describe('the locale is pinned, not inherited from the host', () => {
  const original = Intl.NumberFormat

  afterEach(() => {
    Intl.NumberFormat = original
  })

  /** Records the locale argument of every formatter built during `run`. */
  function localesUsedBy(run: () => void): unknown[] {
    const seen: unknown[] = []
    const patched = function (this: unknown, ...args: unknown[]) {
      seen.push(args[0])
      return new (original as unknown as new (...a: unknown[]) => Intl.NumberFormat)(...args)
    }
    Intl.NumberFormat = patched as unknown as typeof Intl.NumberFormat
    try {
      run()
    } finally {
      Intl.NumberFormat = original
    }
    return seen
  }

  it('never constructs a formatter with an undefined locale', () => {
    /*
     * ⚠️ THE WHOLE BUG, ASSERTED DIRECTLY. Comparing output strings would not
     * catch it — this test host resolves to en-US, so an unpinned formatter
     * produces the identical string here and diverges only on the reader's
     * machine. The locale ARGUMENT is the thing that has to be checked.
     */
    const seen = localesUsedBy(() => {
      formatMoney(1200, 'USD')
      formatMoney(1200, null)
      formatMoney(1200, 'money')
    })

    expect(seen.length).toBeGreaterThanOrEqual(3)
    for (const locale of seen) {
      expect(locale, 'a formatter was built with an inherited locale').toBeTypeOf('string')
    }
  })

  it('the spy would notice an unpinned formatter', () => {
    // Proves the check above can fail, rather than passing because nothing ran.
    const seen = localesUsedBy(() => {
      new Intl.NumberFormat(undefined, { style: 'decimal' }).format(1)
    })
    expect(seen).toEqual([undefined])
  })
})

describe('money pins en-US while dates pin en-GB', () => {
  it('renders USD with a bare dollar sign', () => {
    /*
     * ⚠️ en-GB WOULD RENDER THIS `US$1,200`. That is the reason money does not
     * share the date locale, and the reason this assertion is worth its line.
     */
    expect(formatMoney(1200, 'USD')).toBe('$1,200')
    expect(new Intl.NumberFormat('en-GB', {
      style: 'currency', currency: 'USD', maximumFractionDigits: 0,
    }).format(1200)).toBe('US$1,200')
  })

  it('dates still pin en-GB, so this stays a deliberate difference', () => {
    const dateModule = PRODUCT.find((f) => f.file === 'lib/intelligence/date-range.ts')
    expect(dateModule?.code).toMatch(/'en-GB'/)
  })
})

describe('a currency nobody recorded is not invented', () => {
  it('returns the bare number rather than guessing USD', () => {
    // CLAUDE.md rule 4: `$500,000` from an amount with no currency is a value
    // that reads as a fact and is not one.
    expect(formatMoney(500000, null)).toBe('500,000')
    expect(formatMoney(500000, undefined)).toBe('500,000')
    expect(formatMoney(500000, '')).toBe('500,000')
    expect(formatMoney(500000, null)).not.toContain('$')
  })
})

describe('an unusable currency code does not take the page with it', () => {
  it('does not throw on a malformed code', () => {
    /*
     * A RangeError inside a render is an error boundary — a whole page lost to
     * one bad row. Two of the four call sites this replaced defended against
     * that and two did not.
     */
    expect(() => formatMoney(1200, 'money')).not.toThrow()
    expect(formatMoney(1200, 'money')).toBe('1,200 money')
  })

  it('formats a well-formed code the database can actually hold', () => {
    /*
     * ⚠️ `XYZ` DOES NOT THROW. Intl checks that a code is three letters, not
     * that it is real ISO 4217 — and `crm_opportunities.currency` is
     * `char(3) check (currency ~ '^[A-Z]{3}$')`, which is exactly that shape.
     * So the fallback above is defence, not a live path, and saying otherwise
     * would overstate what was fixed.
     */
    // ⚠️ U+00A0, not a space. Intl separates a currency CODE from the number
    // with a non-breaking space; a plain-space literal here fails with two
    // identical-looking strings, which is a confusing hour for whoever is next.
    expect(formatMoney(1200, 'XYZ')).toBe('XYZ 1,200')
    expect(formatMoney(1200, 'GBP')).toBe('£1,200')
  })
})

describe('precision is chosen, never defaulted into being wrong', () => {
  it('rounds dashboard figures and keeps cents on a single deal', () => {
    expect(formatMoney(1200.49, 'USD')).toBe('$1,200')
    expect(formatMoney(1200.5, 'USD', 'cents')).toBe('$1,200.50')
  })

  it('keeps four places for per-call costs', () => {
    /*
     * ⚠️ `whole` WOULD RENDER MOST OF THE COST LEDGER AS `$0.00`. Provider
     * prices are genuinely fractions of a cent, which is why `costs.ts` counts
     * in micros in the first place.
     */
    expect(formatMoney(0.0023, 'USD', 'micro')).toBe('$0.0023')
    expect(formatMoney(0.0023, 'USD')).not.toBe('$0.0023')
  })
})

describe('the ratchet: nobody builds their own money formatter', () => {
  it('no source passes an undefined locale to Intl', () => {
    const offenders = PRODUCT.filter((f) =>
      /Intl\.(NumberFormat|DateTimeFormat)\(\s*undefined/.test(f.code),
    ).map((f) => f.file)
    expect(
      offenders,
      'An unpinned formatter is back. In a Server Component it renders the ' +
        "server's locale; in a client component it is a hydration mismatch. " +
        'Use lib/format/money.ts, or pin the locale explicitly.',
    ).toEqual([])
  })

  it('only the money module constructs a currency formatter', () => {
    const offenders = PRODUCT.filter(
      (f) => f.file !== OWNER && /style:\s*'currency'/.test(f.code),
    ).map((f) => f.file)
    expect(
      offenders,
      'A fifth money formatter. Four already disagreed about the locale; ' +
        'route it through formatMoney instead.',
    ).toEqual([])
  })

  it('the six call sites really do delegate', () => {
    /*
     * ⚠️ ASSERTED IN BOTH DIRECTIONS. The ratchet above passes trivially if
     * every call site were deleted; this is what says they still exist and
     * still go through the one door.
     */
    const importers = PRODUCT.filter(
      (f) => f.file !== OWNER && /from '@\/lib\/format\/money'/.test(f.code),
    ).map((f) => f.file)
    expect(importers.sort()).toEqual([
      'app/(product)/crm/companies/[id]/page.tsx',
      'app/(product)/crm/reports/page.tsx',
      'components/crm/PipelineBoard.tsx',
      'components/reports/Widget.tsx',
      'lib/crm/company-details.ts',
      'lib/intelligence/costs.ts',
    ])
  })
})

describe('a server-only date is formatted in UTC, not the server’s timezone', () => {
  it('funding dates pin a zone', () => {
    /*
     * A round closed at `2026-01-01T00:00:00Z` rendered as `31/12/2025`
     * anywhere west of Greenwich. `company-details.ts` is `server-only`, so
     * bare `toLocaleDateString()` there is always the server's idea of the day.
     */
    const details = PRODUCT.find((f) => f.file === 'lib/crm/company-details.ts')!
    expect(details.code).toMatch(/timeZone: 'UTC'/)
    expect(details.code, 'a bare toLocaleDateString is back').not.toMatch(
      /toLocaleDateString\(\)/,
    )
  })
})
