'use client'

import { useActionState, useState } from 'react'

import { createCampaign, type ActionState } from '@/app/(product)/email/actions'

/**
 * Creating a campaign.
 *
 * ⚠️ THE TYPE IS CHOSEN UP FRONT AND EXPLAINED, because it cannot be changed
 * meaningfully later and its consequences are invisible until mail has gone
 * out. A sales sequence that keeps mailing someone who replied, and a broadcast
 * that stops when someone says "thanks", are opposite failures — and both are
 * silent. The difference is stated in the words a person would use, not as
 * enum names.
 */
const TYPES = [
  {
    value: 'sales_sequence',
    label: 'Sales sequence',
    detail: 'Several steps with waits between them. Stops the moment someone replies.',
  },
  {
    value: 'marketing_broadcast',
    label: 'Broadcast',
    detail:
      'One message to everyone. Does NOT stop on a reply — a reply to a newsletter is a conversation, not an objection. Always includes a one-click unsubscribe.',
  },
] as const

export function CreateCampaign({ accounts }: { accounts: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createCampaign, null)
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<string>('sales_sequence')

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-[var(--radius-md)] bg-accent px-4 py-2 text-sm font-semibold text-cream transition-colors duration-150 hover:opacity-90"
      >
        New campaign
      </button>
    )
  }

  return (
    <form action={action} className="clay w-full space-y-5 p-6">
      <h3 className="text-sm font-semibold text-ink">New campaign</h3>

      <div>
        <label htmlFor="name" className="block text-xs font-semibold text-ink">
          Name
        </label>
        <input
          id="name"
          name="name"
          required
          placeholder="Q3 outbound — logistics"
          className="mt-1.5 w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors duration-150 focus-visible:border-accent"
        />
        <p className="mt-1 text-xs text-muted">Only your team sees this.</p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold text-ink">Type</legend>
        {TYPES.map((option) => (
          <label
            key={option.value}
            className={`flex cursor-pointer gap-2.5 rounded-[var(--radius-md)] border p-3 transition-colors duration-150 ${
              type === option.value ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-muted'
            }`}
          >
            <input
              type="radio"
              name="type"
              value={option.value}
              checked={type === option.value}
              onChange={(e) => setType(e.target.value)}
              className="mt-0.5 accent-[var(--accent)]"
            />
            <span>
              <span className="block text-sm font-semibold text-ink">{option.label}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                {option.detail}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <div>
        <label htmlFor="accountId" className="block text-xs font-semibold text-ink">
          Send from
        </label>
        <select
          id="accountId"
          name="accountId"
          required
          className="mt-1.5 w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors duration-150 focus-visible:border-accent [color-scheme:light]"
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.label}
            </option>
          ))}
        </select>
      </div>

      {state && !state.ok ? (
        <p role="alert" className="rounded-[var(--radius-md)] bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p role="status" aria-live="polite" className="rounded-[var(--radius-md)] bg-success-soft px-3 py-2 text-sm text-success">
          {state.message}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-md)] bg-accent px-4 py-2 text-sm font-semibold text-cream transition-colors duration-150 hover:opacity-90 disabled:opacity-60"
        >
          {/* It is created as a DRAFT, and the label says so — nothing sends yet. */}
          {pending ? 'Creating…' : 'Create draft'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium text-muted transition-colors duration-150 hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
