import 'server-only'

/**
 * Rewrites a job's CSV from the database.
 *
 * ⚠️ THE EXPORT IS A SNAPSHOT, AND ENRICHMENT HAPPENS AFTER IT.
 *
 * The worker writes the CSV the moment extraction finishes, which is before any
 * contact lookup has run. Without this the file's Work Email and Mobile Phone
 * columns would be permanently empty — the columns would exist, the data would
 * exist in the database, and the one artefact the user actually downloads would
 * have neither.
 *
 * Called after enrichment, and safe to call at any other time: it always
 * reflects what the rows currently hold.
 */
import {
  ALWAYS_EXPORTED,
  EXPORT_COLUMN_HEADERS,
  EXPORT_COLUMN_ORDER,
  normalizeExportLead,
  toCanonicalExportRecord,
  type ExportLeadSource,
} from '@/lib/export/leads'
import { toCsv, type CsvColumn } from '@/lib/export/sanitize'
import { createAdminClient } from '@/lib/supabase/admin'

const EXPORT_BUCKET = process.env.SUPABASE_EXPORT_BUCKET ?? 'exports'

const SELECT =
  'id, extraction_job_id, full_name, linkedin_url, job_title, company_name, company_url, company_website_url, sales_navigator_url, location, enrichment, company_industry, company_size, company_headquarters, connection_degree, is_reachable, list_count, last_activity, added_to_list_at, work_email, email_status, mobile_phone, phone_status' as const

/** Rows per read. Large enough to be one round trip for a typical job. */
const PAGE = 1000

type Row = Record<(typeof EXPORT_COLUMN_ORDER)[number], string | null>

/**
 * Every kept lead in a job, in source order, or null when the read failed.
 *
 * ⚠️ NULL, NOT A SHORT LIST. A partial read would silently write a SHORTER file
 * over the good one, which is worse than leaving the original in place.
 */
export async function loadJobLeads(
  jobId: string,
  userId: string,
): Promise<ExportLeadSource[] | null> {
  const supabase = createAdminClient()
  const leads: ExportLeadSource[] = []

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('extracted_leads')
      .select(SELECT)
      // Service role bypasses RLS — scoping by user_id is mandatory.
      .eq('user_id', userId)
      .eq('extraction_job_id', jobId)
      .eq('is_duplicate', false)
      .order('source_row_index', { ascending: true })
      .range(from, from + PAGE - 1)

    if (error) return null

    const rows = (data ?? []) as unknown as ExportLeadSource[]
    leads.push(...rows)
    if (rows.length < PAGE) break
  }

  return leads
}

/**
 * The records and columns of a lead export — shared by the CSV and the workbook,
 * so the two files always carry the same columns in the same order.
 */
export function leadExportShape(leads: readonly ExportLeadSource[]): {
  records: Row[]
  columns: CsvColumn<Row>[]
} {
  const records = leads.map((lead) => toCanonicalExportRecord(normalizeExportLead(lead)) as Row)

  /*
   * Every column in EXPORT_COLUMN_ORDER, plus any enrichment columns a merge
   * added. Built from the union across all rows so the file is rectangular —
   * a lead missing a merged field gets an empty cell, not a short row.
   */
  const merged = new Set<string>()
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!(EXPORT_COLUMN_ORDER as readonly string[]).includes(key)) merged.add(key)
    }
  }

  const columns: CsvColumn<Row>[] = [
    ...EXPORT_COLUMN_ORDER.map((header) => ({
      header,
      value: (row: Row) => row[header] ?? null,
    })),
    ...[...merged].sort().map((header) => ({
      header,
      value: (row: Row) => (row as Record<string, string | null>)[header] ?? null,
    })),
  ]

  return { records, columns }
}

/**
 * Rebuilds and re-uploads the CSV.
 *
 * Returns false rather than throwing: this runs after a successful extraction,
 * and a storage hiccup must not make a completed job look failed. The rows are
 * already correct in the database either way.
 */
export async function rebuildJobExport(jobId: string, userId: string): Promise<boolean> {
  const leads = await loadJobLeads(jobId, userId)
  if (!leads || leads.length === 0) return false

  const { records, columns } = leadExportShape(leads)

  const { error: uploadError } = await createAdminClient().storage
    .from(EXPORT_BUCKET)
    .upload(`${userId}/${jobId}/leads.csv`, new TextEncoder().encode(toCsv(records, columns, { alwaysKeep: ALWAYS_EXPORTED })), {
      // No `; charset=utf-8`: Supabase matches the content type against the
      // bucket's allowed_mime_types as a whole string. The BOM signals encoding.
      contentType: 'text/csv',
      upsert: true,
    })

  return !uploadError
}

/** Re-exported so callers do not need two imports to name a column. */
export { EXPORT_COLUMN_HEADERS }
