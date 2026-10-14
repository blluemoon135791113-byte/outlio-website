import 'server-only'

/**
 * What happens to an uploaded page after it is read.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ A SAVED PAGE IS KEPT ONLY AS LONG AS IT CAN STILL BE USEFUL.         ║
 * ║                                                                          ║
 * ║  Every page — browser upload or extension capture — carries the full     ║
 * ║  name, title, location and blurb of every person on it, and nothing      ║
 * ║  reads it again once it has parsed: the leads and the CSV come from the  ║
 * ║  database. On 2026-10-14 production held 230 such pages (179 MB),        ║
 * ║  forever. Now:                                                           ║
 * ║                                                                          ║
 * ║   · parsed  → removed once its JOB has finished (a job can be retried,   ║
 * ║               and the retry re-reads its files — removing one mid-job    ║
 * ║               would leave the retry with nothing);                       ║
 * ║   · failed  → kept FAILED_PAGE_DAYS, for a retry and for diagnosing a    ║
 * ║               LinkedIn markup change, then removed;                      ║
 * ║   · kept instead: `parse_census`, a fingerprint with no personal data.   ║
 * ║                                                                          ║
 * ║  The row stays (its hash keeps duplicate detection working); only        ║
 * ║  `content_purged_at` says the bytes are gone. `deleted_at` is NOT used:  ║
 * ║  the dashboard lists files WHERE deleted_at IS NULL.                     ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { STORAGE_BUCKET } from '@/lib/upload/process'
import { keyBelongsToUser } from '@/lib/upload/storage-key'

/** How long a page that failed to parse is kept. */
export const FAILED_PAGE_DAYS = 14

/**
 * Pages are removed only if uploaded on or after this instant — and not at
 * all while it is unset or unreadable.
 *
 * ⚠️ OFF UNTIL SET, DELIBERATELY. The pages already stored are not this
 * code's to delete; removing them is a separate, owner-approved decision. A
 * built-in default date would delete whatever was uploaded between that date
 * and the deploy, with nobody having said yes. Set RAW_PAGE_PURGE_FROM to the
 * deploy instant to start; setting it EARLIER is the approval to remove older
 * pages.
 */
export function purgeFrom(): Date | null {
  const raw = process.env.RAW_PAGE_PURGE_FROM?.trim()
  if (!raw) return null
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? new Date(parsed) : null
}

/* -------------------------------------------------------------------------- *
 * Credentials (CLAUDE.md rule 2)
 * -------------------------------------------------------------------------- */

/** LinkedIn session cookies. A value after one of these names is a credential. */
const COOKIE_NAMES = ['li_at', 'JSESSIONID', 'bcookie', 'bscookie', 'lidc', 'li_rm', 'liap', 'li_mc', 'li_gc', 'sdsc']

const SCRUBBERS: ReadonlyArray<{ pattern: RegExp; replace: string }> = [
  // name=value, as a cookie header or document.cookie string carries it.
  {
    pattern: new RegExp(`\\b(${COOKIE_NAMES.join('|')})=("?)[^;"'\\s<>&]{6,2000}`, 'g'),
    replace: '$1=$2[removed]',
  },
  // A JSON or JS property holding a session or CSRF value.
  {
    pattern: new RegExp(
      `((?:"|\\\\")(?:${[...COOKIE_NAMES, 'csrfToken', 'csrf-token', 'Csrf-Token', 'clientCsrfToken'].join('|')})(?:"|\\\\")\\s*:\\s*(?:"|\\\\"))[^"\\\\]{6,2000}`,
      'g',
    ),
    replace: '$1[removed]',
  },
  // <meta name="csrf-token" content="…"> in either attribute order.
  // LinkedIn's session/CSRF value shape wherever it appears on its own.
  { pattern: /\bajax:\d{6,}/g, replace: 'ajax:[removed]' },
]

const CSRF_META_NAME = /\bname\s*=\s*["']?csrf[-_]?token\b/i
const META_CONTENT = /(\bcontent\s*=\s*["'])[^"']{1,500}/i

/**
 * Blanks `<meta name="csrf-token" content="…">`, in either attribute order.
 *
 * ⚠️ A SCAN, NOT A PAGE-WIDE REGEX. This runs over a page of up to 10 MB that
 * a stranger can upload. A regex with wildcards around `<meta` backtracks on a
 * page of unclosed tags (measured: 4s on 4 MB even with bounded quantifiers).
 * Visiting each `<meta` once and testing only that tag (≤1,000 chars) is
 * linear in the page.
 */
function scrubCsrfMeta(html: string): { html: string; removed: number } {
  let removed = 0
  let out = ''
  let cursor = 0
  // The next `>` at or after the current tag. Re-searched only once passed,
  // so the page is scanned once in total — a fresh search per tag is itself
  // quadratic on a page with no `>` at all.
  let close = -2 // -2: not searched yet; -1: no `>` remains anywhere
  for (;;) {
    const start = html.indexOf('<meta', cursor)
    if (start === -1) break
    if (close !== -1 && close < start) close = html.indexOf('>', start)
    if (close === -1) break
    const end = close - start > 1_000 ? start + 5 : close + 1
    const tag = html.slice(start, end)
    let replaced = tag
    if (end === close + 1 && CSRF_META_NAME.test(tag) && META_CONTENT.test(tag)) {
      replaced = tag.replace(META_CONTENT, '$1[removed]')
      removed += 1
    }
    out += html.slice(cursor, start) + replaced
    cursor = end
  }
  return { html: out + html.slice(cursor), removed }
}

/**
 * PURE. Removes LinkedIn session and CSRF values from a saved page.
 *
 * A page saved while signed in can carry them in inline scripts. Outlio never
 * needs them, so they are never kept — not even for a page held 14 days.
 * Names stay (they are not secrets); only values are replaced.
 */
export function scrubLinkedInCredentials(html: string): { html: string; removed: number } {
  const meta = scrubCsrfMeta(html)
  let removed = meta.removed
  let out = meta.html
  for (const { pattern, replace } of SCRUBBERS) {
    out = out.replace(pattern, (...args: unknown[]) => {
      removed += 1
      const groups = args.slice(1, -2) as string[]
      return replace.replace(/\$(\d)/g, (_, n: string) => groups[Number(n) - 1] ?? '')
    })
  }
  return { html: out, removed }
}

/* -------------------------------------------------------------------------- *
 * Fingerprint
 * -------------------------------------------------------------------------- */

/**
 * The anchors the parsers rely on (docs/SELECTOR_MAP.md). Their counts across
 * uploads are what show a LinkedIn markup change — without keeping a page.
 */
const ANCHORS = [
  'person-name',
  'title',
  'company-name',
  'location',
  'job-title',
  'headshot-photo',
  'company-website',
] as const

export type PageCensus = {
  pageType: string
  bytes: number
  encoding: string
  anchors: Record<(typeof ANCHORS)[number], number>
  credentialsScrubbed: number
  /** True when the scrubbed copy could not replace the stored one. */
  scrubWriteBackFailed: boolean
}

/** PURE. Counts only: nothing read off the page is copied into it. */
export function pageCensus(input: {
  html: string
  pageType: string
  bytes: number
  encoding: string
  credentialsScrubbed: number
  scrubWriteBackFailed?: boolean
}): PageCensus {
  const anchors = Object.fromEntries(
    ANCHORS.map((name) => [name, input.html.split(`data-anonymize="${name}"`).length - 1]),
  ) as PageCensus['anchors']
  return {
    pageType: input.pageType,
    bytes: input.bytes,
    encoding: input.encoding,
    anchors,
    credentialsScrubbed: input.credentialsScrubbed,
    scrubWriteBackFailed: input.scrubWriteBackFailed ?? false,
  }
}

/* -------------------------------------------------------------------------- *
 * Removal
 * -------------------------------------------------------------------------- */

type PageRow = { id: string; user_id: string; storage_path: string }

/**
 * Marks then removes. The mark comes FIRST: if it cannot be written (0157 not
 * applied, or a database error) nothing is removed, so a page is never lost
 * untracked. If removal then fails, the mark is cleared for the next sweep.
 */
async function purgeRows(rows: readonly PageRow[]): Promise<number> {
  if (rows.length === 0) return 0
  const supabase = createAdminClient()
  // Defence in depth: a path outside its owner's folder is never touched.
  const safe = rows.filter((row) => keyBelongsToUser(row.storage_path, row.user_id))
  if (safe.length === 0) return 0
  const ids = safe.map((row) => row.id)

  const { error: markError } = await supabase
    .from('uploaded_files')
    .update({ content_purged_at: new Date().toISOString() })
    .in('id', ids)
    .is('content_purged_at', null)
  if (markError) return 0

  const { error: removeError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .remove(safe.map((row) => row.storage_path))
  if (removeError) {
    await supabase.from('uploaded_files').update({ content_purged_at: null }).in('id', ids)
    return 0
  }
  return safe.length
}

/**
 * Removes a FINISHED job's parsed pages. Failed ones stay for the sweep.
 * Never throws: the job's real work is already done.
 */
export async function discardProcessedPages(jobId: string, userId: string): Promise<number> {
  const from = purgeFrom()
  if (!from) return 0
  try {
    const { data, error } = await createAdminClient()
      .from('uploaded_files')
      .select('id, user_id, storage_path')
      // Service role bypasses RLS — scoping by user_id is mandatory.
      .eq('user_id', userId)
      .eq('extraction_job_id', jobId)
      .eq('status', 'processed')
      .is('content_purged_at', null)
      .gte('created_at', from.toISOString())
    if (error) {
      // A code, never a path: the sweep is the backstop for what this misses.
      console.warn('[pages] discard skipped', { code: error.code ?? 'unknown' })
      return 0
    }
    return await purgeRows((data ?? []) as PageRow[])
  } catch {
    return 0
  }
}

export type SweepOutcome = { processed: number; expired: number }

/**
 * The cron backstop, across every user (each row is purged under its own
 * user's path check):
 *
 *   · parsed pages left behind (a function killed between finishing the job
 *     and discarding), once their job is no longer running;
 *   · any page older than FAILED_PAGE_DAYS — a failed parse, or a job that
 *     never finished.
 */
export async function purgeDuePages(limit = 200, now = new Date()): Promise<SweepOutcome> {
  const outcome: SweepOutcome = { processed: 0, expired: 0 }
  const cutoff = purgeFrom()
  if (!cutoff) return outcome
  const supabase = createAdminClient()
  const from = cutoff.toISOString()

  const expiredBefore = new Date(now.getTime() - FAILED_PAGE_DAYS * 86_400_000).toISOString()
  /*
   * ⚠️ A FAILED READ THROWS. Swallowed, a missing column or a bad embed reads
   * as "0 removed" on a green tick, forever; thrown, `runJob` records it.
   */
  const { data: expired, error: expiredError } = await supabase
    .from('uploaded_files')
    .select('id, user_id, storage_path')
    .is('content_purged_at', null)
    .gte('created_at', from)
    .lt('created_at', expiredBefore)
    .order('created_at', { ascending: true })
    .limit(limit)
  if (expiredError) throw new Error(`page sweep read failed: ${expiredError.code ?? 'unknown'}`)
  outcome.expired = await purgeRows((expired ?? []) as PageRow[])

  const { data: parsed, error: parsedError } = await supabase
    .from('uploaded_files')
    .select('id, user_id, storage_path, extraction_job_id, extraction_jobs!inner(status)')
    .is('content_purged_at', null)
    .eq('status', 'processed')
    .gte('created_at', from)
    .in('extraction_jobs.status', ['completed', 'partially_completed', 'failed', 'cancelled'])
    .order('created_at', { ascending: true })
    .limit(limit)
  if (parsedError) throw new Error(`page sweep read failed: ${parsedError.code ?? 'unknown'}`)
  outcome.processed = await purgeRows((parsed ?? []) as PageRow[])

  return outcome
}
