'use client'

import { useActionState } from 'react'
import Link from 'next/link'

import { setTaskDone, type TaskActionState } from '@/app/(product)/crm/tasks/actions'

export type TaskRow = {
  id: string
  title: string
  body: string | null
  dueAt: string | null
  done: boolean
  contactId: string | null
  contactName: string | null
}

function dueLabel(dueAt: string | null): { text: string; overdue: boolean } {
  // ⚠️ NO DUE DATE IS NOT OVERDUE. An undated task is simply undated, and
  // colouring it red would train people to ignore the colour.
  if (!dueAt) return { text: 'No date', overdue: false }

  const due = new Date(dueAt)
  const overdue = due.getTime() < Date.now()
  return { text: due.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), overdue }
}

function Task({ row, canManage }: { row: TaskRow; canManage: boolean }) {
  const [state, toggle, pending] = useActionState<TaskActionState, FormData>(setTaskDone, null)
  const due = dueLabel(row.dueAt)

  return (
    <li className="flex items-start gap-3 border-b border-line py-3 last:border-0">
      {canManage ? (
        <form action={toggle} className="pt-0.5">
          <input type="hidden" name="taskId" value={row.id} />
          <input type="hidden" name="done" value={row.done ? 'false' : 'true'} />
          <button
            type="submit"
            disabled={pending}
            aria-label={row.done ? `Reopen ${row.title}` : `Complete ${row.title}`}
            className={`flex h-5 w-5 items-center justify-center rounded-full border transition-colors duration-150 disabled:opacity-60 ${
              row.done
                ? 'border-success bg-success text-cream'
                : 'border-line bg-surface hover:border-accent'
            }`}
          >
            {row.done ? (
              <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M2.5 6.2 4.8 8.5 9.5 3.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : null}
          </button>
        </form>
      ) : (
        <span aria-hidden className="mt-0.5 h-5 w-5 shrink-0 rounded-full border border-line" />
      )}

      <div className="min-w-0 flex-1">
        <p className={`text-sm ${row.done ? 'text-muted line-through decoration-1' : 'text-ink'}`}>
          {row.title}
        </p>
        {row.body ? <p className="mt-0.5 text-xs text-muted">{row.body}</p> : null}

        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <span className={due.overdue && !row.done ? 'font-medium text-danger' : 'text-muted'}>
            {due.overdue && !row.done ? `Overdue — ${due.text}` : due.text}
          </span>
          {row.contactId ? (
            <Link
              href={`/crm/contacts/${row.contactId}`}
              className="text-muted underline-offset-2 transition-colors duration-150 hover:text-ink hover:underline"
            >
              {row.contactName}
            </Link>
          ) : null}
        </p>

        {state && !state.ok ? <p role="alert" className="mt-1 text-xs text-danger">{state.error}</p> : null}
      </div>
    </li>
  )
}

/** What an empty list MEANS, per view. */
const EMPTY_COPY: Record<string, { title: string; body: string }> = {
  open: {
    title: 'No open tasks',
    body: 'Create one here, or from a contact. Flows can create them too.',
  },
  today: {
    title: 'Nothing due today',
    body: 'Undated tasks are not counted here — they are under Open.',
  },
  overdue: {
    title: 'Nothing overdue',
    body: 'Everything with a date is still within it.',
  },
  upcoming: {
    title: 'Nothing scheduled ahead',
    body: 'Tasks with a future due date appear here. Undated ones stay under Open.',
  },
  mine: {
    title: 'Nothing assigned to you',
    body: 'Work assigned to you appears here, soonest first.',
  },
  team: {
    title: 'Nobody else has open tasks',
    body: 'This shows everyone except you. Your own work is under Mine.',
  },
  completed: {
    title: 'Nothing completed yet',
    body: 'Finished tasks are kept here, with who completed them.',
  },
}

export function TaskList({
  rows,
  view,
  canManage,
}: {
  rows: TaskRow[]
  view: string
  canManage: boolean
}) {
  if (rows.length === 0) {
    // Declared next to its use so a new view cannot be added without someone
    // seeing that its empty state needs words.

    return (
      <div className="clay p-10 text-center">
        {/*
          ⚠️ EACH VIEW SAYS WHAT ITS OWN EMPTINESS MEANS. One shared "No tasks"
          would be actively misleading here: an empty Today is good news, an
          empty Overdue is better news, and an empty Open means there is no work
          recorded at all. They are three different facts.
        */}
        <p className="text-sm font-medium text-ink">
          {EMPTY_COPY[view]?.title ?? 'No open tasks'}
        </p>
        <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted">
          {EMPTY_COPY[view]?.body ??
            'Tasks are created from a contact, or by a flow. They show up here with whatever is due first.'}
        </p>
      </div>
    )
  }

  return (
    <ul className="clay px-4 py-1">
      {rows.map((row) => (
        <Task key={row.id} row={row} canManage={canManage} />
      ))}
    </ul>
  )
}
