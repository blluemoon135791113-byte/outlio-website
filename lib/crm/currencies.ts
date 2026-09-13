/**
 * The currencies a deal may be priced in — DECISION-19.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ EVERY CODE HERE IS ONE FRANKFURTER CAN ACTUALLY QUOTE.                ║
 * ║                                                                           ║
 * ║  That is the whole reason this list is curated rather than free text. An   ║
 * ║  unquotable currency does not fail loudly: the deal saves, gets a NULL     ║
 * ║  rate, and quietly drops out of every total — visible only as a number in  ║
 * ║  the "not included in these values" caveat. Offering a code we cannot      ║
 * ║  convert would manufacture exactly the hole the caveat exists to report.   ║
 * ║                                                                           ║
 * ║  Checked against `https://api.frankfurter.dev/v2/currencies` on            ║
 * ║  2026-09-13: it carries 165 codes and all 37 below are present. To         ║
 * ║  re-check, fetch that endpoint and compare `iso_code` against `CURRENCIES` ║
 * ║  — `tests/unit/currency-options.test.ts` does the offline half.           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ 37 AND NOT 165. A picker listing every currency a rate feed happens to
 * carry is a worse control than one listing the ones a B2B seller actually
 * prices in — the long tail is scroll, not capability. The owner named GBP,
 * USD, PKR and INR specifically; the rest are the majors plus the markets
 * Outlio's own customers sell into. Adding one is a line here, once verified.
 *
 * ⚠️ NAMES, NOT SYMBOLS. `$` is claimed by a dozen currencies and `₨` by
 * several; a person choosing between "Pakistani Rupee" and "Sri Lankan Rupee"
 * cannot do it from the symbol. The code is shown alongside because that is
 * what appears on the deal afterwards.
 */

export type CurrencyOption = { code: string; name: string }

export const CURRENCIES: readonly CurrencyOption[] = [
  { code: 'USD', name: 'United States Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'PKR', name: 'Pakistani Rupee' },
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'AED', name: 'United Arab Emirates Dirham' },
  { code: 'SAR', name: 'Saudi Riyal' },
  { code: 'QAR', name: 'Qatari Riyal' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'NZD', name: 'New Zealand Dollar' },
  { code: 'SGD', name: 'Singapore Dollar' },
  { code: 'HKD', name: 'Hong Kong Dollar' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'CNY', name: 'Chinese Renminbi Yuan' },
  { code: 'CHF', name: 'Swiss Franc' },
  { code: 'SEK', name: 'Swedish Krona' },
  { code: 'NOK', name: 'Norwegian Krone' },
  { code: 'DKK', name: 'Danish Krone' },
  { code: 'PLN', name: 'Polish Złoty' },
  { code: 'CZK', name: 'Czech Koruna' },
  { code: 'TRY', name: 'Turkish Lira' },
  { code: 'ZAR', name: 'South African Rand' },
  { code: 'NGN', name: 'Nigerian Naira' },
  { code: 'KES', name: 'Kenyan Shilling' },
  { code: 'EGP', name: 'Egyptian Pound' },
  { code: 'BRL', name: 'Brazilian Real' },
  { code: 'MXN', name: 'Mexican Peso' },
  { code: 'MYR', name: 'Malaysian Ringgit' },
  { code: 'IDR', name: 'Indonesian Rupiah' },
  { code: 'PHP', name: 'Philippine Peso' },
  { code: 'THB', name: 'Thai Baht' },
  { code: 'VND', name: 'Vietnamese Đồng' },
  { code: 'KRW', name: 'South Korean Won' },
  { code: 'ILS', name: 'Israeli New Shekel' },
  { code: 'BDT', name: 'Bangladeshi Taka' },
  { code: 'LKR', name: 'Sri Lankan Rupee' },
] as const

const CODES = new Set(CURRENCIES.map((c) => c.code))

/**
 * Whether a code may be stored on a deal.
 *
 * ⚠️ THIS IS A SHAPE AND MEMBERSHIP CHECK, NOT A GUARANTEE OF CONVERTIBILITY.
 * A code can be offered here and still come back unquotable on a given day if
 * the feed is down — which is why an absent rate is a first-class state rather
 * than an error. `crm_opportunities.currency` enforces `^[A-Z]{3}$` separately;
 * this narrows that to the set a person was actually offered.
 */
export function isOfferedCurrency(value: string): boolean {
  return CODES.has(value.trim().toUpperCase())
}
