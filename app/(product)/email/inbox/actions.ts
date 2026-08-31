'use server'

/**
 * Inbox actions — M8 Phase 26.
 *
 * ⚠️ EVERY ONE RE-CHECKS THE THREAD IS IN THE CALLER'S WORKSPACE, in code. The
 * service role bypasses RLS, so a thread id arriving from a form is an
 * assertion by the browser and not authorisation.
 */
import { revalidatePath } from 'next/cache'

import { seesAllThreads } from '@/lib/email/inbox'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireWorkspace } from '@/lib/workspaces/context'
import { can } from '@/lib/workspaces/permissions'

export type InboxActionState = { ok: true; message: string } | { ok: false; error: string } | null

const PATH = '/email/inbox'

/** The thread, if this member is allowed to act on it. Null otherwise. */
async function reachableThread(threadId: string) {
  const ctx = await requireWorkspace()
  const policy = { role: ctx.role, modules: ctx.modules }

  if (!can(policy, 'email.inbox.view')) return null

  const { data } = await createAdminClient()
    .from('email_threads')
    .select('id, assigned_to')
    .eq('workspace_id', ctx.workspace.id)
    .eq('id', threadId)
    .maybeSingle()

  if (!data) return null

  /*
   * A setter may act on a thread assigned to them, and on nothing else — the
   * same rule that decides what they can READ, applied to writes.
   */
  if (!seesAllThreads(policy) && data.assigned_to !== ctx.userId) return null

  return { ctx, policy, thread: data }
}

export async function setThreadRead(
  _previous: InboxActionState,
  formData: FormData,
): Promise<InboxActionState> {
  const found = await reachableThread(String(formData.get('threadId') ?? ''))
  if (!found) return { ok: false, error: 'That conversation is not available.' }

  const read = formData.get('read') === 'true'

  await createAdminClient()
    .from('email_threads')
    .update({ read_at: read ? new Date().toISOString() : null })
    .eq('workspace_id', found.ctx.workspace.id)
    .eq('id', found.thread.id)

  revalidatePath(PATH)
  return { ok: true, message: read ? 'Marked as read.' : 'Marked as unread.' }
}

export async function setThreadResolved(
  _previous: InboxActionState,
  formData: FormData,
): Promise<InboxActionState> {
  const found = await reachableThread(String(formData.get('threadId') ?? ''))
  if (!found) return { ok: false, error: 'That conversation is not available.' }

  const resolved = formData.get('resolved') === 'true'

  await createAdminClient()
    .from('email_threads')
    .update({
      status: resolved ? 'resolved' : 'open',
      // Resolving implies you read it.
      ...(resolved ? { read_at: new Date().toISOString() } : {}),
    })
    .eq('workspace_id', found.ctx.workspace.id)
    .eq('id', found.thread.id)

  revalidatePath(PATH)
  return {
    ok: true,
    message: resolved
      // Said plainly, because it is not final: a new reply reopens it.
      ? 'Resolved. It comes back if they write again.'
      : 'Reopened.',
  }
}

export async function assignThread(
  _previous: InboxActionState,
  formData: FormData,
): Promise<InboxActionState> {
  const found = await reachableThread(String(formData.get('threadId') ?? ''))
  if (!found) return { ok: false, error: 'That conversation is not available.' }

  const assignee = String(formData.get('assignee') ?? '')

  /*
   * ⚠️ HANDING WORK TO SOMEONE ELSE IS A MANAGER'S CALL. A setter claiming an
   * unassigned thread for themselves is ordinary; a setter reassigning a
   * colleague's conversation is not.
   */
  const claimingForSelf = assignee === found.ctx.userId
  if (!claimingForSelf && !can(found.policy, 'email.inbox.manage')) {
    return { ok: false, error: 'Only a manager can assign a conversation to someone else.' }
  }

  if (assignee) {
    // The assignee must be a member of THIS workspace.
    const { data: member } = await createAdminClient()
      .from('workspace_memberships')
      .select('user_id')
      .eq('workspace_id', found.ctx.workspace.id)
      .eq('user_id', assignee)
      .maybeSingle()

    if (!member) return { ok: false, error: 'That person is not in this workspace.' }
  }

  await createAdminClient()
    .from('email_threads')
    .update({ assigned_to: assignee || null })
    .eq('workspace_id', found.ctx.workspace.id)
    .eq('id', found.thread.id)

  revalidatePath(PATH)
  return { ok: true, message: assignee ? 'Assigned.' : 'Unassigned.' }
}
