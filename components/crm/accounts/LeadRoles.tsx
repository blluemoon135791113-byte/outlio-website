'use client'

import { startTransition, useActionState, useState, type FormEvent } from 'react'

import {
  refreshAccountRolesAction,
  setContactRolesAction,
  type RoleActionState,
} from '@/lib/crm/lead-role-actions'

export type RolePill = { id: string; name: string; auto: boolean; isActive: boolean }
export type RoleChoice = { id: string; name: string }

function submitWith(action: (data: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter)
    startTransition(() => action(data))
  }
}

/**
 * A lead's roles as pills, editable in place.
 *
 * Suggested roles are marked so a reader can tell the classifier's guess from
 * a person's decision; once anyone edits them the lead is pinned and the
 * classifier leaves it alone ("Back to suggestions" undoes that).
 */
export function LeadRoleCell({
  contactId,
  companyId,
  roles,
  manual,
  choices,
  canEdit,
}: {
  contactId: string
  companyId: string
  roles: RolePill[]
  manual: boolean
  choices: RoleChoice[]
  canEdit: boolean
}) {
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState<RoleActionState, FormData>(setContactRolesAction, null)
  const onSubmit = submitWith(action)

  // A disabled role already on the lead stays in the list, or saving would drop it.
  const offered = [
    ...choices,
    ...roles.filter((r) => !choices.some((c) => c.id === r.id)).map((r) => ({ id: r.id, name: `${r.name} (disabled)` })),
  ]

  return (
    <div className="space-y-1">
      {roles.length === 0 ? (
        <span className="text-muted" title="Not Available">
          <span aria-hidden="true">—</span>
          <span className="sr-only">No role</span>
        </span>
      ) : (
        <ul className="flex flex-wrap gap-1">
          {roles.map((role) => (
            <li
              key={role.id}
              title={role.auto ? 'Suggested from the job title' : 'Chosen by a person'}
              className={[
                'rounded-full border px-2 py-0.5 text-xs',
                role.auto ? 'border-dashed border-border text-muted' : 'border-border-strong text-ink',
              ].join(' ')}
            >
              {role.name}
              {role.auto ? <span className="sr-only"> (suggested)</span> : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit && !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
        >
          Edit
        </button>
      ) : null}

      {open ? (
        <form onSubmit={onSubmit} className="space-y-2 rounded-clay border border-line bg-surface p-2">
          <input type="hidden" name="contactId" value={contactId} />
          <input type="hidden" name="companyId" value={companyId} />
          <fieldset>
            <legend className="sr-only">Roles</legend>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {offered.map((c) => (
                <label key={c.id} className="flex items-center gap-1.5 text-xs text-ink">
                  <input
                    type="checkbox"
                    name="roleIds"
                    value={c.id}
                    defaultChecked={roles.some((r) => r.id === c.id)}
                    className="h-3.5 w-3.5"
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-[var(--radius-md)] bg-accent px-2.5 py-1 text-xs font-semibold text-cream hover:bg-accent-deep disabled:opacity-60"
            >
              Save
            </button>
            {manual ? (
              <button
                type="submit"
                name="reset"
                value="1"
                disabled={pending}
                className="rounded-[var(--radius-md)] px-2 py-1 text-xs font-medium text-muted hover:bg-surface-muted hover:text-ink"
              >
                Back to suggestions
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-[var(--radius-md)] px-2 py-1 text-xs font-medium text-muted hover:text-ink"
            >
              Close
            </button>
          </div>
          <p role="status" aria-live="polite" className={state && !state.ok ? 'text-xs text-danger' : 'text-xs text-muted'}>
            {state?.message ?? ''}
          </p>
        </form>
      ) : null}
    </div>
  )
}

/** Re-runs suggestions for the account's leads; leads chosen by hand are kept. */
export function RefreshRoles({ companyId }: { companyId: string }) {
  const [state, action, pending] = useActionState<RoleActionState, FormData>(refreshAccountRolesAction, null)
  return (
    <form onSubmit={submitWith(action)} className="flex items-center gap-2">
      <input type="hidden" name="companyId" value={companyId} />
      <button
        type="submit"
        disabled={pending}
        title="Suggest roles from each lead's job title. Roles someone chose by hand are not changed."
        className="rounded-[var(--radius-md)] border border-border px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-muted disabled:opacity-60"
      >
        {pending ? 'Suggesting…' : 'Refresh role suggestions'}
      </button>
      <p role="status" aria-live="polite" className={state && !state.ok ? 'text-xs text-danger' : 'text-xs text-muted'}>
        {state?.message ?? ''}
      </p>
    </form>
  )
}
