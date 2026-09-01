'use server'

/**
 * Inbox actions — M8 Phase 26.
 *
 * ⚠️ EVERY ONE RE-CHECKS THE THREAD IS IN THE CALLER'S WORKSPACE, in code. The
 * service role bypasses RLS, so a thread id arriving from a form is an
 * assertion by the browser and not authorisation.
 */
import { revalidatePath } from 'next/cache'

import { getThread, replyableMessageId, seesAllThreads } from '@/lib/email/inbox'
import { enqueueEmail } from '@/lib/email/send'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWorkspacePermission, requireWorkspace } from '@/lib/workspaces/context'
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

// ---------------------------------------------------------------------------
// Replying from the inbox — R11
// ---------------------------------------------------------------------------

export type ReplyState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | null

/**
 * Sends a reply on a thread.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE INBOX COULD READ AND TRIAGE, AND NOT ANSWER.                        ║
 * ║                                                                           ║
 * ║  Someone had to leave Outlio, open their real mail client, find the       ║
 * ║  conversation and reply there — at which point the reply is invisible to  ║
 * ║  the CRM, the campaign report and every metric that depends on it.        ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export async function replyToThread(
  _previous: ReplyState,
  formData: FormData,
): Promise<ReplyState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('email.inbox.manage')
  } catch {
    return { ok: false, error: 'You do not have permission to reply.' }
  }

  const threadId = String(formData.get('threadId') ?? '')
  const body = String(formData.get('body') ?? '').trim()
  if (!body) return { ok: false, error: 'Write a reply first.' }

  const detail = await getThread({
    workspaceId: ctx.workspace.id,
    userId: ctx.userId!,
    policy: { role: ctx.role, modules: ctx.modules },
    threadId,
  })

  // Null covers both "not in this workspace" and "not assigned to this setter",
  // and the two are deliberately indistinguishable from here.
  if (!detail) return { ok: false, error: 'That conversation is not available.' }

  const inbound = [...detail.messages].reverse().find((m) => m.classification === 'reply')
  if (!inbound) {
    return { ok: false, error: 'There is nothing here to reply to yet.' }
  }

  const db = createAdminClient()
  const { data: thread } = await db
    .from('email_threads')
    .select('account_id, subject, contact_id')
    .eq('workspace_id', ctx.workspace.id)
    .eq('id', threadId)
    .maybeSingle()

  if (!thread?.account_id) {
    return { ok: false, error: 'This conversation has no mailbox to reply from.' }
  }

  const subject = (thread.subject ?? '').toLowerCase().startsWith('re:')
    ? thread.subject!
    : `Re: ${thread.subject ?? '(no subject)'}`

  const result = await enqueueEmail({
    workspaceId: ctx.workspace.id,
    accountId: thread.account_id,
    toEmail: inbound.fromEmail,
    subject,
    bodyText: body,
    contactId: thread.contact_id,
    threadId,
    /*
     * ⚠️ ONLY WHEN IT IS A REAL Message-ID. `replyableMessageId` returns null
     * for the `uid-<n>` fallback that reply-sync stores when a message arrives
     * without one — `In-Reply-To: uid-42` is a malformed header and some
     * servers reject the whole message over it. Losing the threading is a
     * cosmetic problem; losing the send is not.
     */
    inReplyToMessageId: replyableMessageId(inbound.providerMessageId),
    /*
     * Idempotent on the thread and the message being answered, so a
     * double-submit sends once. It deliberately does NOT include the body: two
     * different replies to the same message are two different emails.
     */
    idempotencyKey: `reply:${threadId}:${inbound.id}:${Date.now()}`,
  })

  if (!result.queued) {
    /*
     * ⚠️ EACH REFUSAL SAYS WHAT TO DO ABOUT IT. `enqueueEmail` refuses for five
     * distinct, actionable reasons, and collapsing them into "could not send"
     * leaves someone re-clicking a button that will never work — the daily
     * limit and an unhealthy mailbox need completely different responses.
     */
    const explain: Record<string, string> = {
      suppressed: 'That address is on your do-not-contact list.',
      duplicate: 'That reply has already been queued.',
      daily_limit: "This mailbox has reached today's sending limit. It will send tomorrow.",
      no_account: 'This conversation has no mailbox to reply from.',
      unusable_schedule:
        'This mailbox has no usable sending window configured, so nothing can go out.',
      unhealthy: 'This mailbox is paused because of its bounce rate. Fix it before replying.',
    }

    return { ok: false, error: explain[result.reason] ?? 'Could not send that reply.' }
  }

  revalidatePath(`/email/inbox/${threadId}`)
  revalidatePath('/email/inbox')
  return { ok: true, message: 'Reply queued. It goes out on the next tick.' }
}
