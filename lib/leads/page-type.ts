/**
 * Which kind of saved page is this?
 *
 * PURE. No I/O, no network. Substring matching only — deliberately cheaper
 * than loading the document into cheerio, because this runs before the real
 * parser and its only job is to choose one.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  WHY THIS EXISTS.                                                        ║
 * ║                                                                          ║
 * ║  The worker had exactly one parser, so every upload was assumed to be a  ║
 * ║  LEAD search-results page. Now that Account Hub pages can be parsed too, ║
 * ║  something has to decide which one arrived — and an Account Hub page fed ║
 * ║  to the lead parser produces zero leads, which is correctly reported as  ║
 * ║  ERR_FILE_FORMAT and is nonetheless the wrong answer: the file was       ║
 * ║  perfectly valid, we simply pointed the wrong reader at it.              ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ `unknown` IS A REAL ANSWER AND MUST STAY ONE. It is tempting to default
 * to the lead parser so something always runs. That converts "we could not
 * tell what this is" into "this is a broken lead page", which is the
 * failure-looks-like-empty trap this codebase keeps re-learning. The caller
 * decides what to do with `unknown`; this module refuses to guess.
 */

export type SavedPageType = 'lead_search' | 'account_list' | 'unknown'

/**
 * Anchors, in the order they are tested.
 *
 * Every one is a `data-*` hook rather than a class or an ember id, for the
 * same reason `docs/SELECTOR_MAP.md` insists on it: CSS-module hashes and
 * `id="ember####"` change on every LinkedIn deploy, and a detector that drifts
 * is worse than no detector — it would route a good file to the wrong parser
 * and report a format error for a page we can read.
 */
const ACCOUNT_LIST_ANCHORS = [
  'data-x--account-hub--table-data-row',
  'data-x--account-hub--table',
  'data-x-accounts-dashboard-table-column-header',
] as const

const LEAD_SEARCH_ANCHORS = [
  'data-anonymize="person-name"',
  "data-anonymize='person-name'",
] as const

/**
 * Classifies a saved page.
 *
 * ⚠️ ACCOUNT LIST IS TESTED FIRST, AND THE ORDER MATTERS. An Account Hub page
 * can carry a recommended *person* per row, so it may contain a person-name
 * anchor too. A lead search-results page never carries the account-hub table
 * hooks, so the account test is the specific one and has to run before the
 * general one. Reversing these silently routes account pages to the lead
 * parser — the exact bug this module was added to prevent.
 */
export function detectSavedPageType(html: string): SavedPageType {
  if (!html) return 'unknown'

  if (ACCOUNT_LIST_ANCHORS.some((anchor) => html.includes(anchor))) return 'account_list'
  if (LEAD_SEARCH_ANCHORS.some((anchor) => html.includes(anchor))) return 'lead_search'

  return 'unknown'
}

/** Human-facing name, for an error a user has to act on. */
export function savedPageTypeLabel(type: SavedPageType): string {
  switch (type) {
    case 'lead_search':
      return 'Sales Navigator lead search results'
    case 'account_list':
      return 'Sales Navigator account list'
    default:
      return 'an unrecognised page'
  }
}
