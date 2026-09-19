'use client'

import { useActionState, useState } from 'react'

import { FormDialog } from '@/components/crm/FormDialog'
import { CURRENCIES } from '@/lib/crm/currencies'
import {
  createOpportunityAction,
  type OpportunityActionState,
} from '@/app/(product)/crm/opportunities-actions'

export type StageOption = { id: string; name: string; kind: 'open' | 'won' | 'lost' }
export type ContactOption = { id: string; name: string }

/**
 * ⚠️ ONE COMPONENT, SEVERAL ENTRY POINTS. The brief names eight ways to create
 * a deal. This takes the context it is given — a pipeline always, a contact
 * when opened from a contact — so the board and the contact page share one
 * implementation rather than growing two that drift apart.
 */
export function NewOpportunityForm({
  pipelineId,
  stages,
  contacts,
  fixedContact,
  workspaceCurrency,
  onCancel,
}: {
  pipelineId: string
  stages: StageOption[]
  /** Omitted when the contact is already decided. */
  contacts?: ContactOption[]
  fixedContact?: ContactOption
  /**
   * What this workspace reports in. Pre-selected, because the overwhelmingly
   * common case is a deal in the workspace's own currency — and a picker that
   * opens on the wrong one is a data-entry error waiting to happen.
   */
  workspaceCurrency?: string
  onCancel?: () => void
}) {
  const [state, action, pending] = useActionState<OpportunityActionState, FormData>(
    createOpportunityAction,
    null,
  )

  // The first open stage is where a new deal belongs; Won is not a starting point.
  const firstOpen = stages.find((s) => s.kind === 'open') ?? stages[0]

  return (
    <form action={action} className="clay space-y-4 p-4">
      <input type="hidden" name="pipelineId" value={pipelineId} />
      {fixedContact ? <input type="hidden" name="contactId" value={fixedContact.id} /> : null}

      <div>
        <h3 className="text-sm font-semibold text-ink">New deal</h3>
        {fixedContact ? (
          <p className="mt-0.5 text-xs text-muted">For {fixedContact.name}</p>
        ) : null}
      </div>

      <label className="block">
        <span className="text-xs font-medium text-ink">Name</span>
        <input
          name="title"
          required
          maxLength={140}
          placeholder="Acme — annual licence"
          className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
        />
      </label>

      {!fixedContact && contacts ? (
        <label className="block">
          <span className="text-xs font-medium text-ink">Contact</span>
          <select
            name="contactId"
            defaultValue=""
            className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink [color-scheme:light]"
          >
            {/*
              ⚠️ OPTIONAL, NOT REQUIRED. A deal can exist before anyone knows
              who the buyer is. Forcing a contact here is what makes people
              invent a placeholder person, which is a duplicate the CRM will
              carry forever.
            */}
            <option value="">No contact yet</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-ink">Stage</span>
          <select
            name="stageId"
            defaultValue={firstOpen?.id ?? ''}
            className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink [color-scheme:light]"
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-ink">Value</span>
          <input
            name="valueAmount"
            type="number"
            min={0}
            step="0.01"
            placeholder="Leave blank if unknown"
            className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
          {/*
            Says what blank MEANS. A deal worth nothing and a deal whose value
            nobody knows are different, and the forecast treats them
            differently — blank is excluded, zero is counted as zero.
          */}
          <span className="mt-1 block text-xs text-muted">
            Blank means unknown, and is left out of the forecast.
          </span>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-ink">Currency</span>
          {/*
            ⚠️ A CURATED LIST, NOT FREE TEXT, AND THE REASON IS NOT TIDINESS.
            A currency the rate feed cannot quote does not fail loudly — the
            deal saves, its rate is NULL, and it silently drops out of every
            money total, surfacing only in the "not included" caveat on
            Reports. Every code in `CURRENCIES` was checked against
            Frankfurter's own list.
          */}
          <select
            name="currency"
            defaultValue={workspaceCurrency ?? 'USD'}
            className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
          >
            {CURRENCIES.map((currency) => (
              <option key={currency.code} value={currency.code}>
                {currency.code} — {currency.name}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-muted">
            Converted to {workspaceCurrency ?? 'USD'} for reporting, at the rate
            on the day the deal is created.
          </span>
        </label>
      </div>

      <label className="block">
        <span className="text-xs font-medium text-ink">Expected close</span>
        <input
          name="expectedCloseDate"
          type="date"
          className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:bg-accent-deep disabled:opacity-60"
        >
          {pending ? 'Adding…' : 'Add deal'}
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

        {/* Announced as well as shown. */}
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

/** The button that reveals the form. */
export function NewOpportunityButton(props: {
  pipelineId: string
  stages: StageOption[]
  contacts?: ContactOption[]
  fixedContact?: ContactOption
  /** Forwarded to the form. See its own note on why it is pre-selected. */
  workspaceCurrency?: string
  label?: string
}) {
  const [open, setOpen] = useState(false)

  /*
   * ⚠️ IN A LAYER, NOT IN PLACE — the same fix as `NewPipelineButton`, for the
   * same reason: rendered here the form became a flex item in the board's
   * header strip, squeezing itself and displacing the "Manage" menu's anchor.
   * See `components/crm/FormDialog.tsx`.
   */
  if (open) {
    return (
      <FormDialog label={props.label ?? 'New deal'} onClose={() => setOpen(false)}>
        <NewOpportunityForm {...props} onCancel={() => setOpen(false)} />
      </FormDialog>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:bg-accent-deep"
    >
      {props.label ?? 'New deal'}
    </button>
  )
}
