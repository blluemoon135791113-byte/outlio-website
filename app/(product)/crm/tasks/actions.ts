'use server'

/**
 * Task actions — M9 screens over M2 Phase 5's schema.
 *
 * ⚠️ COMPLETING A TASK WRITES AN ACTIVITY, because every metric in the product
 * derives from the append-only event stream rather than from a status column.
 * A task quietly flipped to `completed` without an event would be invisible to
 * every report that counts "tasks completed".
 */
import { revalidatePath } from 'next/cache'

import { recordActivity } from '@/lib/crm/activities'
import { dispatchFlowTrigger } from '@/lib/flows/dispatch'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWorkspacePermission } from '@/lib/workspaces/context'

export type TaskActionState = { ok: true; message: string } | { ok: false; error: string } | null

export async function setTaskDone(
  _previous: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.task.manage')
  } catch {
    return { ok: false, error: 'You do not have permission to change tasks.' }
  }

  const id = String(formData.get('taskId') ?? '')
  const done = formData.get('done') === 'true'
  const db = createAdminClient()

  // Scoped by workspace in code: an id from a form is not authorisation.
  const { data: task } = await db
    .from('crm_tasks')
    .select('id, title, contact_id, status')
    .eq('workspace_id', ctx.workspace.id)
    .eq('id', id)
    .maybeSingle()

  if (!task) return { ok: false, error: 'That task no longer exists.' }

  const { error } = await db
    .from('crm_tasks')
    .update({
      status: done ? 'completed' : 'open',
      completed_at: done ? new Date().toISOString() : null,
      completed_by: done ? ctx.userId : null,
    })
    .eq('workspace_id', ctx.workspace.id)
    .eq('id', id)

  if (error) return { ok: false, error: 'Could not update that task.' }

  if (done) {
    /*
     * ⚠️ RECORDED ONLY WHEN IT IS ACTUALLY COMPLETED, and only on the
     * transition. Re-opening does not emit a second event: the stream is
     * append-only, so a "completed" event that is later contradicted would
     * still be counted by every report that reads it.
     */
    await recordActivity(ctx.workspace.id, {
      activityType: 'TASK_COMPLETED',
      // A person clicked it, so `manual` -- `system` is for things the
      // platform does on its own.
      channel: 'manual',
      actorUserId: ctx.userId,
      contactId: task.contact_id,
      metadata: { task_id: task.id, title: task.title },
    })

    /*
     * ⚠️ ONLY ON THE TRANSITION TO DONE, for the same reason the activity is.
     * Completing, reopening and completing again is one task finished twice by
     * a person and must not run the follow-up flow twice — `startRun`
     * de-duplicates on this key.
     */
    await dispatchFlowTrigger({
      workspaceId: ctx.workspace.id,
      triggerType: 'task_completed',
      contactId: task.contact_id,
      idempotencyKey: `task_completed:${task.id}`,
    })
  }

  revalidatePath('/crm/tasks')
  return { ok: true, message: done ? 'Done.' : 'Reopened.' }
}


// ---------------------------------------------------------------------------
// Creating a task — R2
//
// ⚠️ UNTIL NOW A TASK COULD ONLY ARRIVE FROM A FLOW. The tasks page listed and
// completed them and offered no way to make one, so the queue was empty for
// anyone who had not built an automation first.
// ---------------------------------------------------------------------------

export type CreateTaskState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | null

export async function createTaskAction(
  _previous: CreateTaskState,
  formData: FormData,
): Promise<CreateTaskState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.task.manage')
  } catch {
    return { ok: false, error: 'You do not have permission to create tasks.' }
  }

  const title = String(formData.get('title') ?? '').trim()
  if (!title) return { ok: false, error: 'Give the task a title.' }

  const contactId = String(formData.get('contactId') ?? '') || null
  const dueAt = String(formData.get('dueAt') ?? '').trim() || null

  const db = createAdminClient()

  /*
   * ⚠️ A CONTACT ID FROM A FORM IS A CLAIM. The service role bypasses RLS, so
   * without this check a crafted request could attach a task to a contact in
   * another workspace and surface that contact's name in this one.
   */
  if (contactId) {
    const { data: contact } = await db
      .from('crm_contacts')
      .select('id')
      .eq('workspace_id', ctx.workspace.id)
      .eq('id', contactId)
      .maybeSingle()

    if (!contact) return { ok: false, error: 'That contact is not in this workspace.' }
  }

  const { error } = await db.from('crm_tasks').insert({
    workspace_id: ctx.workspace.id,
    title,
    body: String(formData.get('body') ?? '').trim() || null,
    contact_id: contactId,
    /*
     * Assigned to the creator by default. An unassigned task belongs to
     * nobody and is the kind that sits in a queue forever.
     */
    assigned_to_user_id: ctx.userId,
    // A date input gives a local day; storing it as end-of-day avoids a task
    // created for "today" reading as already overdue.
    due_at: dueAt ? new Date(`${dueAt}T23:59:59`).toISOString() : null,
    status: 'open',
    created_by: ctx.userId,
  })

  if (error) return { ok: false, error: 'Could not create that task.' }

  revalidatePath('/crm/tasks')
  revalidatePath('/dashboard')
  return { ok: true, message: 'Task created.' }
}
