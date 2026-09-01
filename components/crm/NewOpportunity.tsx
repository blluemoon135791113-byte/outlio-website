'use client'

import { useActionState, useState } from 'react'

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
  onCancel,
}: {
  pipelineId: string
  stages: StageOption[]
  /** Omitted when the contact is already decided. */
  contacts?: ContactOption[]
  fixedContact?: ContactOption
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
          className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90 disabled:opacity-60"
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
  label?: string
}) {
  const [open, setOpen] = useState(false)

  if (open) return <NewOpportunityForm {...props} onCancel={() => setOpen(false)} />

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90"
    >
      {props.label ?? 'New deal'}
    </button>
  )
}
