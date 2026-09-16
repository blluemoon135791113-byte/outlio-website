import 'server-only'

/**
 * LinkedIn campaigns — Phase 18.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ A CAMPAIGN GROUPS ENROLLMENTS. IT DOES NOT OWN THEIR STATE.           ║
 * ║                                                                           ║
 * ║  0135 stores no counters deliberately: a cached total can disagree with    ║
 * ║  the rows an operator actually changed, and the rows are the only thing    ║
 * ║  that moved. Progress is derived on read by `campaignProgress`, which      ║
 * ║  keeps the unconfirmed bucket separate rather than folding it into a       ║
 * ║  reassuring number.                                                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ EVERY QUERY SCOPES BY `workspace_id` IN CODE. The service role bypasses
 * RLS (CLAUDE.md), so the policy on the table protects the client and nothing
 * here. An id arriving from a form is a claim, not a permission.
 */
import { campaignProgress, type CampaignProgress } from '@/lib/linkedin/campaign-progress'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'

export type CampaignState = Database['public']['Enums']['linkedin_campaign_state']

export type CampaignSummary = {
  id: string
  name: string
  state: CampaignState
  createdAt: string
  progress: CampaignProgress
}

/**
 * One campaign with its progress, or null when it is not this workspace's.
 *
 * ⚠️ TWO QUERIES AND ONE PAIRING, NOT A JOIN. `campaignProgress` takes tasks
 * grouped per enrollment and asserts the two line up, because a positional
 * mismatch would attribute one person's unconfirmed action to another's
 * enrollment — a wrong answer about a named individual. Grouping here keeps
 * that pairing explicit instead of trusting a join's row order.
 */
export async function getCampaign(
  workspaceId: string,
  campaignId: string,
): Promise<CampaignSummary | null> {
  const db = createAdminClient()

  const { data: campaign, error } = await db
    .from('linkedin_campaigns')
    .select('id, name, state, created_at')
    .eq('workspace_id', workspaceId)
    .eq('id', campaignId)
    .maybeSingle()

  if (error || !campaign) return null

  const { data: enrollments, error: enrollmentError } = await db
    .from('linkedin_enrollments')
    .select('id, state, terminal_reason')
    .eq('workspace_id', workspaceId)
    .eq('campaign_id', campaignId)
    /*
     * ⚠️ ORDERED BY `id`, NOT `created_at`. Batch enrolment inserts share
     * `now()`, so `created_at` ties and the order inside a tie group is
     * undefined — which would shuffle the task pairing below between reads.
     */
    .order('id', { ascending: true })

  if (enrollmentError) return null

  const rows = enrollments ?? []

  /*
   * ⚠️ NO `.in()` OVER AN UNBOUNDED LIST. PostgREST puts it in the URL, and a
   * campaign with thousands of enrollments would exceed it — measured
   * elsewhere in this codebase at 500 ok / 1000 rejected / 2000 dropped.
   * Querying by campaign avoids the list entirely.
   */
  const { data: tasks, error: taskError } = await db
    .from('linkedin_tasks')
    .select('enrollment_id, outcome')
    .eq('workspace_id', workspaceId)
    .in('enrollment_id', rows.length > 0 ? rows.map((r) => r.id) : ['00000000-0000-0000-0000-000000000000'])

  if (taskError) return null

  const byEnrollment = new Map<string, { outcome: Database['public']['Enums']['linkedin_task_outcome'] | null }[]>()
  for (const row of rows) byEnrollment.set(row.id, [])
  for (const task of tasks ?? []) {
    byEnrollment.get(task.enrollment_id)?.push({ outcome: task.outcome })
  }

  return {
    id: campaign.id,
    name: campaign.name,
    state: campaign.state,
    createdAt: campaign.created_at,
    progress: campaignProgress(
      rows.map((r) => ({ state: r.state, terminalReason: r.terminal_reason })),
      rows.map((r) => byEnrollment.get(r.id) ?? []),
    ),
  }
}

/**
 * Campaigns in a workspace, newest first.
 *
 * ⚠️ NO PROGRESS HERE. Deriving it per campaign would be two queries each, and
 * a list that silently costs 2N round trips is how a page becomes slow without
 * anyone choosing it. The list says what exists; opening one says how it is
 * going.
 */
export async function listCampaigns(
  workspaceId: string,
): Promise<{ id: string; name: string; state: CampaignState; createdAt: string }[]> {
  const { data, error } = await createAdminClient()
    .from('linkedin_campaigns')
    .select('id, name, state, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    // Batch inserts tie on `created_at`; `id` makes the order total.
    .order('id', { ascending: true })

  if (error) return []

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    state: row.state,
    createdAt: row.created_at,
  }))
}
