'use client'

import { useActionState, useState } from 'react'

import { connectSmtpAccount, type ActionState } from '@/app/(product)/email/actions'

/**
 * Connecting a mailbox.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  SMTP IS OFFERED FIRST BECAUSE IT IS THE ONE THAT WORKS TODAY.            ║
 * ║                                                                           ║
 * ║  Gmail and Microsoft need OAuth scopes that require Google verification    ║
 * ║  and an annual CASA assessment (Ledger D33). Rather than showing greyed    ║
 * ║  buttons that promise something months away, the form says plainly that    ║
 * ║  a Google Workspace or Microsoft mailbox connects through SMTP right now.  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ THE PASSWORD FIELD IS WRITE-ONLY. It is posted once, encrypted server-side
 * and never returned by any read — so the form cannot be pre-filled with it on
 * a later edit, deliberately.
 */
export function ConnectMailbox() {
  const [state, action, pending] = useActionState<ActionState, FormData>(connectSmtpAccount, null)
  const [open, setOpen] = useState(false)
  const [wantsReplies, setWantsReplies] = useState(true)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-[var(--radius-md)] bg-accent px-4 py-2 text-sm font-semibold text-cream transition-colors duration-150 hover:opacity-90"
      >
        Connect a mailbox
      </button>
    )
  }

  return (
    <form action={action} className="clay space-y-5 p-6">
      <div>
        <h3 className="text-sm font-semibold text-ink">Connect a mailbox over SMTP</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Works with Google Workspace, Microsoft 365, Fastmail and any provider that gives you
          SMTP details. For Google and Microsoft, create an app password rather than using your
          normal one.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="displayName" label="Mailbox name" placeholder="Sales — Dana" required
          hint="Only you see this." />
        <Field name="fromEmail" label="Send from" type="email" placeholder="dana@yourcompany.com"
          required hint="The address recipients will see." />
        <Field name="fromName" label="From name" placeholder="Dana Reyes"
          hint="Optional. Shown beside the address." />
        <Field name="username" label="Username" placeholder="dana@yourcompany.com" required
          hint="Usually the same as the address." />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field name="smtpHost" label="SMTP server" placeholder="smtp.gmail.com" required
          className="sm:col-span-2" />
        <Field name="smtpPort" label="Port" type="number" defaultValue="587" required
          hint="587, or 465 for TLS." />
      </div>

      <div>
        <label className="flex items-start gap-2.5 text-sm text-ink">
          <input
            type="checkbox"
            checked={wantsReplies}
            onChange={(e) => setWantsReplies(e.target.checked)}
            className="mt-0.5 accent-[var(--accent)]"
          />
          <span>
            Also read replies
            {/*
              ⚠️ THE CONSEQUENCE IS STATED, not buried. Without IMAP a sequence
              cannot stop when someone answers — which is the single behaviour
              that makes people hate outbound.
            */}
            <span className="mt-0.5 block text-xs leading-relaxed text-muted">
              Needs IMAP. Without it Outlio can send but will never see a reply, so sequences
              cannot stop when someone answers.
            </span>
          </span>
        </label>
      </div>

      {wantsReplies ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field name="imapHost" label="IMAP server" placeholder="imap.gmail.com"
            className="sm:col-span-2" />
          <Field name="imapPort" label="Port" type="number" defaultValue="993" />
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name="password"
          label="Password or app password"
          type="password"
          required
          hint="Encrypted before it is stored, and never shown again."
        />
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
          {/*
            The label says what is happening. "Saving…" would be a lie: the
            connection is TESTED first, and that is the slow part.
          */}
          {pending ? 'Testing the connection…' : 'Test and connect'}
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

function Field({
  name, label, hint, className, ...rest
}: {
  name: string
  label: string
  hint?: string
  className?: string
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={className}>
      <label htmlFor={name} className="block text-xs font-semibold text-ink">
        {label}
      </label>
      <input
        id={name}
        name={name}
        {...rest}
        className="mt-1.5 w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors duration-150 focus-visible:border-accent"
      />
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  )
}
