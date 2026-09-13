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
