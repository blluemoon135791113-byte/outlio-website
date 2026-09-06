'use client'

import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'

import { createContactAction, type CreateContactState } from '@/lib/crm/contact-actions'

/**
 * Adding one contact by hand — R2.
 *
 * ⚠️ IT CAN REPORT "ALREADY IN YOUR CRM", and that is a feature. The action
 * routes through the deduplicating ingest rather than a plain insert, because
 * typing someone in is the most likely way a duplicate is created — it is what
 * people do when they cannot find a person who is already there.
 */
export function NewContactForm({ onCancel }: { onCancel?: () => void }) {
  const router = useRouter()
  const [state, action, pending] = useActionState<CreateContactState, FormData>(
    createContactAction,
    null,
  )

  if (state?.ok) {
    return (
      <div className="clay space-y-3 p-4">
        <p role="status" aria-live="polite" className="text-sm text-ink">{state.message}</p>
        <button
          type="button"
          onClick={() => router.push(`/crm/contacts/${state.contactId}`)}
          className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90"
        >
          Open contact
        </button>
      </div>
    )
  }

  return (
    <form action={action} className="clay space-y-3 p-4">
      <h3 className="text-sm font-semibold text-ink">Add a contact</h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-ink">Name</span>
          <input
            name="fullName"
            maxLength={140}
            autoComplete="name"
            className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-ink">Email</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            /* An address is a code, not prose — a red squiggle under every
               one of them is noise. */
            spellCheck={false}
            className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-ink">Job title</span>
          <input
            name="jobTitle"
            maxLength={140}
            autoComplete="organization-title"
            className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-ink">Phone</span>
          <input
            name="phone"
            /* `tel` brings up the phone keypad on a handset. `text` gives a
               full keyboard for a field that only ever takes digits. */
            type="tel"
            autoComplete="tel"
            className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-xs font-medium text-ink">LinkedIn URL</span>
        <input
          name="linkedInUrl"
          type="url"
          spellCheck={false}
          placeholder="https://www.linkedin.com/in/…"
          className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
        />
      </label>

      {/* Says the rule rather than waiting to reject the form. */}
      <p className="text-xs text-muted">A name or an email is enough to start.</p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Adding…' : 'Add contact'}
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

        {/* Announced, not just shown — a server action result is invisible to a
            screen reader otherwise. */}
        <p role="status" aria-live="polite" className="text-xs text-danger">
          {state && !state.ok ? state.error : ''}
        </p>
      </div>
    </form>
  )
}

export function NewContactButton() {
  const [open, setOpen] = useState(false)
  if (open) return <NewContactForm onCancel={() => setOpen(false)} />

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90"
    >
      Add contact
    </button>
  )
}
