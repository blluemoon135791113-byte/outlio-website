/**
 * Why is this list empty? Four answers, and they are not interchangeable.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  EACH REASON NEEDS A DIFFERENT SENTENCE AND A DIFFERENT BUTTON.           ║
 * ║                                                                           ║
 * ║  Telling somebody to "try part of a name" when they filtered by tag sends  ║
 * ║  them to fix the wrong control. Telling a workspace with five thousand     ║
 * ║  contacts that it has none is false. And explaining page 99 with anything  ║
 * ║  about filters is wrong twice over — the rows exist and they are on page   ║
 * ║  one.                                                                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ THIS IS A FUNCTION RATHER THAN A CHAIN OF TERNARIES IN THE PAGE, AND THE
 * REASON IS A TEST THAT FAILED TO FAIL.
 *
 * The branch first lived inline in a Server Component, so the only thing a test
 * could do was read the source and look for the condition. That guard passed
 * against `if (false && total > 0 && page > 1)` — the string was still there.
 * A structural check on a private function is a check on spelling.
 *
 * Exported and pure, it can simply be called, and the test below it asserts an
 * answer rather than a substring.
 */

export type EmptyReason =
  /** Rows exist for this view; the reader has walked past them. */
  | 'past_end'
  /** A search term matched nothing. */
  | 'no_match_search'
  /** Filters other than the search box excluded everything. */
  | 'no_match_filters'
  /** There genuinely are none. */
  | 'none_yet'

export function emptyReason(input: {
  /** The search term, if any. */
  search: string
  /** Every active filter INCLUDING the search box. */
  filterCount: number
  page: number
  /**
   * The FILTERED total across all pages.
   *
   * ⚠️ FILTERED, NOT A WORKSPACE COUNT. That is what makes `past_end`
   * distinguishable: a positive total with no rows on this page means the rows
   * exist and the reader has gone too far, while a zero total means the
   * question really is about filters. A raw workspace count could not tell
   * those apart.
   *
   * `null` for lists that deliberately run no count query — the companies list
   * infers "probably another page" from a full page instead, which is cheaper.
   * Then `page > 1` is the only available signal, and it is sufficient: page 1
   * with nothing really is empty.
   */
  total: number | null
}): EmptyReason {
  /*
   * ⚠️ CHECKED FIRST, because if the reader is past the end then every other
   * explanation is wrong — including the filter ones, which would send them to
   * clear filters that are not the reason.
   */
  if (input.page > 1 && (input.total === null || input.total > 0)) return 'past_end'

  if (input.search) return 'no_match_search'

  // `search` is itself counted, so anything beyond it is a narrowing the search
  // box cannot explain.
  if (input.filterCount > 0) return 'no_match_filters'

  return 'none_yet'
}

/** Filters beyond the search box — what the copy needs to offer to clear. */
export function otherFilterCount(search: string, filterCount: number): number {
  return Math.max(filterCount - (search ? 1 : 0), 0)
}
