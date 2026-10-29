import 'server-only'

import { notify } from '@/lib/crm/activities'
import { createAdminClient } from '@/lib/supabase/admin'

export type ReminderOutcome = { claimed: number; delivered: number; failed: number }

/**
 * Delivers due task reminders as in-app notifications (the bell).
 *
 * Claiming stamps `reminded_at` in the same statement (0158), so a reminder is
 * sent at most once even when two ticks overlap. A delivery that fails after
 * the claim is logged and not retried: a follow-up nudge arriving an hour late
 * is worse than the overdue task already showing in My Work.
 */
export class TaskReminderDispatcher {
  constructor(private readonly limit: number) {}

  async run(): Promise<ReminderOutcome> {
    const { data, error } = await createAdminClient().rpc('crm_claim_due_task_reminders', {
      p_limit: this.limit,
    })
    if (error) throw new Error(`crm_claim_due_task_reminders failed: ${error.message}`)

    const outcome: ReminderOutcome = { claimed: data?.length ?? 0, delivered: 0, failed: 0 }

    for (const task of data ?? []) {
      // An unassigned task has nobody to remind.
      if (!task.assigned_to_user_id) continue
      try {
        await notify(task.workspace_id, [task.assigned_to_user_id], {
          kind: 'crm.task.reminder',
          title: `Reminder: ${task.title}`.slice(0, 200),
          refs: {
            task_id: task.id,
            opportunity_id: task.opportunity_id,
            contact_id: task.contact_id,
          },
        })
        outcome.delivered += 1
      } catch {
        outcome.failed += 1
      }
    }

    return outcome
  }
}
