import 'server-only'

/**
 * Turns a batch run's rows into ONE written finding.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE ROSTER IS NOT AN ANSWER.                                         ║
 * ║                                                                          ║
 * ║  Asked "how much funding did these companies raise this year", the panel ║
 * ║  used to render twenty lead cards, most of them reading "Amount: Not     ║
 * ║  found / Currency: Not found". Every one of those lines is the product   ║
 * ║  telling the user something they did not ask and cannot use, and the     ║
 * ║  handful of companies that DID raise were buried among them.             ║
 * ║                                                                          ║
 * ║  A person asking about twenty companies wants to know what is true       ║
 * ║  ACROSS them. That is a sentence, not a table — and it is the one thing  ║
 * ║  they could not have read off the lead list themselves.                  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ ONLY ROWS WITH REAL VALUES ARE SENT TO THE MODEL. A row where every field
 * is unknown carries no information, and including it invites the model to
 * narrate absence — the exact padding this replaces. The count of what was
 * dropped is kept, so the panel can state coverage honestly in one line.
 */
import { resolveHubbleLlm } from '@/lib/hubble/reason'
import type { ResultRow } from '@/lib/intelligence/results'

export type RunSummary = {
  /** Plain prose. The finding, not the roster. */
  text: string
  /** How many rows carried at least one real value. */
  withData: number
  /** How many carried none. Stated as a number, never enumerated. */
  withoutData: number
}

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: { finding: { type: 'string' } },
  required: ['finding'],
} as const

const SUMMARY_SYSTEM = `You report what a set of research results shows, for a B2B salesperson.

You are given rows of researched companies. Report the PATTERN across them.

═══ WHAT TO WRITE ═══
Lead with the finding in the first sentence — the concentration, the shared
stage, the timing, the range, the outlier. Then give the evidence for it.

Name specific companies ONLY as evidence for the finding or as a genuine
outlier worth acting on. Two or three names is usually right. NEVER walk
through the rows one by one; the user can already see the list.

If the rows genuinely share nothing, say that in one line. Do not invent a
theme to have something to say.

═══ NO VAGUE QUANTIFIERS ═══
BANNED: significant, substantial, considerable, strong, robust, healthy,
notable, a number of, several, various, a range of, quite a few, relatively.

These words say nothing. Replace every one of them with the actual figure.
Not "raised a significant amount" but "raised $47.7m between them". Not
"several raised recently" but "three of the four closed in August 2026".

Where a COMPUTED FIGURES block is supplied, those totals, ranges and counts
are already calculated for you. Quote them exactly. DO NOT ADD UP THE ROWS
YOURSELF and do not recompute anything — arithmetic you perform is arithmetic
that can be wrong, and a wrong total here ends up in a customer email.

Those figures are the facts a reader cannot get by glancing at the list, and
they are the reason this paragraph exists.

═══ WHAT NOT TO WRITE ═══
You are shown only rows that HAVE data. Do not speculate about companies not
shown, do not mention missing data, do not caveat coverage, and do not
recommend further research. Someone else states the coverage.

Never state a number that is not in the rows or in the computed figures.

═══ FORMAT ═══
PLAIN TEXT. No markdown, no headers, no asterisks, no bullet characters, no
tables, no emoji. Two to four sentences. Stop when the finding is stated —
do not restate the question or summarise yourself.`

/**
 * Aggregates computed IN CODE, never by the model.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ A LANGUAGE MODEL ASKED TO ADD UP FOUR NUMBERS GOT IT WRONG.          ║
 * ║                                                                          ║
 * ║  Given $4.2m, $11m, $2.5m and $30m it reported a total of $46,000,000.   ║
 * ║  The answer is $47,700,000. That figure was about to be shown as a       ║
 * ║  finding, in a tool whose entire promise is that it does not state       ║
 * ║  things it cannot support.                                               ║
 * ║                                                                          ║
 * ║  Sums, ranges and counts are arithmetic. Arithmetic is code's job. The   ║
 * ║  model is told to quote these and forbidden from recomputing them —      ║
 * ║  which is CLAUDE.md's "deterministic before AI" applied to the one place ║
 * ║  where being confidently wrong costs the most.                           ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
function computeFigures(rows: readonly ResultRow[], columns: readonly string[]): string[] {
  const lines: string[] = []

  for (const field of columns) {
    const numbers: number[] = []
    const dates: string[] = []

    for (const row of rows) {
      const cell = row.fields[field]
      if (cell?.state !== 'known') continue

      const raw = cell.value
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        numbers.push(raw)
        continue
      }
      if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw)) dates.push(raw.slice(0, 10))
    }

    if (numbers.length > 1) {
      const total = numbers.reduce((sum, n) => sum + n, 0)
      const min = Math.min(...numbers)
      const max = Math.max(...numbers)
      lines.push(
        `${field}: ${numbers.length} values, total ${total.toLocaleString('en-US')}, ` +
          `smallest ${min.toLocaleString('en-US')}, largest ${max.toLocaleString('en-US')}`,
      )
    }

    if (dates.length > 1) {
      const sorted = [...dates].sort()
      lines.push(
        `${field}: ${dates.length} dates, earliest ${sorted[0]}, latest ${sorted[sorted.length - 1]}`,
      )
    }
  }

  return lines
}

/** A row is worth showing the model only if something was actually found. */
function hasAnyValue(row: ResultRow): boolean {
  return Object.values(row.fields).some((cell) => cell?.state === 'known')
}

/**
 * Renders a row as one compact line.
 *
 * Unknown fields are OMITTED rather than rendered as "not found": the model
 * should never see the vocabulary of absence, or it will reproduce it.
 */
function rowLine(row: ResultRow, columns: readonly string[]): string {
  const parts: string[] = []

  for (const field of columns) {
    const cell = row.fields[field]
    if (cell?.state !== 'known') continue

    const value =
      typeof cell.value === 'object' && cell.value !== null
        ? JSON.stringify(cell.value)
        : String(cell.value)

    parts.push(`${field}=${value.slice(0, 120)}`)
  }

  if (parts.length === 0) return ''
  return `${row.companyName ?? 'Unknown company'}: ${parts.join('; ')}`
}

export async function summarizeRun(
  question: string,
  rows: readonly ResultRow[],
  columns: readonly string[],
): Promise<RunSummary | null> {
  const withData = rows.filter(hasAnyValue)
  const withoutData = rows.length - withData.length

  // Nothing was found at all. The panel says that plainly; a model asked to
  // summarise nothing will produce an apology, which helps no one.
  if (withData.length === 0) return null

  const llm = resolveHubbleLlm()
  if (!llm.isConfigured()) return null

  /*
   * Capped. A 500-lead run would otherwise build a prompt larger than any
   * model's useful context, and the pattern is visible well before then.
   */
  const lines = withData
    .slice(0, 60)
    .map((row) => rowLine(row, columns))
    .filter(Boolean)

  if (lines.length === 0) return null

  const figures = computeFigures(withData, columns)

  const result = await llm.generateJson({
    system: SUMMARY_SYSTEM,
    user:
      `QUESTION: ${question}\n\nROWS (${lines.length} companies with data):\n${lines.join('\n')}` +
      (figures.length > 0
        ? `\n\nCOMPUTED FIGURES (already calculated — quote exactly, do not recompute):\n${figures.join('\n')}`
        : ''),
    schema: SUMMARY_SCHEMA as unknown as Record<string, unknown>,
    temperature: 0.2,
    maxOutputTokens: 500,
  })

  if (!result.ok) return null

  const parsed = result.json as { finding?: unknown }
  const text = typeof parsed.finding === 'string' ? parsed.finding.trim() : ''
  if (!text) return null

  return { text, withData: withData.length, withoutData }
}
