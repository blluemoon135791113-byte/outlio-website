'use client'

import { useActionState, useRef, useState } from 'react'

import { bulkAccountAction, type AccountActionState } from '@/lib/crm/account-actions'

export type BulkOption = { id: string; label: string }

/**
 * Select accounts → Assign / Change status / Add tag / Move to pipeline.
 *
 * ⚠️ THE SELECTION IS THE FORM (the `BulkAssign` rule): every checkbox in the
 * table is an `<input name="accountId">` inside this form, so what is
 * submitted is by definition what is ticked on screen. Nothing mirrors it
 * into React state — that is how a list submits the previous page's ids.
 *
 * Each operation renders only with its permission; the server checks again
 * per account (`bulkAccountAction`).
 */
export function AccountBulkBar({
  assignees,
  statuses,
  tags,
  canAssign,
  canEditStatus,
  canEditTags,
  deals = [],
  children,
}: {
  assignees: BulkOption[]
  statuses: BulkOption[]
  /** Every enabled value of every account group, labelled "Group: Value". */
  tags: BulkOption[]
  canAssign: boolean
  canEditStatus: boolean
  canEditTags: boolean
  /**
   * Open stages, labelled "Pipeline › Stage" — one deal per ticked account.
   * Empty when the person may not create deals (`crm.opportunity.create`).
   */
  deals?: BulkOption[]
  children: React.ReactNode
}) {
  const ops = [
    canAssign && assignees.length > 0 ? { op: 'assign', label: 'Assign to', options: assignees } : null,
    canEditStatus && statuses.length > 0 ? { op: 'status', label: 'Set status', options: statuses } : null,
    canEditTags && tags.length > 0 ? { op: 'add_tag', label: 'Add tag', options: tags } : null,
    deals.length > 0 ? { op: 'deal', label: 'Move to pipeline', options: deals } : null,
  ].filter((o): o is { op: string; label: string; options: BulkOption[] } => o !== null)

  // Checkboxes with no action behind them are furniture.
  if (ops.length === 0) return <>{children}</>
  return <BulkForm ops={ops}>{children}</BulkForm>
}

function BulkForm({
  ops,
  children,
}: {
  ops: { op: string; label: string; options: BulkOption[] }[]
  children: React.ReactNode
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [selected, setSelected] = useState(0)
  const [op, setOp] = useState(ops[0]!.op)
  const [state, action, pending] = useActionState<AccountActionState, FormData>(bulkAccountAction, null)

  const count = () =>
    setSelected(formRef.current?.querySelectorAll('input[name="accountId"]:checked').length ?? 0)

  const toggleAll = (checked: boolean) => {
    formRef.current
      ?.querySelectorAll<HTMLInputElement>('input[name="accountId"]')
      .forEach((box) => {
        box.checked = checked
      })
    count()
  }

  const current = ops.find((o) => o.op === op) ?? ops[0]!

  return (
    <form ref={formRef} action={action} onChange={count} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-clay border border-line bg-surface px-3 py-2">
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            className="h-4 w-4"
            aria-label="Select every account on this page"
            onChange={(event) => toggleAll(event.currentTarget.checked)}
          />
          {selected > 0 ? `${selected} selected` : 'Select all on this page'}
        </label>

        <span className="mx-1 h-4 w-px bg-line" aria-hidden="true" />

        <label className="sr-only" htmlFor="bulk-op">Change</label>
        <select
          id="bulk-op"
          name="op"
          value={op}
          onChange={(event) => setOp(event.currentTarget.value)}
          className="rounded-[var(--radius-md)] border border-line bg-panel px-2 py-1 text-xs text-ink"
        >
          {ops.map((o) => (
            <option key={o.op} value={o.op}>
              {o.label}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor={`bulk-value-${current.op}`}>{current.label}</label>
        <select
          key={current.op}
          id={`bulk-value-${current.op}`}
          name={`value_${current.op}`}
          defaultValue=""
          className="rounded-[var(--radius-md)] border border-line bg-panel px-2 py-1 text-xs text-ink"
        >
          <option value="" disabled>
            Choose…
          </option>
          {current.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>

        <button
          type="submit"
          disabled={pending || selected === 0}
          className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:bg-accent-deep disabled:opacity-60"
        >
          {pending ? 'Applying…' : 'Apply'}
        </button>

        <p role="status" aria-live="polite" className={state && !state.ok ? 'text-xs text-danger' : 'text-xs text-muted'}>
          {state?.message ?? ''}
        </p>
      </div>

      {children}
    </form>
  )
}
