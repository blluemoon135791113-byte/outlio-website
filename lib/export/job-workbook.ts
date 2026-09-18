import 'server-only'

/**
 * One extraction job as an Excel workbook with clickable links.
 *
 * ⚠️ BUILT ON DEMAND, NOT STORED. The CSV is a snapshot the worker writes into
 * the `exports` bucket; this is assembled from the database at download time
 * instead, for three reasons:
 *
 *  - it works for every job that already exists, the moment it ships, with no
 *    backfill and no change to the worker;
 *  - the bucket's `allowed_mime_types` would otherwise need an XLSX type, which
 *    is a migration for a convenience file;
 *  - the rows it reads are the ones `rebuildJobExport` reads after enrichment,
 *    so the workbook is never staler than the CSV.
 *
 * The rows and columns come from the SAME builders the CSV uses
 * (`leadExportShape`, `accountExportShape`) and pass through the same
 * `toTable`, so the two downloads of one job always match cell for cell.
 */
import { loadAccountExportRecords } from '@/lib/export/account-loader'
import { ALWAYS_EXPORTED_ACCOUNT_COLUMNS, accountExportShape } from '@/lib/export/accounts'
import { ALWAYS_EXPORTED } from '@/lib/export/leads'
import { toTable } from '@/lib/export/sanitize'
import { toXlsx } from '@/lib/export/xlsx'
import { createAdminClient } from '@/lib/supabase/admin'
import { leadExportShape, loadJobLeads } from '@/lib/worker/rebuild-export'

export type JobWorkbookResult =
  | { ok: true; bytes: Uint8Array; filename: string }
  | { ok: false; reason: 'not_found' | 'not_ready' | 'empty' | 'too_large' | 'unavailable' }

/** Only a finished run has a stable set of rows worth downloading. */
const FINISHED = new Set(['completed', 'partially_completed'])

/**
 * The most rows one on-demand workbook will be built for.
 *
 * ⚠️ A CEILING ON WORK DONE PER CLICK, NOT A PRODUCT LIMIT. The workbook is
 * assembled in memory inside a 60-second function on every request, so its cost
 * grows with the job. A real job sits far below this: an upload is capped at 100
 * saved pages of ~25 rows, about 2,500. Anything above it is refused with a
 * pointer to the CSV, which the worker builds once and costs nothing to download.
 *
 * MEASURED (2026-09-19, one Windows dev machine, lead rows with four URL
 * columns): 2,500 rows ≈ 1 s; 10,000 rows ≈ 4 s typically, ~85% of it zipping
 * the XML, though one run took 16 s — timings here are noisy. A 25,000-row build
 * took ~8 s alone but ~40 s while the test suite ran in parallel: a fivefold
 * slowdown under CPU contention, which is closer to what a serverless function
 * on a fractional CPU sees. 25,000 was too close to the 60 s budget. At 10,000
 * the same fivefold ratio suggests ~20 s — an estimate, not a measurement — and
 * it is still four times the largest real job. Re-measure before raising it.
 */
export const MAX_WORKBOOK_ROWS = 10_000

export async function buildJobWorkbook(
  userId: string,
  jobId: string,
): Promise<JobWorkbookResult> {
  const { data: job, error } = await createAdminClient()
    .from('extraction_jobs')
    .select('id, kind, status')
    // Service role bypasses RLS — this scoping IS the authorization. Another
    // user's job id answers exactly like one that does not exist.
    .eq('id', jobId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) return { ok: false, reason: 'unavailable' }
  if (!job) return { ok: false, reason: 'not_found' }
  if (!FINISHED.has(job.status)) return { ok: false, reason: 'not_ready' }

  const suffix = jobId.slice(0, 8)

  if (job.kind === 'account_list') {
    let accounts
    try {
      accounts = await loadAccountExportRecords(userId, jobId)
    } catch {
      return { ok: false, reason: 'unavailable' }
    }
    if (accounts.length === 0) return { ok: false, reason: 'empty' }
    if (accounts.length > MAX_WORKBOOK_ROWS) return { ok: false, reason: 'too_large' }

    const { records, columns } = accountExportShape(accounts)
    const table = toTable(records, columns, { alwaysKeep: ALWAYS_EXPORTED_ACCOUNT_COLUMNS })
    return { ok: true, bytes: await toXlsx(table, 'Accounts'), filename: `outlio-accounts-${suffix}.xlsx` }
  }

  const leads = await loadJobLeads(jobId, userId)
  // ⚠️ A failed read is refused, never served as a shorter workbook.
  if (leads === null) return { ok: false, reason: 'unavailable' }
  if (leads.length === 0) return { ok: false, reason: 'empty' }
  if (leads.length > MAX_WORKBOOK_ROWS) return { ok: false, reason: 'too_large' }

  const { records, columns } = leadExportShape(leads)
  const table = toTable(records, columns, { alwaysKeep: ALWAYS_EXPORTED })
  return { ok: true, bytes: await toXlsx(table, 'Leads'), filename: `outlio-leads-${suffix}.xlsx` }
}
