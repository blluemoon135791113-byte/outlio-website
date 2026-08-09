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

import { toCsv, type CsvColumn } from '@/lib/export/sanitize'
import { dedupeLeads, type DedupeMode, type KeyedLead } from '@/lib/leads/dedupe'
import { ParseError, parseSearchResults } from '@/lib/leads/parse'
import { createAdminClient } from '@/lib/supabase/admin'
import { SNIFF_BYTES, sniffHtml } from '@/lib/upload/sniff'
import { STORAGE_BUCKET } from '@/lib/upload/process'
import {
  mapInConcurrentBatches,
  resolveFileConcurrency,
} from '@/lib/worker/concurrency'

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

/** CSV column order. `sanitizeCell` is applied by `toCsv` to every cell. */
const CSV_COLUMNS: CsvColumn<KeyedLead>[] = [
  { header: 'Name', value: (l) => l.fullName },
  { header: 'LinkedIn Profile', value: (l) => l.linkedinUrl },
  { header: 'Job Title', value: (l) => l.jobTitle },
  { header: 'Company', value: (l) => l.companyName },
  { header: 'Company URL', value: (l) => l.companyUrl },
  { header: 'Location', value: (l) => l.location },
  { header: 'Summary', value: (l) => l.personBlurb },
  { header: 'Time in Role', value: (l) => l.tenureInRole },
  { header: 'Time at Company', value: (l) => l.tenureInCompany },
  { header: 'Sales Navigator URL', value: (l) => l.salesNavUrl },
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
    .select('id, user_id, dedupe_mode')
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

  const allLeads: Array<Awaited<ReturnType<typeof parseOne>>['leads'][number]> = []
  let filesProcessed = 0
  let filesFailed = 0
  const fileConcurrency = resolveFileConcurrency(process.env.WORKER_FILE_CONCURRENCY)

  type FileResult =
    | { ok: true; fileId: string; leads: Awaited<ReturnType<typeof parseOne>>['leads'] }
    | { ok: false; fileId: string }

  await mapInConcurrentBatches(
    fileList,
    fileConcurrency,
    async (file): Promise<FileResult> => {
      try {
        const { leads } = await parseOne(file.storage_path, file.id, userId, jobId)

        await supabase
          .from('uploaded_files')
          .update({
            status: 'processed',
            leads_found: leads.length,
            processed_at: new Date().toISOString(),
          })
          .eq('id', file.id)
          .eq('extraction_job_id', jobId)
          .eq('user_id', userId)

        return { ok: true, fileId: file.id, leads }
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
      job_title: l.jobTitle,
      company_name: l.companyName,
      company_url: l.companyUrl,
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

  // ---- export ------------------------------------------------------------
  await supabase
    .from('extraction_jobs')
    .update({ progress_step: 'Generating export' })
    .eq('id', jobId)

  const csv = toCsv(kept, CSV_COLUMNS)
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
  return parseSearchResults(html)
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
