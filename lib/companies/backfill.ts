import 'server-only'

/**
 * Company backfill for leads extracted before 0043 existed, and for any lead
 * whose linking step was skipped because it failed non-fatally in the worker.
 *
 * Resumable and re-runnable: it selects only leads with `company_id is null`,
 * so a run that stops partway leaves the rest for the next run, and a completed
 * run finds nothing to do.
 *
 * ⚠️ Service role. Every query is scoped by `user_id`.
 */
import { linkLeadsToCompanies, type LinkableLead } from '@/lib/companies/repository'
import { createAdminClient } from '@/lib/supabase/admin'

/** Leads per pass. Bounded so one invocation cannot outlive a function timeout. */
const BACKFILL_PAGE_SIZE = 500

/**
 * Rows per enumeration page.
 *
 * ⚠️ MUST NOT EXCEED PostgREST's `db-max-rows`, which defaults to 1000 on
 * Supabase. See the warning on `listUsersWithUnlinkedLeads`.
 */
const USER_SCAN_PAGE_SIZE = 1000

/** Pages of ids to walk before giving up and telling the caller to run again. */
const USER_SCAN_MAX_PAGES = 100

export type UnlinkedUserScan = {
  userIds: string[]
  /** True when the scan stopped early, so more accounts may still be waiting. */
  truncated: boolean
}

/**
 * Users who still own leads with no company.
 *
 * Reads only `user_id`, never lead content.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ `.limit(n)` DOES NOT GUARANTEE n ROWS.                               ║
 * ║                                                                          ║
 * ║  PostgREST caps every response at `db-max-rows` (1000 on Supabase) and   ║
 * ║  says nothing when it truncates. The first version of this function      ║
 * ║  asked for 5000, silently received 1000, and reported only the accounts  ║
 * ║  that happened to appear in that slice — so a backfill over 2,213 leads  ║
 * ║  skipped two entire accounts while reporting that it had finished.       ║
 * ║                                                                          ║
 * ║  Paginate with `.range()` and report truncation. Never trust a bare      ║
 * ║  `.limit()` above the row cap.                                           ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
export async function listUsersWithUnlinkedLeads(
  maxPages = USER_SCAN_MAX_PAGES,
  // Injectable so a test can prove the pagination loop without seeding 1,000+
  // rows. Never raise it above the server's row cap.
  pageSize = USER_SCAN_PAGE_SIZE,
): Promise<UnlinkedUserScan> {
  const supabase = createAdminClient()
  const userIds = new Set<string>()

  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize
    const { data, error } = await supabase
      .from('extracted_leads')
      .select('user_id')
      .is('company_id', null)
      // Ordered so paging is stable; without it Postgres may return rows in a
      // different order per page and skip some entirely.
      .order('user_id', { ascending: true })
      .range(from, from + pageSize - 1)

    if (error) throw new Error(`listUsersWithUnlinkedLeads failed: ${error.message}`)

    const rows = data ?? []
    for (const row of rows) userIds.add(row.user_id)

    // A short page is the end of the table — the only reliable signal, since
    // the server may have capped a full-looking one.
    if (rows.length < pageSize) {
      return { userIds: [...userIds], truncated: false }
    }
  }

  return { userIds: [...userIds], truncated: true }
}

export type BackfillResult = {
  /** Distinct leads this run attempted. Never counts a lead twice. */
  leadsExamined: number
  leadsLinked: number
  /** Distinct leads that carried nothing capable of identifying a company. */
  leadsUnidentified: number
  /**
   * Companies resolved, summed across pages. A company appearing in two pages
   * is counted twice — this is progress telemetry, not a distinct count.
   */
  companiesTouched: number
  /** True when leads with no company remain — call again to continue. */
  hasMore: boolean
}

/**
 * Links up to `maxLeads` unlinked leads for one user.
 *
 * `maxLeads` is a hard ceiling rather than "everything", because this runs in a
 * request-scoped runtime. The caller repeats until `hasMore` is false.
 *
 * ⚠️ Paging works by SKIPPING the leads already attempted, not by offsetting
 * blindly. Successfully linked leads drop out of the `company_id is null`
 * filter, while unidentifiable ones stay in it forever — so they collect at the
 * front of every subsequent page. Re-reading them would re-count them and, once
 * a page filled up with nothing but stuck rows, stall the run entirely.
 */
export async function backfillCompaniesForUser(
  userId: string,
  maxLeads = BACKFILL_PAGE_SIZE * 10,
): Promise<BackfillResult> {
  if (!userId) throw new Error('backfillCompaniesForUser: userId is required')

  const supabase = createAdminClient()

  let leadsExamined = 0
  let leadsLinked = 0
  let leadsUnidentified = 0
  let companiesTouched = 0
  /** Leads attempted that are still unlinked, and must be paged over. */
  let stuck = 0

  const done = (hasMore: boolean): BackfillResult => ({
    leadsExamined,
    leadsLinked,
    leadsUnidentified,
    companiesTouched,
    hasMore,
  })

  while (leadsExamined < maxLeads) {
    const pageSize = Math.min(BACKFILL_PAGE_SIZE, maxLeads - leadsExamined)

    const { data, error } = await supabase
      .from('extracted_leads')
      .select('id, company_name, company_url, company_website_url')
      // Service role bypasses RLS — scoping by user_id is mandatory.
      .eq('user_id', userId)
      .is('company_id', null)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(stuck, stuck + pageSize - 1)

    if (error) throw new Error(`backfillCompaniesForUser failed: ${error.message}`)

    const rows = data ?? []
    if (rows.length === 0) return done(false)

    const leads: LinkableLead[] = rows.map((row) => ({
      id: row.id,
      companyName: row.company_name,
      companyWebsiteUrl: row.company_website_url,
      companyLinkedInUrl: row.company_url,
    }))

    const result = await linkLeadsToCompanies(userId, leads)

    leadsExamined += rows.length
    leadsLinked += result.leadsLinked
    leadsUnidentified += result.leadsUnidentified
    companiesTouched += result.companiesTouched
    stuck += rows.length - result.leadsLinked

    // A short page means the table is exhausted for this user. This is the only
    // reliable end signal: a full-looking page may have been capped by the
    // server, and `leadsLinked === 0` is legitimate when a whole page is
    // unidentifiable rather than a reason to stop.
    if (rows.length < pageSize) return done(false)
  }

  return done(true)
}
