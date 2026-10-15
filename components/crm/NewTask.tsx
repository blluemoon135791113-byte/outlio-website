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
/** An open deal this task could be about. */
export type TaskDealOption = { id: string; title: string }

export function NewTaskForm({
  contactId,
  contactName,
  opportunityId,
  deals,
  onCancel,
}: {
  contactId?: string
  contactName?: string
  /** Fixes the task to one deal (an Opportunities card); hides the deal picker. */
  opportunityId?: string
  deals?: TaskDealOption[]
  onCancel?: () => void
}) {
  const [state, action, pending] = useActionState<CreateTaskState, FormData>(
    createTaskAction,
    null,
  )
  // The browser knows the reader's timezone; the server does not.
  const [dueLocal, setDueLocal] = useState('')
  const dueIso = dueLocal && !Number.isNaN(new Date(dueLocal).getTime()) ? new Date(dueLocal).toISOString() : ''

  if (state?.ok) {
    return <p role="status" aria-live="polite" className="text-xs font-medium text-success">{state.message}</p>
  }

  return (
    <form action={action} className="clay space-y-3 p-4">
      {contactId ? <input type="hidden" name="contactId" value={contactId} /> : null}
      {opportunityId ? <input type="hidden" name="opportunityId" value={opportunityId} /> : null}
      <input type="hidden" name="dueAtIso" value={dueIso} />

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

      {/*
        ⚠️ NOT RENDERED WHEN THERE IS NOTHING TO PICK. An empty select reads as
        a broken control; a workspace with no open deals simply has no deal to
        name, and the column stays null as it does for every task that predates
        0124.

        The value is a claim, not authorisation — `createTaskAction` re-checks
        it against the workspace, and 0124's composite FK makes a cross-tenant
        link unrepresentable regardless of what this select is made to submit.
      */}
      {!opportunityId && deals && deals.length > 0 ? (
        <label className="block">
          <span className="text-xs font-medium text-ink">Deal</span>
          <select
            name="opportunityId"
            defaultValue=""
            className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
          >
            <option value="">No deal</option>
            {deals.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="block">
        <span className="text-xs font-medium text-ink">Due</span>
        <input
          type="datetime-local"
          value={dueLocal}
          onChange={(event) => setDueLocal(event.target.value)}
          className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
        />
      </label>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="remind"
          defaultChecked
          disabled={!dueIso}
          className="h-4 w-4 rounded-[var(--radius-sm)] accent-[var(--accent)]"
        />
        <span className="text-xs text-ink">Remind me at this time</span>
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
          className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:bg-accent-deep disabled:opacity-60"
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

export function NewTaskButton(props: {
  contactId?: string
  contactName?: string
  opportunityId?: string
  deals?: TaskDealOption[]
  label?: string
}) {
  const [open, setOpen] = useState(false)
  if (open) return <NewTaskForm {...props} onCancel={() => setOpen(false)} />

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="rounded-[var(--radius-md)] bg-surface-muted px-2.5 py-1 text-xs font-medium text-ink transition-colors duration-150 hover:opacity-90"
    >
      {props.label ?? 'New task'}
    </button>
  )
}
