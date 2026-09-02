'use client'

import { useActionState, useState } from 'react'

import { createTaskAction, type CreateTaskState } from '@/app/(product)/crm/tasks/actions'

/**
 * Creating a task — R2.
 *
 * ⚠️ UNTIL NOW A TASK COULD ONLY COME FROM A FLOW. The tasks page listed and
 * completed them and offered no way to make one, so the queue stayed empty for
 * anyone who had not built an automation first.
 */
export function NewTaskForm({
  contactId,
  contactName,
  onCancel,
}: {
  contactId?: string
  contactName?: string
  onCancel?: () => void
}) {
  const [state, action, pending] = useActionState<CreateTaskState, FormData>(
    createTaskAction,
    null,
  )

  if (state?.ok) {
    return <p role="status" aria-live="polite" className="text-xs font-medium text-success">{state.message}</p>
  }

  return (
    <form action={action} className="clay space-y-3 p-4">
      {contactId ? <input type="hidden" name="contactId" value={contactId} /> : null}

      <div>
        <h3 className="text-sm font-semibold text-ink">New task</h3>
        {contactName ? <p className="mt-0.5 text-xs text-muted">For {contactName}</p> : null}
      </div>

      <label className="block">
        <span className="text-xs font-medium text-ink">What needs doing</span>
        <input
          name="title"
          required
          maxLength={200}
          placeholder="Follow up on the proposal"
          className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
        />
      </label>

      <label className="block">
        <span className="text-xs font-medium text-ink">Due</span>
        <input
          name="dueAt"
          type="date"
          className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
        />
        {/* Explains the end-of-day rule, so "today" does not look overdue. */}
        <span className="mt-1 block text-xs text-muted">
          Due at the end of that day. Leave blank if there is no deadline.
        </span>
      </label>

      <label className="block">
        <span className="text-xs font-medium text-ink">Notes</span>
        <textarea
          name="body"
          rows={2}
          maxLength={2000}
          className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Creating…' : 'Create task'}
        </button>

        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[var(--radius-md)] px-3 py-1.5 text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
          >
            Cancel
          </button>
        ) : null}

        <p role="status" aria-live="polite" className="text-xs text-danger">
          {state && !state.ok ? state.error : ''}
        </p>
      </div>
    </form>
  )
}

export function NewTaskButton(props: { contactId?: string; contactName?: string }) {
  const [open, setOpen] = useState(false)
  if (open) return <NewTaskForm {...props} onCancel={() => setOpen(false)} />

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="rounded-[var(--radius-md)] bg-surface-muted px-2.5 py-1 text-xs font-medium text-ink transition-colors duration-150 hover:opacity-90"
    >
      New task
    </button>
  )
}
