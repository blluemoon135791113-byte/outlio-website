/**
 * Which uploads are still being enriched.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ "COMPLETED" MEANT PARSED, NOT FINISHED.                              ║
 * ║                                                                          ║
 * ║  `extraction_jobs.status` turns `completed` the moment the page is      ║
 * ║  parsed. Automatic enrichment then runs as research runs in batches of  ║
 * ║  ten, for minutes — and the dashboard offered the export the whole      ║
 * ║  time, so a customer downloaded a CSV with no contacts in it (job       ║
 * ║  a6c2e8a3, 2026-10-29). An upload is finished only when no enrichment   ║
 * ║  run for it is still pending, planning or running.                      ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * A run older than STALE_MS no longer holds the export: a stuck run is reaped
 * eventually, and must not lock a customer out of their own leads meanwhile.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

/** Research-run statuses that mean "more contacts are still coming". */
export const ENRICHING_STATUSES = ['pending', 'planning', 'running'] as const

/** Not touched for this long, a run is treated as stuck rather than still enriching. */
export const STALE_MS = 30 * 60_000

/**
 * ⚠️ THE HANDOFF BETWEEN BATCHES. A chain creates the next batch only AFTER
 * the current one is marked finished, merged and its CSV rebuilt — seconds in
 * which no run is live. A run that finished this recently and still names
 * batches after it holds the upload, so it never flashes "Completed".
 */
export const HANDOFF_MS = 2 * 60_000

export type EnrichmentRunRow = {
  job_id: string | null
  status: string
  /** `scope.autoEnrich.next`: the batches still to come after this one. */
  next: unknown
  updated_at: string
}

/** PURE. The job ids whose enrichment has not finished. */
export function enrichingJobIds(rows: readonly EnrichmentRunRow[], now = Date.now()): Set<string> {
  const ids = new Set<string>()
  for (const row of rows) {
    if (!row.job_id) continue
    const age = now - Date.parse(row.updated_at)
    const live = (ENRICHING_STATUSES as readonly string[]).includes(row.status) && age <= STALE_MS
    const handingOff = Array.isArray(row.next) && row.next.length > 0 && age <= HANDOFF_MS
    if (live || handingOff) ids.add(row.job_id)
  }
  return ids
}

async function readRuns(client: SupabaseClient<Database>, userId: string, now: number) {
  try {
    const { data, error } = await client
      .from('research_runs')
      .select('job_id:scope->autoEnrich->>jobId, next:scope->autoEnrich->next, status, updated_at')
      .eq('user_id', userId)
      .gte('updated_at', new Date(now - STALE_MS).toISOString())
      .not('scope->autoEnrich', 'is', null)
    return error || !data ? null : (data as unknown as EnrichmentRunRow[])
  } catch {
    // Unknown is not "still enriching": never lock a customer out on a read failure.
    return null
  }
}

/**
 * Reads the user's recent enrichment runs and returns the uploads still being
 * enriched. Callers on the service role rely on the `user_id` filter; under
 * RLS the policy scopes it anyway. Unknown state offers the export rather
 * than lock the customer out.
 */
export async function loadEnrichingJobIds(
  client: SupabaseClient<Database>,
  userId: string,
  now = Date.now(),
): Promise<Set<string>> {
  const rows = await readRuns(client, userId, now)
  return rows ? enrichingJobIds(rows, now) : new Set()
}

/** What a server action says when the upload is still being enriched. */
export const STILL_ENRICHING_MESSAGE =
  'Contacts are still being found for this upload. It will be ready to export in a few minutes.'

/**
 * Server-side: is this upload — or any upload these leads came from — still
 * being enriched? Every export and CRM action asks this; hiding the buttons
 * is not access control (CLAUDE.md rule 8).
 */
export async function isStillEnriching(
  admin: SupabaseClient<Database>,
  userId: string,
  target: { jobId: string } | { leadIds: readonly string[] },
): Promise<boolean> {
  const enriching = await loadEnrichingJobIds(admin, userId)
  if (enriching.size === 0) return false
  if ('jobId' in target) return enriching.has(target.jobId)
  for (let i = 0; i < target.leadIds.length; i += 200) {
    const { data } = await admin
      .from('extracted_leads')
      .select('extraction_job_id')
      // Service role bypasses RLS — scoping by user_id is mandatory.
      .eq('user_id', userId)
      .in('id', target.leadIds.slice(i, i + 200))
    if ((data ?? []).some((row) => row.extraction_job_id && enriching.has(row.extraction_job_id))) return true
  }
  return false
}
