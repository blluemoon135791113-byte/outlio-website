'use server'

/**
 * The sequence builder's actions — R12.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  SENDING WORKS SINCE R10, AND NOBODY COULD AUTHOR A SEQUENCE.            ║
 * ║                                                                           ║
 * ║  `email_sequence_steps` has existed since M6 with waits, per-step         ║
 * ║  stop-on-reply and a contiguity constraint. The campaign screen READ them ║
 * ║  and there was no way to write one, so every campaign was empty and       ║
 * ║  `assertLaunchable` refused it.                                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { revalidatePath } from 'next/cache'

import { renumberSteps, swapped, writeStepOrder } from '@/lib/email/sequence'
import { validateTemplate } from '@/lib/email/template'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWorkspacePermission } from '@/lib/workspaces/context'

export type SequenceState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | null

/**
 * ⚠️ STRUCTURE IS FROZEN WHILE A CAMPAIGN IS LIVE; WORDING IS NOT.
 *
 * Editing a subject mid-flight changes what the NEXT send says, which is what
 * anyone fixing a typo expects. Inserting, deleting or reordering steps is a
 * different thing entirely: enrolments hold a step index, so renumbering under
 * them makes someone skip a step or receive one twice. Pause first.
 */
const STRUCTURE_EDITABLE = new Set(['draft', 'paused'])

async function loadCampaign(workspaceId: string, campaignId: string) {
  const { data } = await createAdminClient()
    .from('email_campaigns')
    .select('id, status')
    // Scoped by workspace in code — the service role bypasses RLS, so an id
    // from a form is a claim and not authorisation.
    .eq('workspace_id', workspaceId)
    .eq('id', campaignId)
    .maybeSingle()

  return data
}

/** Adds a step, or rewrites one. */
export async function saveStep(
  _previous: SequenceState,
  formData: FormData,
): Promise<SequenceState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('email.template.manage')
  } catch {
    return { ok: false, error: 'You do not have permission to edit sequences.' }
  }

  const campaignId = String(formData.get('campaignId') ?? '')
  const stepId = String(formData.get('stepId') ?? '') || null
  const subject = String(formData.get('subject') ?? '').trim()
  const body = String(formData.get('body') ?? '').trim()
  const waitHours = Math.max(Number(formData.get('waitHours') ?? 0) || 0, 0)

  if (!subject) return { ok: false, error: 'Give the email a subject.' }
  if (!body) return { ok: false, error: 'Write something in the body.' }

  const campaign = await loadCampaign(ctx.workspace.id, campaignId)
  if (!campaign) return { ok: false, error: 'That campaign no longer exists.' }

  /*
   * ⚠️ AN UNKNOWN VARIABLE IS REFUSED, NOT RENDERED LITERALLY. A typo like
   * {{firstname}} would otherwise go out as those exact characters to every
   * recipient — the most visible possible failure, and unrecoverable once sent.
   */
  for (const [field, value] of [
    ['Subject', subject],
    ['Body', body],
  ] as const) {
    const result = validateTemplate(value)
    if (!result.valid) {
      return {
        ok: false,
        error: `${field}: ${result.errors[0] ?? 'that variable is not one Outlio knows.'}`,
      }
    }
  }

  const db = createAdminClient()

  if (stepId) {
    const { error } = await db
      .from('email_sequence_steps')
      .update({ subject, body_text: body, wait_hours: waitHours })
      .eq('workspace_id', ctx.workspace.id)
      .eq('campaign_id', campaignId)
      .eq('id', stepId)

    if (error) return { ok: false, error: 'Could not save that step.' }
    revalidatePath(`/email/campaigns/${campaignId}`)
    return { ok: true, message: 'Step saved.' }
  }

  // Adding a step changes the structure.
  if (!STRUCTURE_EDITABLE.has(campaign.status)) {
    return {
      ok: false,
      error: 'Pause the campaign before adding a step, so nobody mid-sequence skips one.',
    }
  }

  /*
   * ⚠️ THE INDEX IS DERIVED, NOT SUPPLIED. `step_index` is 0-based and
   * contiguous with a unique index on (campaign_id, step_index); a value from
   * the form would collide the moment two people added a step at once.
   */
  const { data: last } = await db
    .from('email_sequence_steps')
    .select('step_index')
    .eq('campaign_id', campaignId)
    .order('step_index', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error } = await db.from('email_sequence_steps').insert({
    workspace_id: ctx.workspace.id,
    campaign_id: campaignId,
    step_index: last ? last.step_index + 1 : 0,
    subject,
    body_text: body,
    wait_hours: waitHours,
  })

  if (error) return { ok: false, error: 'Could not add that step.' }

  revalidatePath(`/email/campaigns/${campaignId}`)
  return { ok: true, message: 'Step added.' }
}

/**
 * Removes a step and closes the gap.
 *
 * ⚠️ THE RENUMBER IS NOT OPTIONAL. `step_index` must stay 0-based and
 * contiguous — the sequence walker reads "the step after N", so a hole would
 * strand every enrolment that reached it.
 */
export async function deleteStep(
  _previous: SequenceState,
  formData: FormData,
): Promise<SequenceState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('email.template.manage')
  } catch {
    return { ok: false, error: 'You do not have permission to edit sequences.' }
  }

  const campaignId = String(formData.get('campaignId') ?? '')
  const stepId = String(formData.get('stepId') ?? '')

  const campaign = await loadCampaign(ctx.workspace.id, campaignId)
  if (!campaign) return { ok: false, error: 'That campaign no longer exists.' }

  if (!STRUCTURE_EDITABLE.has(campaign.status)) {
    return {
      ok: false,
      error: 'Pause the campaign before removing a step.',
    }
  }

  const db = createAdminClient()

  const { error } = await db
    .from('email_sequence_steps')
    .delete()
    .eq('workspace_id', ctx.workspace.id)
    .eq('campaign_id', campaignId)
    .eq('id', stepId)

  if (error) return { ok: false, error: 'Could not remove that step.' }

  await renumberSteps(ctx.workspace.id, campaignId)

  revalidatePath(`/email/campaigns/${campaignId}`)
  return { ok: true, message: 'Step removed.' }
}

/** Moves a step one place earlier or later. */
export async function moveStep(
  _previous: SequenceState,
  formData: FormData,
): Promise<SequenceState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('email.template.manage')
  } catch {
    return { ok: false, error: 'You do not have permission to edit sequences.' }
  }

  const campaignId = String(formData.get('campaignId') ?? '')
  const stepId = String(formData.get('stepId') ?? '')
  const direction = String(formData.get('direction') ?? '')

  const campaign = await loadCampaign(ctx.workspace.id, campaignId)
  if (!campaign) return { ok: false, error: 'That campaign no longer exists.' }

  if (!STRUCTURE_EDITABLE.has(campaign.status)) {
    return { ok: false, error: 'Pause the campaign before reordering steps.' }
  }

  const db = createAdminClient()

  const { data: steps } = await db
    .from('email_sequence_steps')
    .select('id, step_index')
    .eq('workspace_id', ctx.workspace.id)
    .eq('campaign_id', campaignId)
    .order('step_index')

  const ordered = steps ?? []
  const at = ordered.findIndex((s) => s.id === stepId)

  const reordered = swapped(ordered, at, direction === 'up' ? 'up' : 'down')
  if (!reordered) return { ok: false, error: 'That step cannot move any further.' }

  await writeStepOrder(ctx.workspace.id, reordered.map((s) => s.id))

  revalidatePath(`/email/campaigns/${campaignId}`)
  return { ok: true, message: 'Reordered.' }
}
