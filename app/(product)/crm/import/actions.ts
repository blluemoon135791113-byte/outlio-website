'use server'

/**
 * Getting contacts into the CRM — R1.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  FOUR ENGINES, NONE OF THEM REACHABLE UNTIL NOW.                         ║
 * ║                                                                           ║
 * ║  `ingestExtractionJob`, `runCsvImport`, `buildImportPlan` and `undoBatch` ║
 * ║  were all built and tested in M2 and none had a caller. The consequence:  ║
 * ║  the only way into the CRM was the browser extension, and a customer      ║
 * ║  arriving with an existing contact list had no way in at all.             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { createHash } from 'node:crypto'

import { revalidatePath } from 'next/cache'

import {
  buildImportPlan,
  parseCsv,
  suggestMapping,
  summarizePlan,
  type ImportMapping,
} from '@/lib/crm/csv-import'
import { ingestExtractionJob, runCsvImport, undoBatch } from '@/lib/crm/ingest'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWorkspacePermission } from '@/lib/workspaces/context'

export type ImportPreview = {
  headers: string[]
  mapping: ImportMapping
  rowsTotal: number
  rowsValid: number
  rowsFailed: number
  errorsTruncated: boolean
  /** A few real rows, so someone can see the mapping is right before committing. */
  sample: { field: string; value: string }[][]
  errors: { row: number; reason: string }[]
}

export type ImportState =
  | { step: 'preview'; preview: ImportPreview }
  | { step: 'done'; batchId: string; created: number; matched: number; skipped: number }
  | { step: 'error'; error: string }
  | null

/**
 * ⚠️ A HARD CEILING ON WHAT IS PARSED IN A REQUEST. A 200MB CSV would exhaust
 * the function's memory and take the whole route down rather than failing this
 * one import. Bigger files belong in the job queue, which is recorded as
 * deferred rather than pretended.
 */
const MAX_CSV_BYTES = 8 * 1024 * 1024

async function readCsv(formData: FormData): Promise<{ text: string } | { error: string }> {
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose a CSV file.' }
  }
  if (file.size > MAX_CSV_BYTES) {
    return { error: 'That file is larger than 8MB. Split it and import in parts.' }
  }

  const text = await file.text()

  /*
   * ⚠️ CONTENT, NOT EXTENSION. Anything can be renamed .csv, and a binary read
   * as text produces nonsense rows rather than an honest failure. A NUL byte in
   * the first chunk is the cheap, reliable tell.
   */
  if (text.slice(0, 4096).includes('\u0000')) {
    return { error: 'That file is not text. Export it as CSV and try again.' }
  }

  return { text }
}

/** Step one: parse, guess the mapping, and show what WOULD happen. */
export async function previewImport(
  _previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  try {
    await assertWorkspacePermission('crm.import')
  } catch {
    return { step: 'error', error: 'You do not have permission to import contacts.' }
  }

  const read = await readCsv(formData)
  if ('error' in read) return { step: 'error', error: read.error }

  const parsed = parseCsv(read.text)
  if (parsed.rows.length === 0) {
    return { step: 'error', error: 'That file has no rows under its header.' }
  }

  /*
   * The mapping can be overridden by the form once the headers are known; the
   * first pass uses the suggestion so the common case is one click.
   */
  const override = formData.get('mapping')
  const mapping: ImportMapping =
    typeof override === 'string' && override
      ? (JSON.parse(override) as ImportMapping)
      : suggestMapping(parsed.headers)

  const plan = buildImportPlan(parsed, mapping)
  const summary = summarizePlan(plan)

  return {
    step: 'preview',
    preview: {
      headers: parsed.headers,
      mapping,
      ...summary,
      // Five rows is enough to spot a column mapped to the wrong field, and
      // small enough not to ship a customer's list through the RSC payload.
      sample: plan.rows.slice(0, 5).map((row) =>
        /*
         * Read off the PARSED contact, not the raw cells — that is the point of
         * a preview. If a column is mapped to the wrong field, this is where it
         * shows, because it shows what will actually be stored.
         */
        [
          { field: 'Name', value: row.contact.fullName ?? '' },
          { field: 'Email', value: row.contact.emails?.[0] ?? '' },
          { field: 'Job title', value: row.contact.jobTitle ?? '' },
          { field: 'Company', value: row.company?.name ?? '' },
        ].filter((cell) => cell.value !== ''),
      ),
      errors: plan.errors.slice(0, 10).map((e) => ({ row: e.line, reason: e.reason })),
    },
  }
}

/** Step two: commit, with the mapping the person confirmed. */
export async function commitImport(
  _previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.import')
  } catch {
    return { step: 'error', error: 'You do not have permission to import contacts.' }
  }

  const read = await readCsv(formData)
  if ('error' in read) return { step: 'error', error: read.error }

  const parsed = parseCsv(read.text)
  const raw = formData.get('mapping')
  const mapping: ImportMapping =
    typeof raw === 'string' && raw
      ? (JSON.parse(raw) as ImportMapping)
      : suggestMapping(parsed.headers)

  const plan = buildImportPlan(parsed, mapping)
  if (plan.rows.length === 0) {
    return { step: 'error', error: 'No row in that file could be imported.' }
  }

  const filename = String(formData.get('filename') ?? 'import.csv')
  const db = createAdminClient()

  const { data: job, error } = await db
    .from('crm_import_jobs')
    .insert({
      workspace_id: ctx.workspace.id,
      filename,
      /*
       * ⚠️ THE HASH IS OF THE FILE, NOT THE NAME. It is what makes "you have
       * already imported this" answerable when someone re-uploads the same
       * export under a different filename — the common way a list gets
       * imported twice.
       */
      content_hash: createHash('sha256').update(read.text).digest('hex'),
      mapping: mapping as never,
      created_by: ctx.userId,
    })
    .select('id')
    .single()

  if (error || !job) return { step: 'error', error: 'Could not start that import.' }

  try {
    const result = await runCsvImport(ctx.workspace.id, job.id, plan, {
      actorUserId: ctx.userId,
      name: filename,
    })

    revalidatePath('/crm/contacts')
    revalidatePath('/dashboard')

    return {
      step: 'done',
      batchId: result.batchId,
      created: result.contactsCreated,
      // ⚠️ "Matched", not "duplicate". These are people the CRM already knew,
      // and the import associated them with this batch rather than making a
      // second copy — which is the canonical-contact rule doing its job.
      matched: result.contactsMatched,
      skipped: result.rowsSkipped,
    }
  } catch {
    return { step: 'error', error: 'That import did not finish. Nothing was changed.' }
  }
}

/**
 * Rolls an import back.
 *
 * ⚠️ ONLY REMOVES WHAT THIS BATCH CREATED. A contact the CRM already had, that
 * this import merely associated, must survive — undoing an import must never
 * delete a person who existed before it.
 */
export async function undoImport(
  _previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  try {
    const ctx = await assertWorkspacePermission('crm.import')
    const batchId = String(formData.get('batchId') ?? '')

    const result = await undoBatch(ctx.workspace.id, batchId)

    revalidatePath('/crm/contacts')
    return {
      step: 'error',
      error: `Undone. ${result.contactsDeleted} contact${
        result.contactsDeleted === 1 ? '' : 's'
      } removed; anyone who already existed was kept.`,
    }
  } catch {
    return { step: 'error', error: 'Could not undo that import.' }
  }
}

// ---------------------------------------------------------------------------
// Lead Engine → CRM
// ---------------------------------------------------------------------------

export type SendToCrmState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | null

/**
 * Moves an extraction's leads into the CRM.
 *
 * ⚠️ EXPLICIT, NOT AUTOMATIC. The brief is firm that thousands of contacts must
 * not appear in someone's CRM without them asking. The extraction stays in the
 * Lead Engine until a person decides to bring it across.
 */
export async function sendExtractionToCrm(
  _previous: SendToCrmState,
  formData: FormData,
): Promise<SendToCrmState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.import')
  } catch {
    return { ok: false, error: 'You do not have permission to add contacts to the CRM.' }
  }

  const jobId = String(formData.get('jobId') ?? '')
  if (!jobId) return { ok: false, error: 'No extraction selected.' }

  try {
    const result = await ingestExtractionJob(ctx.workspace.id, jobId, {
      // Unassigned by default: bulk-assigning a whole batch to whoever clicked
      // the button is rarely what anyone wants, and reassigning later rewrites
      // attribution.
      ownerUserId: null,
      actorUserId: ctx.userId,
    })

    revalidatePath('/crm/contacts')
    revalidatePath('/dashboard/jobs')

    const parts = [`${result.contactsCreated} added`]
    if (result.contactsMatched > 0) {
      // Named precisely: these were NOT duplicated, they were recognised.
      parts.push(`${result.contactsMatched} already in your CRM`)
    }
    if (result.rowsSkipped > 0) parts.push(`${result.rowsSkipped} skipped`)

    return { ok: true, message: `${parts.join(', ')}.` }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('no such extraction job')) {
      return { ok: false, error: 'That extraction no longer exists.' }
    }
    // The engine refuses cross-tenant ingestion; say so without confirming
    // whether the job exists elsewhere.
    return { ok: false, error: 'Those leads could not be added to this CRM.' }
  }
}
