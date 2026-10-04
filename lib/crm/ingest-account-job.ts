import 'server-only'

/**
 * "Add to CRM" for an ACCOUNT upload (a saved Account Hub list or account
 * search results): every account in the upload becomes, or is matched to, a
 * CRM account.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  EXPLICIT, LIKE THE LEAD BRIDGE. Nothing reaches the CRM until someone    ║
 * ║  asks; the button names the count.                                        ║
 * ║                                                                           ║
 * ║  FILL GAPS, NEVER OVERWRITE. Identity, industry, headcount and location   ║
 * ║  go through `upsertCrmCompany`, whose `fillCompanyGaps` only fills NULLs — ║
 * ║  the rule every import already follows. The About summary and a headcount  ║
 * ║  RANGE are filled the same way here (only where empty), because that      ║
 * ║  function does not know those columns.                                    ║
 * ║                                                                           ║
 * ║  EVERY VALUE KEEPS ITS CITATION. One `crm_company_sources` row per        ║
 * ║  account per upload (0156's index makes a second click a no-op), holding  ║
 * ║  the values that page showed and LinkedIn's signals — dated by the row.   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * Owner, status, tags and assignments are never touched: a new account starts
 * unassigned, exactly as a CSV import does.
 */
import { upsertCrmCompany } from '@/lib/crm/repository'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/types/database'

export type AccountJobIngestResult = {
  accountsCreated: number
  accountsMatched: number
  /** Rows that identified no company, or failed on their own. */
  accountsSkipped: number
}

// PostgREST caps a response at 1,000 rows. Page by the unique immutable ID,
// not source_row_index (which repeats across saved pages), and keep the owner
// and upload predicates on EVERY read. Continue until empty, even if a server
// returns less than our requested page size. Only one page is held at a time.
async function* accountEntries(userId: string, extractionJobId: string) {
  const db = createAdminClient()
  let after: string | null = null
  while (true) {
    let query = db.from('account_list_entries')
      .select('id, company_id, source_row_index, page_kind, company_name_snapshot, company_sales_navigator_url, industry_snapshot, employee_count_snapshot, employee_count_range_snapshot, summary_snapshot, location_snapshot, signals')
      .eq('user_id', userId)
      .eq('extraction_job_id', extractionJobId)
      .order('id')
      .limit(500)
    if (after !== null) query = query.gt('id', after)
    const { data, error } = await query
    if (error) throw new Error(`ingestAccountJob failed: ${error.message}`)
    if (!data?.length) return
    yield* data
    after = data[data.length - 1].id
  }
}

export async function ingestAccountJob(
  workspaceId: string,
  extractionJobId: string,
  actorUserId: string,
): Promise<AccountJobIngestResult> {
  const db = createAdminClient()

  // ---- tenancy: the upload belongs to a USER, the CRM to a WORKSPACE --------
  const { data: job, error: jobError } = await db
    .from('extraction_jobs')
    .select('id, user_id, kind, trashed_at')
    .eq('id', extractionJobId)
    .maybeSingle()
  if (jobError) throw new Error(`ingestAccountJob failed: ${jobError.message}`)
  if (!job || job.trashed_at) throw new Error('ingestAccountJob: no such extraction job')

  // ⚠️ MEMBERSHIP BEFORE KIND: an upload outside this workspace answers exactly
  // like a missing one, so a guessed id learns nothing about what it holds.
  const { data: membership, error: memberError } = await db
    .from('workspace_memberships')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', job.user_id)
    .maybeSingle()
  if (memberError) throw new Error(`ingestAccountJob failed: ${memberError.message}`)
  if (!membership) throw new Error('ingestAccountJob: no such extraction job')

  if (job.kind !== 'account_list') throw new Error('ingestAccountJob: not an account upload')

  const result: AccountJobIngestResult = { accountsCreated: 0, accountsMatched: 0, accountsSkipped: 0 }

  for await (const entry of accountEntries(job.user_id, extractionJobId)) {
    let accountId: string
    try {
      const upserted = await upsertCrmCompany(
        workspaceId,
        {
          name: entry.company_name_snapshot,
          salesNavigatorUrl: entry.company_sales_navigator_url,
          industry: entry.industry_snapshot,
          employeeCount: entry.employee_count_snapshot,
          headquarters: entry.location_snapshot,
          sourceCompanyId: entry.company_id,
          source: 'lead_engine',
        },
        actorUserId,
      )
      accountId = upserted.id
      if (upserted.created) result.accountsCreated += 1
      else result.accountsMatched += 1
    } catch {
      // One account that cannot be resolved must not cost the rest.
      result.accountsSkipped += 1
      continue
    }

    // Only where empty: the column's own rule (0145) and fillCompanyGaps'. A
    // failure here leaves a gap, never a wrong value; the source row still cites
    // what the page showed, and pressing the button again retries the fill.
    if (entry.summary_snapshot) {
      const { error } = await db
        .from('crm_companies')
        .update({ summary: entry.summary_snapshot })
        .eq('workspace_id', workspaceId)
        .eq('id', accountId)
        .is('summary', null)
      if (error) console.error('[ingestAccountJob] summary', { accountId, error: error.message })
    }
    /*
     * A RANGE only beside NO exact count. An account already holding "253" from
     * a company page must not also show "1.2K+" from a search card — two
     * observed values that contradict each other read as one wrong one.
     */
    if (entry.employee_count_range_snapshot) {
      const { error } = await db
        .from('crm_companies')
        .update({ employee_count_range: entry.employee_count_range_snapshot })
        .eq('workspace_id', workspaceId)
        .eq('id', accountId)
        .is('employee_count_range', null)
        .is('employee_count', null)
      if (error) console.error('[ingestAccountJob] range', { accountId, error: error.message })
    }

    const payload: Record<string, Json> = {
      page: entry.page_kind,
      name: entry.company_name_snapshot,
      industry: entry.industry_snapshot,
      employeeCount: entry.employee_count_snapshot,
      employeeCountRange: entry.employee_count_range_snapshot,
      location: entry.location_snapshot,
      summary: entry.summary_snapshot,
      signals: entry.signals,
      row: entry.source_row_index,
    }
    // ON CONFLICT DO NOTHING on (company_id, extraction_job_id) — 0156.
    const { error: sourceError } = await db.from('crm_company_sources').upsert(
      {
        workspace_id: workspaceId,
        company_id: accountId,
        source_type: 'html_upload',
        extraction_job_id: extractionJobId,
        url: entry.company_sales_navigator_url,
        raw_payload: payload,
        imported_by: actorUserId,
      },
      { onConflict: 'company_id,extraction_job_id', ignoreDuplicates: true },
    )
    if (sourceError) console.error('[ingestAccountJob] source', { accountId, error: sourceError.message })
  }

  return result
}
