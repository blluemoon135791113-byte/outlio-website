'use client'

import { startTransition, useActionState, useState, type FormEvent } from 'react'

import { FormDialog } from '@/components/crm/FormDialog'
import { CURRENCIES } from '@/lib/crm/currencies'
import {
  createAccountDealAction,
  type OpportunityActionState,
} from '@/app/(product)/crm/opportunities-actions'

export type DealStageOption = { stageId: string; label: string }
export type DealPersonOption = { id: string; name: string }

const INPUT = 'mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink'

/**
 * "New deal" on an account page. The deal belongs to the ACCOUNT; a person at
 * it is optional (a deal can exist before anyone knows who the buyer is).
 *
 * ⚠️ onSubmit, NOT `action={…}`: React 19 resets a form after its action, so a
 * refused entry would wipe the value and dates someone typed.
 */
function AccountDealForm({
  account,
  stages,
  people,
  workspaceCurrency,
  onDone,
}: {
  account: { id: string; name: string }
  stages: DealStageOption[]
  people: DealPersonOption[]
  workspaceCurrency: string
  onDone: () => void
}) {
  const [state, action, pending] = useActionState<OpportunityActionState, FormData>(createAccountDealAction, null)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    startTransition(() => action(data))
  }

  if (state?.ok) {
    return (
      <div className="clay space-y-3 p-4">
        <p role="status" aria-live="polite" className="text-sm text-ink">{state.message}</p>
        <button
          type="button"
          onClick={onDone}
          className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:bg-accent-deep"
        >
          Done
        </button>
      </div>
    )
  }

  return (
    /* `clay` is the card: FormDialog's panel has no background of its own. */
    <form onSubmit={submit} noValidate className="clay space-y-4 p-4">
      <input type="hidden" name="companyId" value={account.id} />
      <div>
        <h3 className="text-sm font-semibold text-ink">New deal</h3>
        <p className="mt-0.5 text-xs text-muted">For {account.name}</p>
      </div>

      <label className="block">
        <span className="text-xs font-medium text-ink">Name</span>
        {/* Starts as the account's own name — editable, and nothing more is assumed. */}
        <input name="title" required maxLength={200} defaultValue={account.name} className={INPUT} />
      </label>

      <label className="block">
        <span className="text-xs font-medium text-ink">Pipeline and stage</span>
        <select name="stageId" defaultValue={stages[0]?.stageId ?? ''} className={INPUT}>
          {stages.map((s) => (
            <option key={s.stageId} value={s.stageId}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-xs font-medium text-ink">Person at {account.name}</span>
        <select name="contactId" defaultValue="" className={INPUT}>
          <option value="">No one yet</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-ink">Value</span>
          <input name="valueAmount" type="number" min={0} step="0.01" placeholder="Leave blank if unknown" className={INPUT} />
          <span className="mt-1 block text-xs text-muted">Blank means unknown, and is left out of the forecast.</span>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-ink">Currency</span>
          <select name="currency" defaultValue={workspaceCurrency} className={INPUT}>
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-xs font-medium text-ink">Expected close</span>
        <input name="expectedCloseDate" type="date" className={INPUT} />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:bg-accent-deep disabled:opacity-60"
        >
          {pending ? 'Adding…' : 'Add deal'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-[var(--radius-md)] px-3 py-1.5 text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
        >
          Cancel
        </button>
        <p role="status" aria-live="polite" className="text-xs text-danger">
          {state && !state.ok ? state.error : ''}
        </p>
      </div>
    </form>
  )
}

export function NewAccountDealButton(props: {
  account: { id: string; name: string }
  stages: DealStageOption[]
  people: DealPersonOption[]
  workspaceCurrency: string
}) {
  const [open, setOpen] = useState(false)
  if (open) {
    return (
      <FormDialog label="New deal" onClose={() => setOpen(false)}>
        <AccountDealForm {...props} onDone={() => setOpen(false)} />
      </FormDialog>
    )
  }
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:bg-accent-deep"
    >
      New deal
    </button>
  )
}
