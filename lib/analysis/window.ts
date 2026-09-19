/**
 * "Which period, and whose work" — shared by both channels.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  EXTRACTED BECAUSE THERE ARE NOW TWO ANALYSES, NOT IN ANTICIPATION OF     ║
 * ║  ONE. `lib/linkedin/analysis.ts` and `lib/email/analysis.ts` ask the same  ║
 * ║  question and differ only in which rows they count. The parts worth        ║
 * ║  sharing are the two that are silently wrong when they disagree: where a   ║
 * ║  day BEGINS and ENDS, and what an empty selection means.                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

/**
 * ⚠️ AN EMPTY `userIds` MEANS EVERYONE, NOT NOBODY.
 *
 * The same three-state trap as `hasEmail` on the contacts list: a filter whose
 * "unset" value is an empty collection reads naturally as "match none", and
 * getting it backwards produces a report full of zeroes that looks exactly like
 * a team who did no work — while being the DEFAULT state of the form.
 */
export type AnalysisWindow = {
  /** Inclusive `YYYY-MM-DD`, or null for "since the beginning". */
  from: string | null
  /** Inclusive `YYYY-MM-DD`, or null for "up to now". */
  to: string | null
  /** Empty = the whole team. */
  userIds: string[]
}

export const WHOLE_HISTORY: AnalysisWindow = { from: null, to: null, userIds: [] }

/** True when any narrowing is in effect — used to word a "no data" refusal. */
export function isFiltered(window: AnalysisWindow): boolean {
  return Boolean(window.from || window.to || window.userIds.length > 0)
}

/**
 * Turns the two date inputs into timestamp bounds.
 *
 * ⚠️ UTC, AND INCLUSIVE AT BOTH ENDS. An `<input type="date">` yields a bare
 * calendar date with no zone, and the rows it is compared against are
 * `timestamptz`. Something has to choose a zone; the workspace does not store
 * one, so inventing "probably the reader's" would be a guess that silently
 * moves every boundary. UTC is stated on the form instead.
 *
 * ⚠️ `to` IS EXPANDED TO THE END OF ITS DAY. A person picking 31 March means
 * "including the 31st". A naive `<= '2026-03-31'` compares against midnight and
 * silently discards that whole day's work — a day of somebody's outreach
 * missing, with nothing to indicate it.
 */
export function bounds(window: AnalysisWindow): {
  fromIso: string | null
  toIso: string | null
} {
  return {
    fromIso: window.from ? `${window.from}T00:00:00.000Z` : null,
    toIso: window.to ? `${window.to}T23:59:59.999Z` : null,
  }
}

/** Whether a row's timestamp falls inside the window. */
export function within(
  iso: string | null,
  fromIso: string | null,
  toIso: string | null,
): boolean {
  if (!iso) return false
  if (fromIso && iso < fromIso) return false
  if (toIso && iso > toIso) return false
  return true
}
