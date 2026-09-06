import 'server-only'

/**
 * Persisting a merge.
 *
 * The shaping lives in `lib/intelligence/merge.ts` and is pure; this file is
 * only the write, so the interesting logic stays testable without a database.
 */
import { buildMergePlan, type MergePlan } from '@/lib/intelligence/merge'
import { getRunResults } from '@/lib/intelligence/results'
import type { ResearchField } from '@/lib/intelligence/types'
import { createAdminClient } from '@/lib/supabase/admin'

/** Leads per RPC call. Keeps the JSONB argument to a sane size. */
const MERGE_BATCH = 500

export type MergeOutcome =
  | {
      ok: true
      leadsUpdated: number
      mergedCells: number
      unknownCells: number
      fields: ResearchField[]
    }
  | { ok: false; reason: string }

/**
 * Merges a finished run's results onto the leads it covered.
 *
 * ⚠️ `getRunResults` returns `null` for a run belonging to someone else — the
 * same answer as "does not exist" — so ownership is settled before a single row
 * is touched. `merge_lead_enrichment` then re-scopes by `user_id` in SQL,
 * because the service role bypasses RLS and one check in TypeScript is not a
 * boundary.
 */
export async function mergeRunIntoLeads(
  userId: string,
  runId: string,
  options: { fields?: readonly ResearchField[]; leadIds?: readonly string[] } = {},
): Promise<MergeOutcome> {
  const results = await getRunResults(userId, runId)
  if (!results) return { ok: false, reason: 'That research run could not be found.' }

  if (results.status !== 'completed' && results.status !== 'partially_complete') {
    return { ok: false, reason: 'This run has not finished yet.' }
  }

  const plan: MergePlan = buildMergePlan(results, options)

  if (plan.leadIds.length === 0) {
    return {
      ok: false,
      reason:
        plan.unknownCells > 0
          ? 'Nothing to merge — every value in this run came back unknown.'
          : 'Nothing to merge from this run.',
    }
  }

  const supabase = createAdminClient()
  let leadsUpdated = 0

  for (let index = 0; index < plan.leadIds.length; index += MERGE_BATCH) {
    const batch = plan.leadIds.slice(index, index + MERGE_BATCH)

    // Only this batch's patches travel with the call.
    const payload: Record<string, unknown> = {}
    for (const leadId of batch) payload[leadId] = plan.byLead[leadId]

    const { data, error } = await supabase.rpc('merge_lead_enrichment', {
      p_user_id: userId,
      p_lead_ids: batch,
      p_enrichment: payload as never,
    })

    if (error) return { ok: false, reason: 'The merge could not be completed.' }

    leadsUpdated += typeof data === 'number' ? data : 0
  }

  return {
    ok: true,
    leadsUpdated,
    mergedCells: plan.mergedCells,
    unknownCells: plan.unknownCells,
    fields: plan.fields,
  }
}
