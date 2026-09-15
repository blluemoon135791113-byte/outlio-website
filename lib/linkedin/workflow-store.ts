import 'server-only'

/**
 * Reading and saving a campaign's workflow — Phase 20.
 *
 * ⚠️ EVERY QUERY SCOPES BY `workspace_id` IN CODE. The service role bypasses RLS
 * (CLAUDE.md), so the policy on `linkedin_workflow_steps` protects the browser
 * client and nothing here. A campaign id arriving from a form is a claim.
 */
import { compileWorkflow, type WorkflowStep } from '@/lib/linkedin/workflow'
import { isStepAction } from '@/lib/linkedin/steps'
import { createAdminClient } from '@/lib/supabase/admin'

export type SaveWorkflowResult =
  | { ok: true; steps: readonly WorkflowStep[] }
  | { ok: false; problems: readonly { stepId: string | null; message: string }[] }

/** One campaign's steps, in order. Empty when nothing has been built yet. */
export async function getWorkflow(
  workspaceId: string,
  campaignId: string,
): Promise<WorkflowStep[]> {
  const { data, error } = await createAdminClient()
    .from('linkedin_workflow_steps')
    .select('id, position, action, body, wait_days, config')
    .eq('workspace_id', workspaceId)
    .eq('campaign_id', campaignId)
    .order('position', { ascending: true })
    /*
     * ⚠️ `id` BREAKS THE TIE. The builder renumbers on save, but a reorder that
     * momentarily duplicates a position would otherwise return rows in an order
     * Postgres does not promise — and this list decides what happens next to
     * real people.
     */
    .order('id', { ascending: true })

  if (error) throw new Error(`getWorkflow failed: ${error.message}`)

  return (data ?? [])
    /*
     * ⚠️ A ROW WITH AN ACTION THIS BUILD DOES NOT KNOW IS DROPPED, NOT COERCED.
     * It can only happen if the database enum is ahead of the deployed code —
     * a migration applied before a deploy, which is this project's normal order.
     * Rendering it as some default action would show the operator a step their
     * campaign does not contain.
     */
    .filter((row) => isStepAction(row.action))
    .map((row) => ({
      id: row.id,
      position: row.position,
      action: row.action,
      body: row.body,
      waitDays: row.wait_days,
      /*
       * ⚠️ COERCED TO AN OBJECT. `jsonb` can legally hold a string, a number or
       * `null`, and 0132's default is `'{}'` only for rows written after it —
       * every step created by 0130 has whatever the column defaulted to. A
       * caller doing `config.tag` on a non-object gets `undefined` at best and
       * throws at worst.
       */
      config:
        row.config && typeof row.config === 'object' && !Array.isArray(row.config)
          ? (row.config as Record<string, unknown>)
          : {},
    }))
}

export type DraftStep = {
  /** Present when editing an existing row; absent for a newly added card. */
  id?: string
  action: string
  body: string | null
  waitDays: number | null
  /** Per-action settings (0132). `{}` for every action but `ADD_TAG`. */
  config: Record<string, unknown>
}

/**
 * Replaces a campaign's workflow with the one just built.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ IT IS NOT DELETE-ALL-THEN-INSERT, AND THAT IS THE WHOLE DIFFICULTY.   ║
 * ║                                                                           ║
 * ║  Deleting every row and re-inserting would be four lines and would         ║
 * ║  destroy the product: `linkedin_enrollments.current_step_id` points at     ║
 * ║  these ids. New ids mean every person standing in the campaign is either   ║
 * ║  orphaned or silently moved. 0130's `on delete restrict` would refuse the  ║
 * ║  delete outright for anyone live, so the save would simply fail — but for  ║
 * ║  a campaign whose people had all finished, it would succeed and quietly    ║
 * ║  detach the history.                                                       ║
 * ║                                                                           ║
 * ║  So: rows the customer kept are UPDATED in place and keep their ids, new   ║
 * ║  cards are inserted, and removed cards are deleted last — where the        ║
 * ║  database can still refuse if somebody is standing on one.                ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export async function saveWorkflow(input: {
  workspaceId: string
  campaignId: string
  steps: readonly DraftStep[]
}): Promise<SaveWorkflowResult> {
  const db = createAdminClient()

  /*
   * ⚠️ VALIDATED BEFORE ANYTHING IS WRITTEN, against a synthetic id for new
   * cards so a problem can still be attributed to the card that caused it.
   */
  const draft: WorkflowStep[] = input.steps.map((step, index) => ({
    id: step.id ?? `new:${index}`,
    position: index,
    action: step.action as WorkflowStep['action'],
    body: step.body,
    waitDays: step.waitDays,
    config: step.config,
  }))

  const compiled = compileWorkflow(draft)
  if (!compiled.ok) return { ok: false, problems: compiled.problems }

  const existing = await getWorkflow(input.workspaceId, input.campaignId)
  const kept = new Set(
    input.steps.map((step) => step.id).filter((id): id is string => Boolean(id)),
  )

  /*
   * ⚠️ AN ID THE CUSTOMER SENT THAT IS NOT IN THIS CAMPAIGN IS A REFUSAL, NOT A
   * SKIP. The form is a public HTTP endpoint; accepting a foreign step id would
   * let one workspace's save reach into another's workflow. `existing` is the
   * authoritative list, already workspace- and campaign-scoped.
   */
  const known = new Set(existing.map((step) => step.id))
  for (const id of kept) {
    if (!known.has(id)) {
      return {
        ok: false,
        problems: [{ stepId: null, message: 'That workflow changed while you were editing it. Reload and try again.' }],
      }
    }
  }

  // ---- update the ones that survived, in place ----------------------------
  for (const [index, step] of input.steps.entries()) {
    if (!step.id) continue
    const { error } = await db
      .from('linkedin_workflow_steps')
      .update({
        position: index,
        action: step.action as WorkflowStep['action'],
        body: step.body,
        wait_days: step.waitDays,
        config: step.config as never,
      })
      .eq('workspace_id', input.workspaceId)
      .eq('campaign_id', input.campaignId)
      .eq('id', step.id)

    if (error) {
      return { ok: false, problems: [{ stepId: step.id, message: 'That step could not be saved.' }] }
    }
  }

  // ---- insert the new cards ----------------------------------------------
  const additions = input.steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => !step.id)

  if (additions.length > 0) {
    const { error } = await db.from('linkedin_workflow_steps').insert(
      additions.map(({ step, index }) => ({
        workspace_id: input.workspaceId,
        campaign_id: input.campaignId,
        position: index,
        action: step.action as WorkflowStep['action'],
        body: step.body,
        wait_days: step.waitDays,
        config: step.config as never,
      })),
    )

    if (error) {
      return { ok: false, problems: [{ stepId: null, message: 'Those steps could not be saved.' }] }
    }
  }

  // ---- remove what the customer took out, last ----------------------------
  const removed = existing.filter((step) => !kept.has(step.id))
  for (const step of removed) {
    const { error } = await db
      .from('linkedin_workflow_steps')
      .delete()
      .eq('workspace_id', input.workspaceId)
      .eq('campaign_id', input.campaignId)
      .eq('id', step.id)

    if (error) {
      /*
       * ⚠️ THIS IS THE `on delete restrict` FIRING, AND IT IS A FEATURE. 23503
       * is a foreign-key violation: somebody's `current_step_id` names this row.
       * The message says what to do about it rather than reporting a database
       * error, because the customer is looking at a card they just tried to
       * delete and the answer is about people, not constraints.
       */
      const inUse = error.code === '23503'
      return {
        ok: false,
        problems: [
          {
            stepId: step.id,
            message: inUse
              ? 'Someone is waiting on this step right now. Move them on, or end their enrolment, before deleting it.'
              : 'That step could not be removed.',
          },
        ],
      }
    }
  }

  return { ok: true, steps: await getWorkflow(input.workspaceId, input.campaignId) }
}

/**
 * How many live enrollments are standing on each step.
 *
 * ⚠️ USED TO WARN BEFORE THE DELETE, not instead of the constraint. This is a
 * read, so it is stale the moment it returns; `on delete restrict` is what
 * actually prevents the orphan. Showing it lets the customer see the cost of an
 * edit while they are making it rather than when they press save.
 */
export async function enrollmentsPerStep(
  workspaceId: string,
  campaignId: string,
): Promise<Map<string, number>> {
  const { data, error } = await createAdminClient()
    .from('linkedin_enrollments')
    .select('current_step_id')
    .eq('workspace_id', workspaceId)
    .eq('campaign_id', campaignId)
    .not('current_step_id', 'is', null)

  if (error) throw new Error(`enrollmentsPerStep failed: ${error.message}`)

  const counts = new Map<string, number>()
  for (const row of data ?? []) {
    if (!row.current_step_id) continue
    counts.set(row.current_step_id, (counts.get(row.current_step_id) ?? 0) + 1)
  }
  return counts
}
