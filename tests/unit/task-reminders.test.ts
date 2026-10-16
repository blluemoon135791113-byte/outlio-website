/**
 * Due task reminders become one bell notification each, for the assignee only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

let claimed: Record<string, unknown>[] = []
const notify = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: (name: string, args: { p_limit: number }) => {
      expect(name).toBe('crm_claim_due_task_reminders')
      expect(args.p_limit).toBe(50)
      return Promise.resolve({ data: claimed, error: null })
    },
  }),
}))
vi.mock('@/lib/crm/activities', () => ({ notify: (...args: unknown[]) => notify(...args) }))

const { TaskReminderDispatcher } = await import('@/lib/crm/reminders')

const task = (id: string, assignee: string | null) => ({
  id,
  workspace_id: 'w1',
  assigned_to_user_id: assignee,
  title: 'Follow up with John',
  contact_id: null,
  opportunity_id: 'o1',
  remind_at: '2026-10-15T10:00:00Z',
})

beforeEach(() => {
  claimed = []
  notify.mockReset()
  notify.mockResolvedValue(1)
})

describe('TaskReminderDispatcher', () => {
  it('notifies the assignee with a link back to the deal', async () => {
    claimed = [task('t1', 'u1')]
    const outcome = await new TaskReminderDispatcher(50).run()

    expect(outcome).toEqual({ claimed: 1, delivered: 1, failed: 0 })
    expect(notify).toHaveBeenCalledWith('w1', ['u1'], {
      kind: 'crm.task.reminder',
      title: 'Reminder: Follow up with John',
      refs: { task_id: 't1', opportunity_id: 'o1', contact_id: null },
    })
  })

  it('skips an unassigned task and keeps going after a failure', async () => {
    claimed = [task('t1', null), task('t2', 'u1'), task('t3', 'u2')]
    notify.mockRejectedValueOnce(new Error('insert failed'))

    const outcome = await new TaskReminderDispatcher(50).run()
    expect(outcome).toEqual({ claimed: 3, delivered: 1, failed: 1 })
    expect(notify).toHaveBeenCalledTimes(2)
  })
})
