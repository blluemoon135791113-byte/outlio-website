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

/** Older than this, a run is treated as stuck rather than still enriching. */
export const STALE_MS = 30 * 60_000

export type EnrichmentRunRow = { job_id: string | null; created_at: string }

/** PURE. The job ids with a live (non-stale) enrichment run. */
export function enrichingJobIds(rows: readonly EnrichmentRunRow[], now = Date.now()): Set<string> {
  const ids = new Set<string>()
  for (const row of rows) {
    if (!row.job_id) continue
    if (now - Date.parse(row.created_at) > STALE_MS) continue
    ids.add(row.job_id)
  }
  return ids
}

/**
 * Reads the live enrichment runs for `userId` and returns their job ids.
 * Callers on the service role rely on the `user_id` filter; under RLS the
 * policy scopes it anyway.
 */
export async function loadEnrichingJobIds(
  client: SupabaseClient<Database>,
  userId: string,
  now = Date.now(),
): Promise<Set<string>> {
  const { data, error } = await client
    .from('research_runs')
    .select('job_id:scope->autoEnrich->>jobId, created_at')
    .eq('user_id', userId)
    .in('status', [...ENRICHING_STATUSES])
    .gte('created_at', new Date(now - STALE_MS).toISOString())
    .not('scope->autoEnrich', 'is', null)
  // Unknown state: offer the export rather than lock the customer out.
  if (error || !data) return new Set()
  return enrichingJobIds(data as unknown as EnrichmentRunRow[], now)
}
