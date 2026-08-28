import 'server-only'

/**
 * Job processor.
 *
 * ⚠️ DEPLOYMENT-AGNOSTIC BY DESIGN.
 *
 * Today this runs via `after()` on the upload request. Later it will run in a
 * long-lived container loop. Neither this file nor the queue semantics change —
 * only the caller does. See CLAUDE.md "Worker deployment".
 *
 * Per-file isolation is the core guarantee: one unreadable file never fails the
 * batch. A job ends `partially_completed` when at least one file succeeded and
 * at least one failed, and `failed` only when none succeeded.
 */
import { createHash } from 'node:crypto'

import { linkLeadsToCompanies } from '@/lib/companies/repository'
import { toCsv, type CsvColumn } from '@/lib/export/sanitize'
import { ALWAYS_EXPORTED, EXPORT_COLUMN_HEADERS } from '@/lib/export/leads'
import { dedupeLeads, type DedupeMode, type KeyedLead } from '@/lib/leads/dedupe'
import { ParseError, parseSearchResults } from '@/lib/leads/parse'
import { detectSavedPageType } from '@/lib/leads/page-type'
import { AccountListParseError, parseAccountList, type ParsedAccount } from '@/lib/companies/parse-account-list'
import { ingestAccounts } from '@/lib/companies/ingest-accounts'
import { createAdminClient } from '@/lib/supabase/admin'
import { SNIFF_BYTES, sniffHtml } from '@/lib/upload/sniff'
import { STORAGE_BUCKET } from '@/lib/upload/process'
import {
  mapInConcurrentBatches,
  resolveFileConcurrency,
} from '@/lib/worker/concurrency'
import { enrichJobFree } from '@/lib/worker/enrich-free'
import { rebuildJobExport } from '@/lib/worker/rebuild-export'

/**
 * Exports live in their OWN bucket, not alongside uploads.
 *
 * `uploads` is locked to `text/html` so a compromised path cannot be used to
 * store anything else — writing a CSV there would mean loosening that. Separate
 * buckets also let uploads and exports carry different size limits and
 * retention. Both are private; exports are reachable only via a signed URL the
 * server issues after re-verifying ownership.
 */
const EXPORT_BUCKET = process.env.SUPABASE_EXPORT_BUCKET ?? 'exports'

export type ProcessOutcome = {
  jobId: string
  status: 'completed' | 'partially_completed' | 'failed'
  leadsParsed: number
  leadsKept: number
  filesProcessed: number
  filesFailed: number
}

/**
 * CSV column order. `sanitizeCell` is applied by `toCsv` to every cell.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ TWO DIFFERENT URLS, AND THE NAMES INVITE CONFUSING THEM.             ║
 * ║                                                                          ║
 * ║    ParsedLead.companyUrl         → the LinkedIn/Sales Navigator company  ║
 * ║                                    page  (`/sales/company/123`)          ║
 * ║    ParsedLead.companyWebsiteUrl  → the company's OWN external website    ║
 * ║                                                                          ║
 * ║  while on the export side the header keys read the other way round:      ║
 * ║                                                                          ║
 * ║    EXPORT_COLUMN_HEADERS.companyUrl         → "Company Website URL"      ║
 * ║    EXPORT_COLUMN_HEADERS.companyLinkedInUrl → "Company LinkedIn URL"     ║
 * ║                                                                          ║
 * ║  This file previously paired `EXPORT_COLUMN_HEADERS.companyUrl` with     ║
 * ║  `l.companyUrl`, so the downloaded CSV had a column headed "Company      ║
 * ║  Website URL" full of linkedin.com addresses — and the real website,     ║
 * ║  which the extension does extra work to capture, reached no CSV at all.  ║
 * ║  `tests/unit/parse-leads.test.ts` pins the pairing now.                  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * The order matches `EXPORT_COLUMN_ORDER`, so a downloaded CSV and a CRM push
 * of the same leads have the same columns in the same places.
 */
export const CSV_COLUMNS: CsvColumn<KeyedLead>[] = [
  // The person, and both of their links together.
  { header: EXPORT_COLUMN_HEADERS.name, value: (l) => l.fullName },
  { header: EXPORT_COLUMN_HEADERS.linkedinProfile, value: (l) => l.linkedinUrl },
  { header: EXPORT_COLUMN_HEADERS.salesNavigatorUrl, value: (l) => l.salesNavUrl },
  { header: EXPORT_COLUMN_HEADERS.jobTitle, value: (l) => l.jobTitle },
  { header: EXPORT_COLUMN_HEADERS.location, value: (l) => l.location },

  // The company, and all of its links together.
  { header: EXPORT_COLUMN_HEADERS.company, value: (l) => l.companyName },
  { header: EXPORT_COLUMN_HEADERS.companyLinkedInUrl, value: (l) => l.companyUrl },
  /*
   * Derived from the Sales Navigator company URL already on the row — a pure
   * rewrite, no page visit. The COUNTS below are the page-only ones.
   */
  { header: EXPORT_COLUMN_HEADERS.companyPublicLinkedIn, value: (l) => l.companyPublicLinkedInUrl },
  { header: EXPORT_COLUMN_HEADERS.companyUrl, value: (l) => l.companyWebsiteUrl },
  { header: EXPORT_COLUMN_HEADERS.companyIndustry, value: (l) => l.companyIndustry },
  { header: EXPORT_COLUMN_HEADERS.companySize, value: (l) => l.companySize },
  { header: EXPORT_COLUMN_HEADERS.companyEmployeeCount, value: () => null },
  { header: EXPORT_COLUMN_HEADERS.companyDecisionMakers, value: () => null },
  { header: EXPORT_COLUMN_HEADERS.companyInvestors, value: () => null },

  // The relationship.
  { header: EXPORT_COLUMN_HEADERS.connectionDegree, value: (l) => l.connectionDegree },
  {
    header: EXPORT_COLUMN_HEADERS.reachable,
    // `null` means the badge was absent, which is not the same as "no".
    value: (l) => (l.isReachable === true ? 'Yes' : null),
  },
  { header: EXPORT_COLUMN_HEADERS.listCount, value: (l) => l.listCount },
  { header: EXPORT_COLUMN_HEADERS.lastActivity, value: (l) => l.lastActivity },

  // Provenance.
  { header: EXPORT_COLUMN_HEADERS.leadSource, value: () => 'search' },
  { header: EXPORT_COLUMN_HEADERS.sourceList, value: (l) => l.sourceList },
]

/** Truncates upstream error text so an HTML error page never reaches a log. */
function concise(message: string): string {
  const first = message.split('\n')[0]?.trim() ?? ''
  const stripped = first.startsWith('<') ? 'upstream returned HTML' : first
  return stripped.length > 160 ? `${stripped.slice(0, 160)}…` : stripped
}

/**
 * Processes one claimed job end to end.
 *
 * Idempotent: leads for the job are deleted before insertion, so a retry after
 * a partial run cannot duplicate rows.
 */
export async function processJob(jobId: string, userId: string): Promise<ProcessOutcome> {
  const supabase = createAdminClient()

  const { data: job } = await supabase
    .from('extraction_jobs')
    .select('id, user_id, dedupe_mode, capture_session_id')
    .eq('id', jobId)
    // Service role bypasses RLS — scoping by user_id is mandatory.
    .eq('user_id', userId)
    .maybeSingle()

  if (!job) throw new Error('processJob: job not found for this user')

  const { data: files } = await supabase
    .from('uploaded_files')
    .select('id, storage_path, original_filename')
    .eq('extraction_job_id', jobId)
    .eq('user_id', userId)
    .is('deleted_at', null)

  const fileList = files ?? []
  const total = fileList.length

  type ParsedLeadRow = Extract<Awaited<ReturnType<typeof parseOne>>, { kind: 'lead_search' }>['leads'][number]

  const allLeads: Array<ParsedLeadRow & { uploadedFileId: string }> = []
  /* Accounts accumulate alongside leads; a job resolves to one kind below. */
  const allAccounts: ParsedAccount[] = []
  let filesProcessed = 0
  let filesFailed = 0
  const fileConcurrency = resolveFileConcurrency(process.env.WORKER_FILE_CONCURRENCY)

  type FileResult =
    | { ok: true; fileId: string; leads: ParsedLeadRow[]; accounts: ParsedAccount[] }
    | { ok: false; fileId: string }

  await mapInConcurrentBatches(
    fileList,
    fileConcurrency,
    async (file): Promise<FileResult> => {
      try {
        const parsed = await parseOne(file.storage_path, file.id, userId, jobId)
        const leads = parsed.kind === 'lead_search' ? parsed.leads : []
        const accounts = parsed.kind === 'account_list' ? parsed.accounts : []

        await supabase
          .from('uploaded_files')
          .update({
            status: 'processed',
            // `leads_found` counts what the file yielded, whichever kind it is.
            leads_found: leads.length + accounts.length,
            processed_at: new Date().toISOString(),
          })
          .eq('id', file.id)
          .eq('extraction_job_id', jobId)
          .eq('user_id', userId)

        return { ok: true, fileId: file.id, leads, accounts }
      } catch (e) {
        // PER-FILE ISOLATION: record and continue. One bad file never fails the batch.
        const code = e instanceof ParseError ? e.code : 'ERR_FILE_FORMAT'
        await supabase
          .from('uploaded_files')
          .update({
            status: 'failed',
            error_code: code,
            error_message: concise(e instanceof Error ? e.message : 'parse failed'),
          })
          .eq('id', file.id)
          .eq('extraction_job_id', jobId)
          .eq('user_id', userId)

        return { ok: false, fileId: file.id }
      }
    },
    {
      onBatchStart: async (start, end) => {
        await supabase
          .from('extraction_jobs')
          .update({
            progress_step: `Processing files ${start + 1}-${end} of ${total}`,
            progress_current: start,
            progress_total: total,
          })
          .eq('id', jobId)
          .eq('user_id', userId)
      },
      onBatchComplete: async (results, completed) => {
        for (const result of results) {
          if (result.ok) {
            allLeads.push(...result.leads.map((lead) => ({ ...lead, uploadedFileId: result.fileId })))
            allAccounts.push(...result.accounts)
            filesProcessed += 1
          } else {
            filesFailed += 1
          }
        }

        await supabase
          .from('extraction_jobs')
          .update({
            progress_current: completed,
            progress_total: total,
            leads_parsed: allLeads.length,
          })
          .eq('id', jobId)
          .eq('user_id', userId)
      },
    },
  )

  /*
   * ╔══════════════════════════════════════════════════════════════════════════╗
   * ║  AN ACCOUNT RUN LEAVES HERE. IT IS NOT A LEAD RUN WITH DIFFERENT ROWS.   ║
   * ║                                                                          ║
   * ║  Everything below — credit charging per block of leads, person dedupe,   ║
   * ║  lead inserts, the CSV export — is shaped around people. Threading       ║
   * ║  companies through it would mean a charge computed from a lead count     ║
   * ║  that is zero, a dedupe keyed on a person who does not exist, and an     ║
   * ║  export with person headers. The queue, claim, retry and reaper are      ║
   * ║  shared because they are the hard part; the OUTPUT is not.               ║
   * ╚══════════════════════════════════════════════════════════════════════════╝
   */
  if (allAccounts.length > 0) {
    /*
     * ⚠️ MIXED UPLOADS ARE REFUSED, NOT SILENTLY HALVED. A batch holding both
     * page types has no honest outcome: charging for the leads and quietly
     * ingesting the companies would report one number for two jobs. Say so and
     * let the user split the upload.
     */
    if (allLeads.length > 0) {
      await supabase
        .from('extraction_jobs')
        .update({
          status: 'failed',
          error_code: 'ERR_FILE_FORMAT',
          error_message:
            'This upload mixes lead search pages with account lists. ' +
            'Upload each kind separately.',
          progress_step: 'Mixed page types',
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId)
        .eq('user_id', userId)

      await supabase.from('job_queue').update({ status: 'done' }).eq('job_id', jobId)

      return {
        jobId,
        status: 'failed',
        leadsParsed: allLeads.length,
        leadsKept: 0,
        filesProcessed,
        filesFailed,
      }
    }

    const ingest = await ingestAccounts(userId, allAccounts)

    await supabase
      .from('extraction_jobs')
      .update({
        kind: 'account_list',
        accounts_parsed: allAccounts.length,
        accounts_created: ingest.created,
        accounts_matched: ingest.matched,
        accounts_unidentified: ingest.unidentified,
        status: filesFailed > 0 ? 'partially_completed' : 'completed',
        progress_step: null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('user_id', userId)

    await supabase.from('job_queue').update({ status: 'done' }).eq('job_id', jobId)

    return {
      jobId,
      status: filesFailed > 0 ? ('partially_completed' as const) : ('completed' as const),
      filesProcessed,
      filesFailed,
      leadsParsed: 0,
      leadsKept: 0,
    }
  }

  // ---- charge ------------------------------------------------------------
  /*
   * Credits are billed per block of LEADS, so the charge can only happen now —
   * the count did not exist until the files were parsed. It runs BEFORE any
   * lead row is inserted and before the CSV is written, so a user who cannot
   * afford the run is never billed and never receives a partial export.
   *
   * Billed on leads PARSED, not on leads kept: the work is the parsing, and
   * dedupe removing a row the user already owns does not make it free.
   *
   * Idempotent in the database via extraction_jobs.credits_charged, which
   * matters because `after()` retries and the reaper can re-run a claim.
   */
  if (allLeads.length > 0) {
    const { data: chargeRows, error: chargeError } = await supabase.rpc(
      'charge_extraction_leads',
      { p_job_id: jobId, p_user_id: userId, p_lead_count: allLeads.length },
    )

    if (chargeError) {
      throw new Error(`credit charge failed: ${concise(chargeError.message)}`)
    }

    const charge = Array.isArray(chargeRows) ? chargeRows[0] : chargeRows

    if (charge?.status === 'insufficient_credits') {
      // Nothing was spent. Fail loudly and deliver nothing, rather than
      // handing over a silently truncated list.
      await supabase
        .from('extraction_jobs')
        .update({
          status: 'failed',
          error_code: 'ERR_LIMIT_REACHED',
          error_message:
            `This extraction found ${allLeads.length} leads and needs ` +
            `${charge.required} credits, which is more than you have left this month.`,
          progress_step: 'Not enough credits',
          progress_current: total,
          progress_total: total,
          leads_parsed: allLeads.length,
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId)
        .eq('user_id', userId)

      await supabase.from('job_queue').update({ status: 'done' }).eq('job_id', jobId)

      return {
        jobId,
        status: 'failed',
        leadsParsed: allLeads.length,
        leadsKept: 0,
        filesProcessed,
        filesFailed,
      }
    }
  }

  // ---- dedupe ------------------------------------------------------------
  await supabase
    .from('extraction_jobs')
    .update({ progress_step: 'Removing duplicates', progress_current: total })
    .eq('id', jobId)

  const { data: existing } = await supabase
    .from('lead_keys')
    .select('dedupe_key')
    .eq('user_id', userId)

  const existingKeys = new Set((existing ?? []).map((r) => r.dedupe_key))

  const { kept, report } = dedupeLeads(
    allLeads,
    (job.dedupe_mode ?? 'remove_exact') as DedupeMode,
    existingKeys,
  )

  // ---- persist -----------------------------------------------------------
  // Delete-then-insert scoped to this job makes retries idempotent.
  await supabase.from('extracted_leads').delete().eq('extraction_job_id', jobId).eq('user_id', userId)

  if (kept.length > 0) {
    const rows = kept.map((l) => ({
      user_id: userId,
      extraction_job_id: jobId,
      uploaded_file_id: (l as { uploadedFileId?: string }).uploadedFileId ?? null,
      full_name: l.fullName,
      linkedin_url: l.linkedinUrl,
      sales_navigator_url: l.salesNavUrl,
      job_title: l.jobTitle,
      company_name: l.companyName,
      company_url: l.companyUrl,
      company_website_url: l.companyWebsiteUrl,
      source_list: l.sourceList,
      company_public_linkedin_url: l.companyPublicLinkedInUrl,
      company_industry: l.companyIndustry,
      company_size: l.companySize,
      company_headquarters: l.companyHeadquarters,
      connection_degree: l.connectionDegree,
      is_reachable: l.isReachable,
      list_count: l.listCount,
      last_activity: l.lastActivity,
      added_to_list_at: l.addedToListAt,
      location: l.location,
      person_blurb: l.personBlurb,
      tenure_in_role: l.tenureInRole,
      tenure_in_company: l.tenureInCompany,
      source_row_index: l.sourceRowIndex,
      dedupe_key: l.dedupeKey,
      dedupe_strategy: l.dedupeStrategy,
      is_duplicate: false,
    }))

    // Chunked so a large batch does not exceed the request size limit.
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from('extracted_leads').insert(rows.slice(i, i + 500))
      if (error) throw new Error(`lead insert failed: ${concise(error.message)}`)
    }
  }

  /*
   * Resolve each lead to a company so company-level research runs once per
   * company rather than once per employee.
   *
   * Deliberately non-fatal, for the same reason as the capture-totals roll-up
   * below: the leads are already committed and the user's CSV is about to be
   * written. A failure here costs a later backfill, not the run. Unlinked leads
   * are exactly what `backfillCompaniesForUser` selects.
   */
  if (kept.length > 0) {
    try {
      const { data: insertedLeads } = await supabase
        .from('extracted_leads')
        .select('id, company_name, company_url, company_website_url')
        .eq('extraction_job_id', jobId)
        .eq('user_id', userId)

      if (insertedLeads && insertedLeads.length > 0) {
        await linkLeadsToCompanies(
          userId,
          insertedLeads.map((row) => ({
            id: row.id,
            companyName: row.company_name,
            companyWebsiteUrl: row.company_website_url,
            companyLinkedInUrl: row.company_url,
          })),
        )
      }
    } catch {
      // Company linking is repairable after the fact; lead data is not.
    }
  }

  // ---- export ------------------------------------------------------------
  await supabase
    .from('extraction_jobs')
    .update({ progress_step: 'Generating export' })
    .eq('id', jobId)

  const csv = toCsv(kept, CSV_COLUMNS, { alwaysKeep: ALWAYS_EXPORTED })
  const exportPath = `${userId}/${jobId}/leads.csv`

  const { error: uploadError } = await supabase.storage
    .from(EXPORT_BUCKET)
    .upload(exportPath, new TextEncoder().encode(csv), {
      // No `; charset=utf-8` parameter: Supabase matches the content type
      // against the bucket's allowed_mime_types as a WHOLE STRING, so the
      // parameter causes a spurious "mime type not supported" rejection.
      // Encoding is signalled by the UTF-8 BOM that toCsv() writes.
      contentType: 'text/csv',
      upsert: true,
    })

  if (uploadError) throw new Error(`export upload failed: ${concise(uploadError.message)}`)

  // ---- finalise ----------------------------------------------------------
  // ⚠️ FINALISE FIRST. The extraction is done the moment the CSV exists —
  // holding the job at "Processing" for the minutes the enrichment waterfall
  // takes stalled the user's workflow against a finished file. Enrichment now
  // continues in the background and the CSV is silently rebuilt when it lands.
  const status: ProcessOutcome['status'] =
    filesProcessed === 0 ? 'failed' : filesFailed > 0 ? 'partially_completed' : 'completed'

  await supabase
    .from('extraction_jobs')
    .update({
      status,
      progress_step:
        status === 'completed'
          ? 'Completed'
          : status === 'partially_completed'
            ? 'Completed with errors'
            : 'Failed',
      progress_current: total,
      progress_total: total,
      leads_parsed: report.totalParsed,
      leads_kept: report.uniqueKept,
      duplicates_found: report.duplicatesFound,
      duplicates_removed: report.duplicatesRemoved,
      export_storage_path: exportPath,
      completed_at: new Date().toISOString(),
      error_code: status === 'failed' ? 'ERR_FILE_FORMAT' : null,
    })
    .eq('id', jobId)

  await supabase.from('job_queue').update({ status: 'done' }).eq('job_id', jobId)

  /*
   * ---- free enrichment, off the critical path ------------------------------
   *
   * FREE SOURCES ONLY. This runs on every extraction, so anything metered here
   * would bill on every upload with nobody pressing a button. It fills company
   * gaps the hover card missed and stands aside entirely if paid providers have
   * been switched on.
   *
   * The pass runs the ordinary research pipeline over the job's leads —
   * company facts AND the free contact sources (scout: website-published
   * emails; social-scout: bio emails and handle inventories). Only verified-
   * by-publication addresses are ever stored; nothing is guessed.
   *
   * Not awaited: the user is already reading their leads. When the waterfall
   * settles, the CSV is rewritten in place with whatever was found.
   */
  void enrichJobFree(jobId, userId)
    .then(async (enriched) => {
      if (enriched.evidenceWritten > 0 || enriched.leadsUpdated > 0) {
        await rebuildJobExport(jobId, userId)
      }
    })
    .catch(() => {
      // The extraction stands on its own; enrichment is additive.
    })

  /*
   * Extension captures only: roll the per-page result into its capture
   * session so the popup and the dashboard widget show live totals.
   *
   * Deliberately last, and deliberately non-fatal. The leads are already
   * committed and the CSV is written by this point; a failure to update a
   * progress counter must never fail a job whose real work succeeded.
   */
  if (job.capture_session_id) {
    try {
      const { data: page } = await supabase
        .from('capture_pages')
        .select('id')
        .eq('extraction_job_id', jobId)
        .eq('user_id', userId)
        .maybeSingle()

      if (page) {
        await supabase.rpc('roll_capture_totals', {
          p_page_id: page.id,
          p_user_id: userId,
          p_job_id: jobId,
          p_leads_found: report.totalParsed,
          p_leads_kept: report.uniqueKept,
          p_status: status === 'failed' ? 'failed' : 'processed',
        })
      }
    } catch {
      // Counters are cosmetic; the lead data is the product.
    }
  }

  return {
    jobId,
    status,
    leadsParsed: report.totalParsed,
    leadsKept: report.uniqueKept,
    filesProcessed,
    filesFailed,
  }
}

/**
 * Downloads one uploaded file, VALIDATES ITS CONTENT, then parses it.
 *
 * ⚠️ THIS IS WHERE CONTENT SNIFFING HAPPENS.
 *
 * Files now arrive via signed upload URLs straight from the browser, so no
 * server route ever sees the bytes at upload time. Sniffing therefore runs here,
 * on the real bytes, before a single selector is applied — still server-side,
 * just later in the pipeline. A `.exe` renamed `.html` is rejected at this point
 * exactly as it was before.
 *
 * The real sha256 is also computed here and written back, replacing the
 * placeholder the upload session inserted.
 */
async function parseOne(storagePath: string, fileId: string, userId: string, jobId: string) {
  const supabase = createAdminClient()

  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(storagePath)
  if (error || !data) throw new Error(`download failed: ${concise(error?.message ?? 'no data')}`)

  const bytes = new Uint8Array(await data.arrayBuffer())

  const sniff = sniffHtml(bytes.subarray(0, SNIFF_BYTES), bytes.byteLength)
  if (!sniff.ok) {
    throw new ParseError(
      sniff.code === 'ERR_FILE_EMPTY' ? 'ERR_FILE_FORMAT' : sniff.code === 'ERR_FILE_TYPE' ? 'ERR_FILE_FORMAT' : sniff.code,
      `content rejected: ${sniff.detail}`,
    )
  }

  // Record the true content hash now that we have the bytes.
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  await supabase
    .from('uploaded_files')
    .update({ content_sha256: sha256 })
    .eq('id', fileId)
    .eq('extraction_job_id', jobId)
    .eq('user_id', userId)

  // Decode with the encoding the sniffer detected, not a hardcoded UTF-8 —
  // that assumption is defect G3 in the original scraper.
  const html = new TextDecoder(sniff.encoding, { fatal: false }).decode(bytes)

  /*
   * ⚠️ ROUTE BEFORE PARSING, SO A VALID FILE IS NOT CALLED BROKEN.
   *
   * An Account Hub page fed to the lead parser yields zero leads, which is
   * correctly raised as ERR_FILE_FORMAT — and is nonetheless the wrong answer:
   * the file was fine, we pointed the wrong reader at it. The user then gets
   * "this page could not be read" for a page we can read, and no hint that
   * they uploaded the wrong KIND of export.
   *
   * Account lists are parsed by `lib/companies/parse-account-list.ts`, but
   * this pipeline persists LEADS — companies have no ingestion path yet — so
   * for now the file is refused with a message that names what it actually is.
   * That is a smaller lie than "malformed", and it is the honest state until
   * company ingestion exists.
   */
  /*
   * ⚠️ ROUTE BEFORE PARSING, SO A VALID FILE IS NOT CALLED BROKEN.
   *
   * An Account Hub page fed to the lead parser yields zero leads, which is
   * correctly raised as ERR_FILE_FORMAT — and is nonetheless the wrong answer:
   * the file was fine, we pointed the wrong reader at it.
   */
  if (detectSavedPageType(html) === 'account_list') {
    try {
      const result = parseAccountList(html)
      return { kind: 'account_list' as const, accounts: result.accounts }
    } catch (error) {
      // The parser's own error already names what went wrong with the layout.
      throw new ParseError(
        'ERR_FILE_FORMAT',
        error instanceof AccountListParseError ? error.message : 'account list could not be read',
      )
    }
  }

  return { kind: 'lead_search' as const, ...parseSearchResults(html) }
}

/**
 * Claims and processes one pending job, if any.
 *
 * Returns null when the queue is empty. The caller decides how often to call
 * this: `after()` per upload today, a polling loop later.
 */
export async function claimAndProcessOne(claimedBy: string): Promise<ProcessOutcome | null> {
  const supabase = createAdminClient()

  const { data, error } = await supabase.rpc('claim_next_job', { p_claimed_by: claimedBy })
  if (error) throw new Error(`claim failed: ${concise(error.message)}`)

  const claim = Array.isArray(data) ? data[0] : null
  if (!claim) return null

  return processClaim(claim, claimedBy)
}

/** Atomically claims the exact job that caused this serverless wake-up. */
export async function claimAndProcessJob(
  jobId: string,
  userId: string,
  claimedBy: string,
): Promise<ProcessOutcome | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('claim_job', {
    p_job_id: jobId,
    p_user_id: userId,
    p_claimed_by: claimedBy,
  })
  if (error) throw new Error(`targeted claim failed: ${concise(error.message)}`)

  const claim = Array.isArray(data) ? data[0] : null
  if (!claim) return null
  if (claim.job_id !== jobId || claim.user_id !== userId) {
    throw new Error('targeted claim returned a different job')
  }

  return processClaim(claim, claimedBy)
}

async function processClaim(
  claim: { job_id: string; user_id: string; attempts?: number },
  _claimedBy: string,
): Promise<ProcessOutcome> {
  const supabase = createAdminClient()

  try {
    return await processJob(claim.job_id, claim.user_id)
  } catch (e) {
    const message = concise(e instanceof Error ? e.message : 'processing failed')
    const { data: queue } = await supabase
      .from('job_queue')
      .select('attempts, max_attempts')
      .eq('job_id', claim.job_id)
      .maybeSingle()
    const exhausted = (queue?.attempts ?? claim.attempts ?? 1) >= (queue?.max_attempts ?? 3)

    await supabase
      .from('extraction_jobs')
      .update({
        status: exhausted ? 'failed' : 'queued',
        progress_step: exhausted ? 'Failed' : 'Retrying after a temporary error',
        error_code: exhausted ? 'ERR_FILE_FORMAT' : null,
        error_message: message,
      })
      .eq('id', claim.job_id)
      .eq('user_id', claim.user_id)

    await supabase
      .from('job_queue')
      .update({
        status: exhausted ? 'failed' : 'pending',
        claimed_at: null,
        claimed_by: null,
        last_error: message,
      })
      .eq('job_id', claim.job_id)

    throw e
  }
}
