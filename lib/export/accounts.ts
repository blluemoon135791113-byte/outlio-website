/**
 * CSV for a saved account list.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  A COMPANY EXPORT, NOT A LEAD EXPORT WITH BLANK PEOPLE COLUMNS.          ║
 * ║                                                                          ║
 * ║  The lead writer's headers — Full Name, Job Title, Email — have no value ║
 * ║  on any row of an account list, so reusing it would produce a file that  ║
 * ║  is mostly empty columns and reads as a failed extraction. `toCsv` drops ║
 * ║  all-empty columns, which would leave the header row differing between   ║
 * ║  runs of the same kind — unmappable by any importer.                     ║
 * ║                                                                          ║
 * ║  Sharing `toCsv` and therefore `sanitizeCell` is the part that matters:  ║
 * ║  a company named `=cmd|'/c calc'!A1` is as attacker-controlled as a      ║
 * ║  person's name, and formula-injection defence lives in exactly one file. ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import type { ParsedAccount } from '@/lib/companies/parse-account-list'
import { toCsv, type CsvColumn } from '@/lib/export/sanitize'

/**
 * Columns pinned regardless of emptiness.
 *
 * Without these an account list whose rows all lack an industry would ship a
 * two-column file, and a CRM mapping built against a fuller run would break on
 * the next upload. The company's name and its Sales Navigator URL are the two
 * facts every row of every account list carries.
 */
export const ALWAYS_EXPORTED_ACCOUNT_COLUMNS = ['Company Name', 'LinkedIn URL'] as const

/**
 * ⚠️ PLAIN-TEXT HEADERS. No arrows, bullets, or symbols — a CSV is read by
 * spreadsheets and importers that treat punctuation as structure, and by users
 * who should not have to decode a glyph to know what a column holds.
 */
export const ACCOUNT_CSV_COLUMNS: readonly CsvColumn<ParsedAccount>[] = [
  { header: 'Company Name', value: (a) => a.companyName },
  { header: 'LinkedIn URL', value: (a) => a.salesNavUrl },
  { header: 'Industry', value: (a) => a.industry },
  { header: 'Connection Paths', value: (a) => a.connectionPaths },
  { header: 'Alert', value: (a) => a.alert },
  /*
   * The recommended person is flattened into columns rather than dropped: it
   * is on the captured page, and rule 4 forbids inventing data but nothing
   * requires discarding it. It is NOT a lead — no extraction ran on a profile
   * — so the headers say "Recommended" to keep that distinction on the page.
   */
  { header: 'Recommended Contact', value: (a) => a.recommendation?.fullName ?? null },
  { header: 'Recommended Contact Title', value: (a) => a.recommendation?.jobTitle ?? null },
  { header: 'Recommended Contact URL', value: (a) => a.recommendation?.salesNavUrl ?? null },
]

/** Serialises parsed accounts to the account-list CSV. */
export function buildAccountCsv(accounts: readonly ParsedAccount[]): string {
  return toCsv(accounts, ACCOUNT_CSV_COLUMNS, {
    alwaysKeep: ALWAYS_EXPORTED_ACCOUNT_COLUMNS,
  })
}
