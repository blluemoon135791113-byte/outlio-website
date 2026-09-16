'use server'

/**
 * The Action Inbox's two verbs — §4.13.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ NEITHER OF THESE TOUCHES LINKEDIN. `release` decides whether a card    ║
 * ║  may be shown as actionable; `record` writes down what a human says they   ║
 * ║  did afterwards. CLAUDE.md rule 1 is not a thing this file works around —  ║
 * ║  it is the reason the file is shaped this way.                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ GATED ON `crm.contact.edit` AND THE MODULE. Performing outreach from your
 * own LinkedIn account is ordinary setter work, not an administrative act — the
 * same reasoning as linking a sender. Requiring a manager would mean the queue
 * stops when nobody senior is free.
 */
import { revalidatePath } from 'next/cache'

import { recordOutcome, releaseTask } from '@/lib/linkedin/tasks'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWorkspacePermission } from '@/lib/workspaces/context'

export type InboxActionState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | null

const PERMISSION = 'crm.contact.edit' as const
const PATH = '/linkedin'

async function gate() {
  const ctx = await assertWorkspacePermission(PERMISSION)
  if (!ctx.modules.has('linkedin')) {
    throw new Error('module')
  }
  return ctx
}

export async function releaseTaskAction(
  _previous: InboxActionState,
  formData: FormData,
): Promise<InboxActionState> {
  let ctx
  try {
    ctx = await gate()
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.message === 'module'
          ? 'The LinkedIn channel is not enabled on your plan.'
          : 'You do not have access to this workspace.',
    }
  }

  const taskId = String(formData.get('taskId') ?? '')
  if (!taskId) return { ok: false, error: 'Could not tell which task you meant.' }

  const result = await releaseTask({ workspaceId: ctx.workspace.id, taskId })

  /*
   * ⚠️ THE REFUSAL REASON IS SHOWN, NOT SWALLOWED. `refusalMessage` explains
   * which of §4.13's five gates held the task — a stale approval reads very
   * differently from a restricted account, and an operator who is told
   * "unavailable" will just try again.
   */
  if (!result.released) return { ok: false, error: result.message }

  revalidatePath(PATH)
  return { ok: true, message: 'Ready. Do it in LinkedIn, then record what happened.' }
}

export async function recordOutcomeAction(
  _previous: InboxActionState,
  formData: FormData,
): Promise<InboxActionState> {
  let ctx
  try {
    ctx = await gate()
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.message === 'module'
          ? 'The LinkedIn channel is not enabled on your plan.'
          : 'You do not have access to this workspace.',
    }
  }

  const taskId = String(formData.get('taskId') ?? '')
  const outcome = String(formData.get('outcome') ?? '')
  const reason = String(formData.get('reason') ?? '').trim() || null

  if (!taskId) return { ok: false, error: 'Could not tell which task you meant.' }
  if (reason && reason.length > 500) return { ok: false, error: 'That note is too long.' }

  const result = await recordOutcome({
    workspaceId: ctx.workspace.id,
    taskId,
    outcome,
    reason,
    actorUserId: ctx.userId,
  })

  if (!result.ok) return { ok: false, error: result.error }

  revalidatePath(PATH)
  return { ok: true, message: 'Recorded.' }
}

/* -------------------------------------------------------------------------- */

export type CampaignActionState =
  | { ok: true; message: string; campaignId: string }
  | { ok: false; error: string }
  | null

/**
 * Creates a campaign. It starts DRAFT and enrols nobody.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ CREATING A CAMPAIGN MUST NOT START ANYTHING.                          ║
 * ║                                                                           ║
 * ║  Same rule the flow templates obey: "someone picking 'Handle a reply' to  ║
 * ║  see what it looks like has not agreed to automate their inbox". A        ║
 * ║  LinkedIn campaign is stronger still — its steps are actions a PERSON     ║
 * ║  performs against named individuals, so a campaign that began enrolling   ║
 * ║  on creation would put real people in a queue because somebody typed a    ║
 * ║  name and pressed a button.                                              ║
 * ║                                                                           ║
 * ║  DRAFT with no enrollments is the only safe starting state, and 0135's    ║
 * ║  column default says so independently of this code.                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export async function createCampaignAction(
  _previous: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  let ctx
  try {
    ctx = await gate()
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.message === 'module'
          ? 'LinkedIn is not included in your plan.'
          : 'You do not have permission to manage LinkedIn campaigns.',
    }
  }

  const name = String(formData.get('name') ?? '').trim()
  if (name.length === 0) return { ok: false, error: 'Give the campaign a name.' }
  if (name.length > 200) return { ok: false, error: 'That name is too long.' }

  const { data, error } = await createAdminClient()
    .from('linkedin_campaigns')
    // Scoped by workspace in code — the service role bypasses RLS.
    .insert({ workspace_id: ctx.workspace.id, name, created_by: ctx.userId })
    .select('id')
    .single()

  if (error || !data) return { ok: false, error: 'Could not create that campaign.' }

  revalidatePath('/linkedin/campaigns')

  return {
    ok: true,
    campaignId: data.id,
    message: `“${name}” created. It is a draft and nobody is enrolled yet.`,
  }
}
