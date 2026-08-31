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
  }

  revalidatePath('/crm/tasks')
  return { ok: true, message: done ? 'Done.' : 'Reopened.' }
}
