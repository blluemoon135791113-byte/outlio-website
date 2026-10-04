'use client'

import { startTransition, useActionState, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

import { FormDialog } from '@/components/crm/FormDialog'
import { SocialLinkFields } from '@/components/crm/SocialLinks'
import { addDecisionMakerAction, createContactAction, type CreateContactState } from '@/lib/crm/contact-actions'

/**
 * Adding one contact by hand — R2.
 *
 * ⚠️ IT CAN REPORT "ALREADY IN YOUR CRM", and that is a feature. The action
 * routes through the deduplicating ingest rather than a plain insert, because
 * typing someone in is the most likely way a duplicate is created — it is what
 * people do when they cannot find a person who is already there.
 */
export function NewContactForm({
  onCancel,
  account,
  variant = 'lead',
}: {
  onCancel?: () => void
  /** Add the lead AT this account (the account page's "Add lead"). */
  account?: { id: string; name: string }
  /**
   * `decision_maker` (account page only): a name is required, both LinkedIn
   * addresses and other profiles are asked for, and the lead gets the
   * Decision Maker role, set by hand.
   */
  variant?: 'lead' | 'decision_maker'
}) {
  const router = useRouter()
  const decisionMaker = variant === 'decision_maker' && account !== undefined
  const [state, action, pending] = useActionState<CreateContactState, FormData>(
    decisionMaker ? addDecisionMakerAction : createContactAction,
    null,
  )

  /*
   * ⚠️ onSubmit, NOT `action={…}`. React 19 resets a form after its action
   * runs, so a refused entry (a mistyped address) wiped everything typed —
   * eight fields and a list of links, for one typo.
   */
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    startTransition(() => action(data))
  }

  /*
   * ⚠️ NO "OPEN CONTACT" ON A HELD RESULT. The entry matched somebody this
   * viewer may not read, so there is no id to route to — and offering the
   * button would disclose, by its presence alone, that a matching record
   * exists. The message stands on its own.
   */
  if (state?.ok && 'held' in state) {
    return (
      <div className="clay space-y-3 p-4">
        <p role="status" aria-live="polite" className="text-sm text-ink">{state.message}</p>
      </div>
    )
  }

  if (state?.ok) {
    return (
      <div className="clay space-y-3 p-4">
        <p role="status" aria-live="polite" className="text-sm text-ink">{state.message}</p>
        <button
          type="button"
          onClick={() => router.push(`/crm/contacts/${state.contactId}`)}
          className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:bg-accent-deep"
        >
          Open contact
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} noValidate className="clay space-y-3 p-4">
      <h3 className="text-sm font-semibold text-ink">
        {decisionMaker
          ? `Add a decision maker at ${account.name}`
          : account
            ? `Add a lead at ${account.name}`
            : 'Add a contact'}
      </h3>
      {account ? <input type="hidden" name="companyId" value={account.id} /> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-ink">Name{decisionMaker ? ' (required)' : ''}</span>
          <input
            name="fullName"
            maxLength={140}
            required={decisionMaker}
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
          <span className="text-xs font-medium text-ink">{decisionMaker ? 'Position' : 'Job title'}</span>
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

      <div className={decisionMaker ? 'grid gap-3 sm:grid-cols-2' : ''}>
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

        {decisionMaker ? (
          <label className="block">
            <span className="text-xs font-medium text-ink">Sales Navigator URL</span>
            <input
              name="salesNavigatorUrl"
              type="url"
              spellCheck={false}
              placeholder="https://www.linkedin.com/sales/lead/…"
              className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>
        ) : null}
      </div>

      {decisionMaker ? <SocialLinkFields /> : null}

      {/* Says the rule rather than waiting to reject the form. */}
      <p className="text-xs text-muted">
        {decisionMaker
          ? 'A name is required. Everything else is optional — leave out what you do not know.'
          : 'A name or an email is enough to start.'}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:bg-accent-deep disabled:opacity-60"
        >
          {pending ? 'Adding…' : decisionMaker ? 'Add decision maker' : 'Add contact'}
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

export function NewContactButton({
  account,
  variant = 'lead',
}: { account?: { id: string; name: string }; variant?: 'lead' | 'decision_maker' } = {}) {
  const [open, setOpen] = useState(false)
  /*
   * ⚠️ IN A LAYER, NOT IN PLACE — the `FormDialog` rule. Rendered in place, the
   * form became a flex item in the account page's People header strip, beside
   * the other buttons: squeezed, overlapping the table, half its fields hard
   * to reach.
   */
  if (open) {
    const label = variant === 'decision_maker' && account ? 'Add decision maker' : account ? 'Add lead' : 'Add contact'
    return (
      <FormDialog label={label} onClose={() => setOpen(false)}>
        <NewContactForm account={account} variant={variant} onCancel={() => setOpen(false)} />
      </FormDialog>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:bg-accent-deep"
    >
      {variant === 'decision_maker' && account ? 'Add decision maker' : account ? 'Add lead' : 'Add contact'}
    </button>
  )
}
