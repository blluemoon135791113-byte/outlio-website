/**
 * The one place an amount becomes a string.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE LOCALE IS PINNED, AND `undefined` IS THE BUG THIS FILE EXISTS FOR. ║
 * ║                                                                           ║
 * ║  `new Intl.NumberFormat(undefined, …)` resolves to whatever locale the    ║
 * ║  HOST is configured for. In a Server Component that is the server's — so   ║
 * ║  the same deal renders `$1,200` on Vercel and `1.200 $` on a de-DE        ║
 * ║  laptop, and neither has anything to do with the reader.                  ║
 * ║                                                                           ║
 * ║  In a client component it is worse, because a client component is still    ║
 * ║  server-rendered first: the HTML carries the SERVER's locale and the       ║
 * ║  hydration pass carries the BROWSER's. For a reader whose browser is not   ║
 * ║  en-US those two strings differ, which is a hydration mismatch on a money  ║
 * ║  value. `components/crm/PipelineBoard.tsx` was doing exactly this.        ║
 * ║                                                                           ║
 * ║  Dates already learned this — `lib/intelligence/date-range.ts` and the     ║
 * ║  rest pin `en-GB` explicitly. Money could not reuse that answer: `en-GB`   ║
 * ║  renders USD as `US$1,200`, so it pins `en-US` instead. The two locales    ║
 * ║  differ ON PURPOSE; this note is here so the difference is not read as     ║
 * ║  drift and "fixed".                                                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ FORMATS ONE ALREADY-TOTALLED VALUE. Nothing here adds two amounts. Money
 * is summed in Postgres, and the single-currency assumption that makes such a
 * sum meaningful is policed by `tests/unit/money-single-currency.test.ts` —
 * not here.
 */

/** Money is en-US; dates are en-GB. See the banner — this is deliberate. */
const LOCALE = 'en-US'

export type MoneyPrecision =
  /** Dashboard and table figures, where cents are noise. */
  | 'whole'
  /** A single deal's value, where `$1,200.00` is a price and `1,200` is a number. */
  | 'cents'
  /** Per-call API costs, which are genuinely fractions of a cent. */
  | 'micro'

const DIGITS: Record<MoneyPrecision, Intl.NumberFormatOptions> = {
  whole: { maximumFractionDigits: 0 },
  cents: { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  micro: { minimumFractionDigits: 2, maximumFractionDigits: 4 },
}

/**
 * An amount and its currency, rendered.
 *
 * ⚠️ A MISSING CURRENCY RETURNS THE BARE NUMBER RATHER THAN GUESSING. Stamping
 * a dollar sign on an amount whose currency nobody recorded is CLAUDE.md rule 4
 * — a value that looks like a fact and is not one. The number alone is still a
 * true observation.
 */
export function formatMoney(
  amount: number,
  currency: string | null | undefined,
  precision: MoneyPrecision = 'whole',
): string {
  const digits = DIGITS[precision]

  if (typeof currency !== 'string' || !currency) {
    return new Intl.NumberFormat(LOCALE, digits).format(amount)
  }

  try {
    return new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency,
      ...digits,
    }).format(amount)
  } catch {
    /*
     * ⚠️ REACHED ONLY BY A MALFORMED CODE, AND THAT IS NARROWER THAN IT LOOKS.
     * `Intl` rejects a code that is not three letters; it does NOT check the
     * code against ISO 4217, so `XYZ` formats as `XYZ 1,200` rather than
     * throwing. `crm_opportunities.currency` is `char(3) check (~ '^[A-Z]{3}$')`,
     * so the database cannot produce a throwing value at all.
     *
     * It stays because an unrecognised code is still an observation, and a
     * RangeError in a render is an error boundary rather than a blank cell —
     * a whole page lost to one bad row. Two of the four call sites this file
     * replaced already defended it; the other two did not.
     */
    return `${new Intl.NumberFormat(LOCALE, digits).format(amount)} ${currency}`
  }
}
