'use client'

import { useActionState, useState } from 'react'

import {
  completeTaskAction,
  reassignTaskAction,
  snoozeTaskAction,
  type TaskActionState,
} from '@/app/(product)/crm/tasks/actions'

/**
 * The actions on a My Work task row — §7: "Allow explicit snooze with a new
 * review date, completion with an outcome, reassignment where permitted."
 *
 * ⚠️ HIDING THE REASSIGN BUTTON IS NOT THE PERMISSION CHECK. `canReassign`
 * only decides what is drawn; `reassignTaskAction` gates on
 * `crm.contact.assign` itself, and the database function checks membership.
 * CLAUDE.md: "Hiding a button is not access control."
 */

type Panel = 'complete' | 'snooze' | 'reassign' | null

const BUTTON =
  'rounded-[var(--radius-md)] bg-surface-muted px-2.5 py-1 text-xs font-medium text-ink transition-colors duration-150 hover:opacity-90 disabled:opacity-60'
const PRIMARY =
  'rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90 disabled:opacity-60'
const FIELD =
  'mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink'

export function WorkItemActions({
  taskId,
  version,
  canReassign,
  members,
  minSnoozeDate,
  maxSnoozeDate,
}: {
  taskId: string
  version: number
  canReassign: boolean
  members: { userId: string; name: string }[]
  /** Computed on the server, so the date bounds cannot disagree across hydration. */
  minSnoozeDate: string
  maxSnoozeDate: string
}) {
  const [panel, setPanel] = useState<Panel>(null)
  const [completed, complete, completing] = useActionState<TaskActionState, FormData>(
    completeTaskAction,
    null,
  )
  const [snoozed, snooze, snoozing] = useActionState<TaskActionState, FormData>(
    snoozeTaskAction,
    null,
  )
  const [reassigned, reassign, reassigning] = useActionState<TaskActionState, FormData>(
    reassignTaskAction,
    null,
  )

  for (const state of [completed, snoozed, reassigned]) {
    if (state && state.ok) {
      return (
        <p role="status" aria-live="polite" className="mt-2 text-xs font-medium text-success">
          {state.message}
        </p>
      )
    }
  }

  const failure = [completed, snoozed, reassigned].find((s) => s !== null && !s.ok)
  const error = failure && !failure.ok ? failure.error : ''

  const toggle = (next: Exclude<Panel, null>) => setPanel((p) => (p === next ? null : next))
  const showReassign = canReassign && members.length > 0

  const hidden = (
    <>
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="version" value={version} />
    </>
  )

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={BUTTON}
          aria-expanded={panel === 'complete'}
          onClick={() => toggle('complete')}
        >
          Complete
        </button>
        <button
          type="button"
          className={BUTTON}
          aria-expanded={panel === 'snooze'}
          onClick={() => toggle('snooze')}
        >
          Snooze
        </button>
        {showReassign ? (
          <button
            type="button"
            className={BUTTON}
            aria-expanded={panel === 'reassign'}
            onClick={() => toggle('reassign')}
          >
            Reassign
          </button>
        ) : null}
      </div>

      {panel === 'complete' ? (
        <form action={complete} className="space-y-2">
          {hidden}
          <label className="block">
            <span className="text-xs font-medium text-ink">Outcome</span>
            <textarea
              name="outcome"
              rows={2}
              maxLength={500}
              placeholder="Booked a demo for Thursday"
              className={FIELD}
            />
            <span className="mt-1 block text-xs text-muted">
              Optional. It is kept on the task’s history even if the task is reopened.
            </span>
          </label>
          <button type="submit" disabled={completing} className={PRIMARY}>
            {completing ? 'Completing…' : 'Mark complete'}
          </button>
        </form>
      ) : null}

      {panel === 'snooze' ? (
        <form action={snooze} className="space-y-2">
          {hidden}
          <label className="block">
            <span className="text-xs font-medium text-ink">Look at it again on</span>
            <input
              name="until"
              type="date"
              required
              min={minSnoozeDate}
              max={maxSnoozeDate}
              className={FIELD}
            />
            {/*
              States what snoozing does NOT do. A snooze that silently moved the
              due date would turn an overdue commitment into an on-time one.
            */}
            <span className="mt-1 block text-xs text-muted">
              Hidden from My Work until then. The due date does not change.
            </span>
          </label>
          <button type="submit" disabled={snoozing} className={PRIMARY}>
            {snoozing ? 'Snoozing…' : 'Snooze'}
          </button>
        </form>
      ) : null}

      {panel === 'reassign' && showReassign ? (
        <form action={reassign} className="space-y-2">
          {hidden}
          <label className="block">
            <span className="text-xs font-medium text-ink">Hand it to</span>
            <select name="assigneeId" required defaultValue="" className={FIELD}>
              <option value="" disabled>
                Choose a member
              </option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={reassigning} className={PRIMARY}>
            {reassigning ? 'Reassigning…' : 'Reassign'}
          </button>
        </form>
      ) : null}

      <p role="status" aria-live="polite" className="text-xs text-danger">
        {error}
      </p>
    </div>
  )
}
