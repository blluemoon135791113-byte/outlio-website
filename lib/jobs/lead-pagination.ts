/**
 * Paging and search for the extracted-leads table.
 *
 * PURE — no I/O, no React. The dashboard reads thousands of rows, so paging is
 * done in Postgres with `.range()` rather than by slicing an array the browser
 * already downloaded.
 *
 * That choice makes SEARCH a server concern too: filtering one page in the
 * browser would search 25 rows and call it "no matches", which is a wrong
 * answer rather than an empty one.
 */

/** The page sizes offered in the UI. */
export const LEAD_PAGE_SIZES = [25, 50, 100] as const

export type LeadPageSize = (typeof LEAD_PAGE_SIZES)[number]

export const DEFAULT_LEAD_PAGE_SIZE: LeadPageSize = 25

/** Narrows an arbitrary number to an offered page size. */
export function toPageSize(value: unknown): LeadPageSize {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return (LEAD_PAGE_SIZES as readonly number[]).includes(parsed)
    ? (parsed as LeadPageSize)
    : DEFAULT_LEAD_PAGE_SIZE
}

export type PageState = {
  /** 0-based. */
  page: number
  pageSize: LeadPageSize
  total: number
}

export type PageView = {
  /** Total matching rows, echoed back so the caller renders one object. */
  total: number
  pageCount: number
  /** Clamped page, 0-based. */
  page: number
  /** Inclusive PostgREST range start. */
  from: number
  /** Inclusive PostgREST range end. */
  to: number
  /** 1-based index of the first row shown, or 0 when there are none. */
  firstRow: number
  /** 1-based index of the last row shown, or 0 when there are none. */
  lastRow: number
  hasPrevious: boolean
  hasNext: boolean
}

/**
 * Everything the table needs to render its pager.
 *
 * ⚠️ CLAMPS THE PAGE. Deleting rows, or narrowing a search, can leave the user
 * on a page that no longer exists. Requesting it from PostgREST returns an
 * empty range — an empty table that looks like "no leads" while the account has
 * thousands. The page is clamped into existence instead.
 */
export function pageView({ page, pageSize, total }: PageState): PageView {
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0
  const pageCount = Math.max(1, Math.ceil(safeTotal / pageSize))
  const safePage = Math.min(Math.max(0, Math.floor(page)), pageCount - 1)

  const from = safePage * pageSize
  const to = from + pageSize - 1

  return {
    total: safeTotal,
    pageCount,
    page: safePage,
    from,
    to,
    firstRow: safeTotal === 0 ? 0 : from + 1,
    lastRow: safeTotal === 0 ? 0 : Math.min(to + 1, safeTotal),
    hasPrevious: safePage > 0,
    hasNext: safePage < pageCount - 1,
  }
}

/**
 * The page numbers to render, with `null` standing for an elision.
 *
 * Always shows the first and last page, and a window around the current one, so
 * the control stays a fixed width whether the account has 3 pages or 300.
 */
export function pageNumbers(page: number, pageCount: number, window = 1): Array<number | null> {
  if (pageCount <= 1) return [0]

  const wanted = new Set<number>([0, pageCount - 1])
  for (let i = page - window; i <= page + window; i += 1) {
    if (i >= 0 && i < pageCount) wanted.add(i)
  }

  const sorted = [...wanted].sort((a, b) => a - b)
  const out: Array<number | null> = []

  for (const [index, value] of sorted.entries()) {
    const previous = sorted[index - 1]

    if (previous !== undefined) {
      const gap = value - previous
      // A "…" standing in for a SINGLE page is wider than the page number it
      // hides, and costs the user a click. Fill the gap instead.
      if (gap === 2) out.push(previous + 1)
      else if (gap > 2) out.push(null)
    }

    out.push(value)
  }

  return out
}

/**
 * Escapes a search term for a PostgREST `or=(...)` filter.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THIS IS A FILTER-INJECTION DEFENCE, NOT COSMETICS.                    ║
 * ║                                                                          ║
 * ║  PostgREST parses `or=(col.ilike.value,col2.ilike.value)` as a grammar.  ║
 * ║  A comma in the user's term ends the condition; a parenthesis ends the   ║
 * ║  group; a dot after a column name changes the operator. A term like      ║
 * ║  `a,id.gt.0` would otherwise append a condition nobody asked for.        ║
 * ║                                                                          ║
 * ║  RLS still scopes every row to the signed-in user, so this cannot reach  ║
 * ║  another tenant's data — but it can corrupt the query, and a filter the  ║
 * ║  user did not write returning rows they did not ask for is its own bug.  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Returns `null` when nothing searchable remains, so the caller omits the
 * filter entirely rather than sending an empty pattern that matches nothing.
 */
export function escapeSearchTerm(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const cleaned = trimmed
    // Grammar characters. Removed rather than escaped: PostgREST's quoting
    // rules differ per position, and dropping them cannot change the meaning
    // of a search the way a mis-escape can.
    .replace(/[(),.:"'\\]/g, ' ')
    // `%` and `_` are ilike wildcards. A user typing "50%" means the digits.
    .replace(/[%_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return null

  // A term long enough to be pathological is not a term anyone typed.
  return cleaned.slice(0, 120)
}

/** Columns a lead search looks at. */
export const LEAD_SEARCH_COLUMNS = ['full_name', 'job_title', 'company_name'] as const

/** Builds the PostgREST `or` filter for a search term, or `null` for no filter. */
export function leadSearchFilter(raw: string): string | null {
  const term = escapeSearchTerm(raw)
  if (!term) return null
  return LEAD_SEARCH_COLUMNS.map((column) => `${column}.ilike.*${term}*`).join(',')
}
