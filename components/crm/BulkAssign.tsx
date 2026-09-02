'use client'

import { useActionState, useRef, useState } from 'react'

import { bulkAssignAction, type BulkAssignState } from '@/lib/crm/contact-actions'

export type Assignee = { id: string; name: string }

/**
 * Selecting contacts and assigning them in one go — R2.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS CLOSES A LOOP R1 DELIBERATELY OPENED.                              ║
 * ║                                                                           ║
 * ║  Imported and extracted leads arrive UNASSIGNED on purpose — handing five ║
 * ║  hundred contacts to whoever clicked the button is wrong most of the      ║
 * ║  time. That is only defensible if distributing them afterwards is easy,   ║
 * ║  and until now nothing could assign more than one contact at a time.      ║
 * ║                                                                           ║
 * ║  ⚠️ THE SELECTION IS THE FORM. Each checkbox is a real                    ║
 * ║  `<input name="contactId">` inside this form, so the submitted set is by  ║
 * ║  definition what is ticked on screen. Mirroring it into React state is    ║
 * ║  how a list ends up submitting ids from the previous page.                ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export function BulkAssign({
  assignees,
  canAssign,
  children,
}: {
  assignees: Assignee[]
  /** False for a setter: no checkboxes are rendered, so no bar either. */
  canAssign: boolean
  /** The table. Its checkboxes must be `<input name="contactId">`. */
  children: React.ReactNode
}) {
  /*
   * ⚠️ SPLIT SO THE HOOKS LIVE ONLY IN THE BRANCH THAT USES THEM. Returning
   * early from a single component would call `useRef` and `useState`
   * conditionally, which React forbids — and `tsc` cannot see it. ESLint's
   * rules-of-hooks caught this exact mistake here.
   *
   * A setter sees the table and nothing else: wrapping it in a form with a
   * permanently disabled bar advertises an action they can never take.
   */
  if (!canAssign) return <>{children}</>
  return (
    <BulkAssignForm assignees={assignees}>{children}</BulkAssignForm>
  )
}

function BulkAssignForm({
  assignees,
  children,
}: {
  assignees: Assignee[]
  children: React.ReactNode
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [state, action, pending] = useActionState<BulkAssignState, FormData>(
    bulkAssignAction,
    null,
  )
  const [selected, setSelected] = useState(0)
  const [owner, setOwner] = useState('')

  /*
   * Counted from the DOM, not mirrored in state. The number shown can then
   * never disagree with what is actually ticked — including after a "select
   * all" or a server re-render.
   */
  const recount = () =>
    setSelected(
      formRef.current?.querySelectorAll<HTMLInputElement>(
        'input[name="contactId"]:checked',
      ).length ?? 0,
    )

  const toggleAll = (checked: boolean) => {
    formRef.current
      ?.querySelectorAll<HTMLInputElement>('input[name="contactId"]')
      .forEach((box) => {
        box.checked = checked
      })
    recount()
  }

  return (
    <form ref={formRef} action={action} onChange={recount} className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            onChange={(event) => toggleAll(event.target.checked)}
            className="h-4 w-4"
          />
          {/*
            ⚠️ SAYS "ON THIS PAGE", because that is what it does. A control
            labelled "select all" that silently means "the 25 you can see"
            is how someone assigns a quarter of an import and believes they
            assigned all of it.
          */}
          Select all on this page
        </label>

        <span className="text-xs text-muted">
          {selected === 0 ? 'Nothing selected' : `${selected} selected`}
        </span>
      </div>

      {children}

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <label className="flex items-center gap-2">
          <span className="sr-only">Assign selected contacts to</span>
          <select
            name="ownerUserId"
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
            className="rounded-[var(--radius-md)] border border-line bg-surface px-3 py-1.5 text-xs text-ink [color-scheme:light]"
          >
            <option value="">Assign to…</option>
            {assignees.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
            {/*
              ⚠️ UNASSIGNING IS AN OPTION, NOT AN OMISSION. Taking a contact
              off someone who has left is a normal act, and an explicitly
              unassigned contact is findable — see the R3 handover.
            */}
            <option value="none">Nobody (unassign)</option>
          </select>
        </label>

        <button
          type="submit"
          disabled={pending || !owner || selected === 0}
          className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Assigning…' : `Assign ${selected || ''}`.trim()}
        </button>

        <p
          role="status"
          aria-live="polite"
          className={`text-xs ${state?.ok ? 'text-success' : 'text-danger'}`}
        >
          {state ? (state.ok ? state.message : state.error) : ''}
        </p>
      </div>
    </form>
  )
}
