/**
 * Formula-injection defence (spec §12.6).
 *
 * ⚠️ IMPLEMENTED ONCE, HERE. Both the CSV and XLSX writers MUST call this.
 * Do not reimplement, inline, or "optimise" it elsewhere.
 *
 * The threat: a lead whose name is `=cmd|'/c calc'!A1` becomes an executable
 * formula when the export is opened in Excel or LibreOffice. The lead data is
 * attacker-controlled — anyone can set their own LinkedIn headline.
 *
 * Note this is the exact opposite of what the original scraper did: it
 * deliberately WROTE `=HYPERLINK(...)` formulas into cells
 * (docs/SCRAPER_AUDIT.md §H2). Links are re-created at export time using the
 * writer's own link API instead, so cells never contain formula text.
 */

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

/**
 * Characters that make a spreadsheet treat a cell as a formula.
 *
 * Tab and carriage return are included because Excel strips leading whitespace
 * before evaluating, so `\t=1+1` is still a formula.
 */
const RISKY_PREFIX = /^[=+\-@\t\r]/

/**
 * Makes a value inert for spreadsheet export.
 *
 * Prefixes a risky value with an apostrophe, which forces text interpretation
 * while PRESERVING the original characters. Stripping them would silently
 * corrupt legitimate data — plenty of real company names begin with `+` or `-`.
 * The cost is a visible apostrophe in the rare affected cell; note this in the
 * export help text.
 */
export function sanitizeCell(value: unknown): string | number | null {
  if (value === null || value === undefined) return null

  // Numbers cannot carry a formula and must stay numeric for sorting.
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'

  let v = String(value).replace(CONTROL_CHARS, '')

  if (RISKY_PREFIX.test(v)) v = `'${v}`

  return v
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * RFC 4180 quoting. Never build CSV by string concatenation without this.
 *
 * A field is quoted when it contains a quote, comma, CR or LF; embedded quotes
 * are doubled.
 */
function csvField(value: string | number | null): string {
  if (value === null) return ''
  const s = String(value)
  if (/["\r\n,]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export type CsvColumn<T> = {
  header: string
  value: (row: T) => unknown
}

/**
 * Serialises rows to RFC 4180 CSV.
 *
 * - `\r\n` line endings, per the RFC and for Excel compatibility
 * - UTF-8 BOM by default, so Excel on Windows renders non-ASCII names correctly
 *   instead of mojibake
 * - every cell passes through `sanitizeCell`
 */
export function toCsv<T>(
  rows: readonly T[],
  columns: readonly CsvColumn<T>[],
  options: { bom?: boolean; emptyValue?: string } = {},
): string {
  /*
   * ⚠️ AN EMPTY CELL IS AMBIGUOUS. It reads as "this person has no job title"
   * as easily as "we could not find one", and a spreadsheet gives the reader no
   * way to tell. `N/A` states that a value was looked for and is not available.
   *
   * Applied here rather than per column so no export path can forget it, and
   * overridable because a machine-read file may want a true empty.
   */
  const { bom = true, emptyValue = 'N/A' } = options

  const lines: string[] = []
  lines.push(columns.map((c) => csvField(sanitizeCell(c.header))).join(','))

  for (const row of rows) {
    lines.push(
      columns
        .map((column) => {
          const cell = sanitizeCell(column.value(row))
          // `0` and `false` are values, not absences.
          return csvField(cell === null || cell === '' ? emptyValue : cell)
        })
        .join(','),
    )
  }

  const body = lines.join('\r\n') + '\r\n'
  return bom ? `\uFEFF${body}` : body
}
