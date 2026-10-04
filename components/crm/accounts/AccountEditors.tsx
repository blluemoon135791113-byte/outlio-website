'use client'

import Link from 'next/link'
import { startTransition, useActionState, useRef, useState, type FormEvent } from 'react'

import {
  addAccountNoteAction,
  assignAccountAction,
  deleteAccountAction,
  setAccountTagsAction,
  setAccountStatusAction,
  unassignAccountAction,
  updateAccountAction,
  type AccountActionState,
  type AccountFormState,
} from '@/lib/crm/account-actions'
import type { ExistingAccount } from '@/lib/crm/account-writes'

export type Choice = { id: string; label: string; title?: string }

const INPUT =
  'mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink aria-[invalid=true]:border-danger'
const PRIMARY =
  'rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:bg-accent-deep disabled:opacity-60'
const QUIET =
  'rounded-[var(--radius-md)] px-2.5 py-1 text-xs font-medium text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-ink'

/**
 * Submits through a server action WITHOUT React 19's post-action form reset,
 * so a refused edit keeps what the person typed on screen.
 */
function useSubmit(action: (payload: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    // WITH the submitter, so a button's own name/value (mode=add) is sent —
    // `new FormData(form)` alone drops it.
    const submitter = (event.nativeEvent as SubmitEvent).submitter
    const data = new FormData(event.currentTarget, submitter)
    startTransition(() => action(data))
  }
}

function Status({ state }: { state: AccountActionState }) {
  return (
    <p role="status" aria-live="polite" className={state && !state.ok ? 'text-xs text-danger' : 'text-xs text-muted'}>
      {state?.message ?? ''}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

export type EditableFields = {
  name: string | null
  websiteUrl: string | null
  linkedInUrl: string | null
  salesNavigatorUrl: string | null
  location: string | null
  employeeCount: number | null
  employeeCountRange: string | null
  summary: string | null
  priority: string | null
}

/**
 * The overview's edit form. Opened by "Edit", closed by saving — the values
 * are shown read-only by the page itself, so nothing here duplicates them.
 */
export function AccountFieldsEditor({ companyId, fields }: { companyId: string; fields: EditableFields }) {
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState<AccountFormState, FormData>(updateAccountAction, null)
  const onSubmit = useSubmit(action)

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={QUIET}>
        Edit details
      </button>
    )
  }

  const errors = state && !state.ok && state.reason === 'invalid' ? state.fieldErrors : {}
  const saved = state?.ok === true

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-clay border border-line bg-surface p-4" noValidate>
      <input type="hidden" name="companyId" value={companyId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Text name="name" label="Company name" defaultValue={fields.name} error={errors.name} />
        <Text name="websiteUrl" label="Website" defaultValue={fields.websiteUrl} error={errors.websiteUrl} />
        <Text name="linkedInUrl" label="LinkedIn company page" defaultValue={fields.linkedInUrl} error={errors.linkedInUrl} />
        <Text
          name="salesNavigatorUrl"
          label="Sales Navigator URL"
          defaultValue={fields.salesNavigatorUrl}
          error={errors.salesNavigatorUrl}
        />
        <Text name="location" label="Location" defaultValue={fields.location} error={errors.location} />
        <div className="grid grid-cols-2 gap-3">
          <Text
            name="employeeCount"
            label="Employees"
            inputMode="numeric"
            defaultValue={fields.employeeCount === null ? null : String(fields.employeeCount)}
            error={errors.employeeCount}
          />
          <Text name="employeeCountRange" label="or a range" defaultValue={fields.employeeCountRange} error={errors.employeeCountRange} />
        </div>
        <label className="block text-xs font-medium text-ink">
          Priority
          <select name="priority" defaultValue={fields.priority ?? ''} className={INPUT}>
            <option value="">Not set</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
      </div>
      <label className="block text-xs font-medium text-ink">
        Summary
        <textarea name="summary" rows={4} maxLength={5000} defaultValue={fields.summary ?? ''} className={INPUT} />
      </label>

      <EditOutcome state={state} />

      <div className="flex items-center gap-2">
        <button type="submit" disabled={pending} className={PRIMARY}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={QUIET}>
          {saved ? 'Done' : 'Cancel'}
        </button>
        {saved ? <span role="status" className="text-xs text-muted">Saved.</span> : null}
      </div>
    </form>
  )
}

function EditOutcome({ state }: { state: AccountFormState }) {
  if (!state || state.ok || state.reason === 'invalid') return null
  if (state.reason === 'error') return <p role="alert" className="text-xs text-danger">{state.message}</p>
  const existing: ExistingAccount[] =
    state.reason === 'duplicate' ? [state.existing] : state.reason === 'conflict' ? state.existing : state.candidates
  return (
    <div role="alert" className="rounded-[var(--radius-md)] border border-danger bg-danger-soft px-3 py-2 text-xs text-ink">
      <p className="font-semibold">
        {state.reason === 'possible_duplicate'
          ? 'Another account already has this name and nothing else to tell them apart.'
          : 'Another account already uses one of these details. Nothing was changed.'}
      </p>
      <ul className="mt-1 space-y-1">
        {existing.map((e, i) =>
          'hidden' in e ? (
            <li key={`h-${i}`}>It is assigned to someone else.</li>
          ) : (
            <li key={e.id}>
              <Link href={`/crm/companies/${e.id}`} className="font-semibold underline underline-offset-2">
                Open existing account{e.name ? `: ${e.name}` : ''}
              </Link>
            </li>
          ),
        )}
      </ul>
    </div>
  )
}

function Text({
  name,
  label,
  defaultValue,
  error,
  ...rest
}: {
  name: string
  label: string
  defaultValue: string | null
  error?: string
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'defaultValue'>) {
  const id = `account-${name}`
  return (
    <label htmlFor={id} className="block text-xs font-medium text-ink">
      {label}
      <input
        id={id}
        name={name}
        defaultValue={defaultValue ?? ''}
        aria-invalid={Boolean(error)}
        spellCheck={name === 'name' || name === 'location'}
        className={INPUT}
        {...rest}
      />
      {error ? <span className="mt-1 block text-xs text-danger">{error}</span> : null}
    </label>
  )
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** Changes as soon as a value is chosen; the status and its history commit together (0150). */
export function StatusSelect({
  companyId,
  statuses,
  current,
}: {
  companyId: string
  statuses: Choice[]
  current: string | null
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [state, action, pending] = useActionState<AccountActionState, FormData>(setAccountStatusAction, null)
  const onSubmit = useSubmit(action)
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex items-center gap-2">
      <input type="hidden" name="companyId" value={companyId} />
      <label className="sr-only" htmlFor="account-status">Status</label>
      <select
        id="account-status"
        name="statusId"
        defaultValue={current ?? ''}
        disabled={pending}
        onChange={() => formRef.current?.requestSubmit()}
        className="rounded-[var(--radius-md)] border border-line bg-surface px-2 py-1 text-sm text-ink"
      >
        {current === null ? <option value="">Not set</option> : null}
        {statuses.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <Status state={state} />
    </form>
  )
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/**
 * One tag group's values on the account. Needs `accounts.edit_tags`. A group
 * with a primary asks for it first; any other value is ticked.
 */
export function TagGroupEditor({
  companyId,
  group,
  choices,
  primaryId,
  selectedIds,
}: {
  companyId: string
  group: { id: string; name: string; hasPrimary: boolean }
  /** Enabled values, plus any disabled value already on the account. */
  choices: Choice[]
  primaryId: string | null
  selectedIds: string[]
}) {
  const [open, setOpen] = useState(false)
  const [primary, setPrimary] = useState(primaryId ?? '')
  const [state, action, pending] = useActionState<AccountActionState, FormData>(setAccountTagsAction, null)
  const onSubmit = useSubmit(action)

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={QUIET} aria-label={`Edit ${group.name}`}>
        Edit
      </button>
    )
  }

  return (
    <form onSubmit={onSubmit} className="mt-2 space-y-2 rounded-clay border border-line bg-surface p-3">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="groupId" value={group.id} />
      {group.hasPrimary ? (
        <>
          <label className="block text-xs font-medium text-ink">
            Primary
            <select name="primaryId" value={primary} onChange={(e) => setPrimary(e.currentTarget.value)} className={INPUT}>
              <option value="">None</option>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <Checkboxes
            name="tagIds"
            choices={choices.filter((c) => c.id !== primary)}
            checked={selectedIds}
            disabled={!primary}
          />
        </>
      ) : (
        <Checkboxes name="tagIds" choices={choices} checked={[...selectedIds, ...(primaryId ? [primaryId] : [])]} />
      )}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={pending} className={PRIMARY}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={QUIET}>
          Close
        </button>
        <Status state={state} />
      </div>
    </form>
  )
}

/**
 * ⚠️ A DISABLED VALUE ALREADY ON THE ACCOUNT STAYS TICKED AND LISTED. Only
 * active values are offered to ADD; dropping the inactive ones from this list
 * would silently remove them on the next save.
 */
function Checkboxes({
  name,
  choices,
  checked,
  disabled,
}: {
  name: string
  choices: Choice[]
  checked: string[]
  disabled?: boolean
}) {
  if (choices.length === 0) return <p className="text-xs text-muted">None are enabled.</p>
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {choices.map((c) => (
        <label key={c.id} className="flex items-center gap-1.5 text-xs text-ink" title={c.title}>
          <input
            type="checkbox"
            name={name}
            value={c.id}
            defaultChecked={checked.includes(c.id)}
            disabled={disabled}
            className="h-3.5 w-3.5"
          />
          {c.label}
        </label>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

export function AssigneeEditor({
  companyId,
  assigned,
  members,
  allowMultiple,
}: {
  companyId: string
  assigned: Choice[]
  members: Choice[]
  allowMultiple: boolean
}) {
  const [state, action, pending] = useActionState<AccountActionState, FormData>(assignAccountAction, null)
  const [removeState, remove, removing] = useActionState<AccountActionState, FormData>(unassignAccountAction, null)
  const onSubmit = useSubmit(action)
  const onRemove = useSubmit(remove)
  const assignedIds = new Set(assigned.map((a) => a.id))

  return (
    <div className="space-y-2">
      {assigned.length > 0 ? (
        <ul className="space-y-1">
          {assigned.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 text-sm text-ink">
              {a.label}
              <form onSubmit={onRemove}>
                <input type="hidden" name="companyId" value={companyId} />
                <input type="hidden" name="userId" value={a.id} />
                <button type="submit" disabled={removing} className={QUIET} aria-label={`Unassign ${a.label}`}>
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Unassigned</p>
      )}

      <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="companyId" value={companyId} />
        <label className="sr-only" htmlFor="account-assignee">Assign to</label>
        <select
          id="account-assignee"
          name="userId"
          defaultValue=""
          required
          className="rounded-[var(--radius-md)] border border-line bg-surface px-2 py-1 text-sm text-ink"
        >
          <option value="" disabled>
            Choose someone…
          </option>
          {members
            .filter((m) => !assignedIds.has(m.id))
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
        </select>
        <button type="submit" name="mode" value="replace" disabled={pending} className={PRIMARY}>
          {assigned.length > 0 ? 'Reassign' : 'Assign'}
        </button>
        {allowMultiple && assigned.length > 0 ? (
          <button
            type="submit"
            name="mode"
            value="add"
            disabled={pending}
            className="rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface-muted"
          >
            Add
          </button>
        ) : null}
      </form>
      <Status state={state ?? removeState} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Notes and delete
// ---------------------------------------------------------------------------

export function NoteForm({ companyId }: { companyId: string }) {
  const formRef = useRef<HTMLFormElement>(null)
  const [state, action, pending] = useActionState<AccountActionState, FormData>(
    async (previous: AccountActionState, data: FormData) => {
      const result = await addAccountNoteAction(previous, data)
      // Here a reset IS wanted, but only once the note is saved.
      if (result?.ok) formRef.current?.reset()
      return result
    },
    null,
  )
  const onSubmit = useSubmit(action)
  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-2">
      <input type="hidden" name="companyId" value={companyId} />
      <label className="sr-only" htmlFor="account-note">Add a research note</label>
      <textarea
        id="account-note"
        name="body"
        rows={3}
        maxLength={5000}
        required
        placeholder="Add a research note…"
        className="w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
      />
      <div className="flex items-center gap-2">
        <button type="submit" disabled={pending} className={PRIMARY}>
          {pending ? 'Saving…' : 'Add note'}
        </button>
        <Status state={state} />
      </div>
    </form>
  )
}

export function DeleteAccount({ companyId, name }: { companyId: string; name: string }) {
  const [confirming, setConfirming] = useState(false)
  const [state, action, pending] = useActionState<AccountActionState, FormData>(deleteAccountAction, null)
  const onSubmit = useSubmit(action)

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-[var(--radius-md)] px-2.5 py-1 text-xs font-medium text-muted hover:bg-danger-soft hover:text-danger"
      >
        Delete account
      </button>
    )
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-danger bg-danger-soft px-3 py-2">
      <input type="hidden" name="companyId" value={companyId} />
      <p className="text-xs text-ink">
        Delete <strong>{name}</strong>? Its leads stay in the CRM.
      </p>
      <button
        type="submit"
        disabled={pending}
        className="rounded-[var(--radius-md)] border border-danger px-2.5 py-1 text-xs font-semibold text-danger hover:bg-panel"
      >
        {pending ? 'Deleting…' : 'Delete'}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className={QUIET}>
        Keep it
      </button>
      <Status state={state} />
    </form>
  )
}
