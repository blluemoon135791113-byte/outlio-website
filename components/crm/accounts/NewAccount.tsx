'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { startTransition, useActionState, useEffect, useRef, useState } from 'react'

import { FormDialog } from '@/components/crm/FormDialog'
import { createAccountAction, type AccountFormState } from '@/lib/crm/account-actions'
import type { ExistingAccount, FieldErrors } from '@/lib/crm/account-writes'

export type Choice = { id: string; label: string; title?: string }

const INPUT =
  'mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink aria-[invalid=true]:border-danger'

export function NewAccountButton(props: NewAccountFormProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:bg-accent-deep"
      >
        + Add Account
      </button>
      {open ? (
        <FormDialog label="Add an account" onClose={() => setOpen(false)}>
          <NewAccountForm {...props} onCancel={() => setOpen(false)} />
        </FormDialog>
      ) : null}
    </>
  )
}

export type GroupChoice = {
  id: string
  name: string
  hasPrimary: boolean
  values: Choice[]
}

type NewAccountFormProps = {
  /** The workspace's active account tag groups with their enabled values. */
  groups: GroupChoice[]
  statuses: Choice[]
  /** Empty when the person may not assign to others. */
  assignees: Choice[]
}

/**
 * Adding one account by hand.
 *
 * ⚠️ THE DUPLICATE CHECK IS THE POINT OF THIS FORM. Typing a company in is the
 * likeliest way to create a second copy of one that exists, so every outcome
 * of `findCrmCompanyMatches` has its own answer here — and "Open existing
 * account" appears only when the person may actually open it.
 */
function NewAccountForm({
  groups,
  statuses,
  assignees,
  onCancel,
}: NewAccountFormProps & { onCancel: () => void }) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)
  const [state, action, pending] = useActionState<AccountFormState, FormData>(createAccountAction, null)

  useEffect(() => {
    if (state?.ok) router.push(`/crm/companies/${state.id}`)
  }, [state, router])

  const errors: FieldErrors = state && !state.ok && state.reason === 'invalid' ? state.fieldErrors : {}

  return (
    /*
     * ⚠️ `onSubmit`, NOT `action={action}`. React 19 RESETS a form after an
     * action prop runs — which here would wipe everything typed the moment the
     * duplicate warning appeared, and "create anyway" would then resubmit an
     * empty form. Dispatching it ourselves keeps the values on screen.
     */
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter)
        startTransition(() => action(data))
      }}
      className="clay space-y-4 p-5"
      noValidate
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-ink">Add an account</h3>
        <button type="button" onClick={onCancel} className="text-xs font-medium text-muted hover:text-ink">
          Cancel
        </button>
      </div>

      <input ref={confirmRef} type="hidden" name="confirmPossibleDuplicate" defaultValue="0" />

      <Outcome
        state={state}
        onConfirm={() => {
          if (confirmRef.current) confirmRef.current.value = '1'
          formRef.current?.requestSubmit()
        }}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Text name="name" label="Company name" required error={errors.name} autoComplete="organization" />
        <Text name="websiteUrl" label="Website" placeholder="example.com" error={errors.websiteUrl} />
        <Text
          name="linkedInUrl"
          label="LinkedIn company page"
          placeholder="https://www.linkedin.com/company/…"
          error={errors.linkedInUrl}
        />
        <Text
          name="salesNavigatorUrl"
          label="Sales Navigator URL"
          placeholder="https://www.linkedin.com/sales/company/…"
          error={errors.salesNavigatorUrl}
        />
        <Text name="location" label="Location" error={errors.location} />
        <div className="grid grid-cols-2 gap-3">
          <Text name="employeeCount" label="Employees" inputMode="numeric" error={errors.employeeCount} />
          <Text name="employeeCountRange" label="or a range" placeholder="51-200" error={errors.employeeCountRange} />
        </div>

        <label className="block text-xs font-medium text-ink">
          Priority
          <select name="priority" defaultValue="" className={INPUT}>
            <option value="">Not set</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>

        <label className="block text-xs font-medium text-ink">
          Status
          <select name="statusId" defaultValue="" className={INPUT} aria-invalid={Boolean(errors.statusId)}>
            <option value="">New (default)</option>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <FieldError message={errors.statusId} />
        </label>

        {assignees.length > 0 ? (
          <label className="block text-xs font-medium text-ink sm:col-span-2">
            Assign to
            <select name="assigneeUserId" defaultValue="" className={INPUT} aria-invalid={Boolean(errors.assigneeUserId)}>
              <option value="">Nobody yet</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            <FieldError message={errors.assigneeUserId} />
          </label>
        ) : null}
      </div>

      {groups.map((group) => (
        <GroupField key={group.id} group={group} />
      ))}
      <FieldError message={errors.tags} />

      <label className="block text-xs font-medium text-ink">
        Summary
        <textarea name="summary" rows={3} maxLength={5000} className={INPUT} />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          onClick={() => {
            // A fresh submit is never a confirmation of a previous warning.
            if (confirmRef.current) confirmRef.current.value = '0'
          }}
          className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:bg-accent-deep disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Add account'}
        </button>
        <p className="text-xs text-muted">Only the name is required. Empty fields stay empty.</p>
      </div>
    </form>
  )
}

function Outcome({ state, onConfirm }: { state: AccountFormState; onConfirm: () => void }) {
  if (!state || state.ok || state.reason === 'invalid') return null

  if (state.reason === 'error') {
    return <Notice tone="danger">{state.message}</Notice>
  }

  if (state.reason === 'duplicate') {
    return (
      <Notice tone="danger">
        <p className="font-semibold">This account already exists.</p>
        <ExistingLinks existing={[state.existing]} />
      </Notice>
    )
  }

  if (state.reason === 'conflict') {
    return (
      <Notice tone="danger">
        <p className="font-semibold">These details match more than one existing account.</p>
        <p className="mt-1">
          Nothing was created or merged. Check the website, LinkedIn and Sales Navigator values — they
          point at different accounts.
        </p>
        <ExistingLinks existing={state.existing} />
      </Notice>
    )
  }

  return (
    <Notice tone="warning">
      <p className="font-semibold">An account with this name already exists.</p>
      <ExistingLinks existing={state.candidates} />
      {state.blocking ? (
        <p className="mt-1">
          Add its website, LinkedIn or Sales Navigator URL to tell the two apart — two accounts known
          only by the same name cannot both be kept.
        </p>
      ) : (
        <button
          type="button"
          onClick={onConfirm}
          className="mt-2 rounded-[var(--radius-md)] border border-border-strong bg-panel px-3 py-1 text-xs font-semibold text-ink hover:bg-surface-muted"
        >
          It is a different company — create anyway
        </button>
      )}
    </Notice>
  )
}

function ExistingLinks({ existing }: { existing: ExistingAccount[] }) {
  return (
    <ul className="mt-1 space-y-1">
      {existing.map((e, i) =>
        'hidden' in e ? (
          <li key={`hidden-${i}`}>It is assigned to someone else. Ask an admin to share it with you.</li>
        ) : (
          <li key={e.id}>
            <Link href={`/crm/companies/${e.id}`} className="font-semibold underline underline-offset-2">
              Open existing account{e.name ? `: ${e.name}` : ''}
            </Link>
          </li>
        ),
      )}
    </ul>
  )
}

function Notice({ tone, children }: { tone: 'danger' | 'warning'; children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className={
        tone === 'danger'
          ? 'rounded-[var(--radius-md)] border border-danger bg-danger-soft px-3 py-2 text-xs text-ink'
          : 'rounded-[var(--radius-md)] border border-border-strong bg-surface-muted px-3 py-2 text-xs text-ink'
      }
    >
      {children}
    </div>
  )
}

function Text({
  name,
  label,
  error,
  required,
  ...rest
}: {
  name: string
  label: string
  error?: string
  required?: boolean
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = `new-account-${name}`
  return (
    <label htmlFor={id} className="block text-xs font-medium text-ink">
      {label}
      {required ? <span className="text-muted"> (required)</span> : null}
      <input
        id={id}
        name={name}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        spellCheck={name === 'name' || name === 'location'}
        className={INPUT}
        {...rest}
      />
      <FieldError id={`${id}-error`} message={error} />
    </label>
  )
}

function FieldError({ message, id }: { message?: string; id?: string }) {
  if (!message) return null
  return (
    <span id={id} className="mt-1 block text-xs text-danger">
      {message}
    </span>
  )
}

function CheckboxGroup({
  name,
  label,
  choices,
  disabled,
  hint,
}: {
  name: string
  label: string
  choices: Choice[]
  disabled?: boolean
  hint?: string
}) {
  if (choices.length === 0) {
    return <p className="text-xs text-muted">None are enabled. An admin can add them in Settings.</p>
  }
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5">
        {choices.map((c) => (
          <label key={c.id} className="flex items-center gap-1.5 text-xs text-ink" title={c.title}>
            <input type="checkbox" name={name} value={c.id} disabled={disabled} className="h-3.5 w-3.5" />
            {c.label}
          </label>
        ))}
      </div>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  )
}

/**
 * One tag group's field. A group with a primary asks for that first; the rest
 * are ticked. Names encode the group (`tag:<id>`, `tag_primary:<id>`) so the
 * action can rebuild the per-group sets without knowing the groups in advance.
 */
function GroupField({ group }: { group: GroupChoice }) {
  const [primary, setPrimary] = useState('')

  if (group.values.length === 0) return null

  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium text-ink">{group.name}</legend>
      {group.hasPrimary ? (
        <>
          <label className="block text-xs text-muted">
            Primary
            <select
              name={`tag_primary:${group.id}`}
              value={primary}
              onChange={(e) => setPrimary(e.currentTarget.value)}
              className={INPUT}
            >
              <option value="">None</option>
              {group.values.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <CheckboxGroup
            name={`tag:${group.id}`}
            label="Also"
            choices={group.values.filter((v) => v.id !== primary)}
            disabled={!primary}
            hint={primary ? undefined : 'Choose a primary first.'}
          />
        </>
      ) : (
        <CheckboxGroup name={`tag:${group.id}`} label="Values" choices={group.values} />
      )}
    </fieldset>
  )
}
