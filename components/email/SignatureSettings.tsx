'use client'

import { useActionState } from 'react'

import { updateSignature, type SignatureState } from '@/app/(product)/email/actions'

export type AccountSignature = {
  id: string
  signatureText: string | null
  signatureHtml: string | null
}

/**
 * The mailbox's sign-off.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ IT LIVES ON THE MAILBOX, NOT THE CAMPAIGN, AND THAT IS THE POINT.     ║
 * ║  Set it once and every sequence step, every broadcast and every one-to-one║
 * ║  reply from this address is signed — including the mail already sitting   ║
 * ║  in the queue, because it is applied on the way out.                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export function SignatureSettings({ account }: { account: AccountSignature }) {
  const [state, action, pending] = useActionState<SignatureState, FormData>(
    updateSignature,
    null,
  )

  return (
    <form action={action} className="space-y-3 border-t border-line pt-3">
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
          Signature
        </h4>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Added to the bottom of everything this mailbox sends, above the unsubscribe
          line. Change it here and mail already queued goes out with the new one.
        </p>
      </div>

      <input type="hidden" name="accountId" value={account.id} />

      <label className="block">
        <span className="text-xs font-medium text-ink">Plain text</span>
        <textarea
          name="signatureText"
          defaultValue={account.signatureText ?? ''}
          rows={5}
          maxLength={5000}
          placeholder={'Jane Okafor\nHead of Sales, Northwind\n+44 20 7946 0000'}
          className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 font-mono text-xs text-ink"
        />
        {/*
          ⚠️ SAID PLAINLY, BECAUSE THE OPPOSITE IS THE REASONABLE ASSUMPTION.
          Every other body field in this product renders {{variables}}. This one
          cannot: it is applied after the message is claimed for sending, where
          refusing on a missing value is no longer possible — and refusing is
          what makes the template engine safe everywhere else.
        */}
        <span className="mt-1 block text-xs text-muted">
          Typed exactly as it sends. Variables like{' '}
          <code className="text-ink">{'{{first_name}}'}</code> are not filled in here —
          a signature is about you, not the recipient.
        </span>
      </label>

      <details className="group">
        <summary className="cursor-pointer text-xs font-medium text-ink">
          HTML signature (optional)
        </summary>
        <label className="mt-2 block">
          <textarea
            name="signatureHtml"
            defaultValue={account.signatureHtml ?? ''}
            rows={5}
            maxLength={20000}
            placeholder={'<p><strong>Jane Okafor</strong><br>Head of Sales, Northwind</p>'}
            className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 font-mono text-xs text-ink"
          />
          <span className="mt-1 block text-xs text-muted">
            Used only for the HTML half of a message. Leave it empty and your plain-text
            signature is converted automatically, so HTML mail is still signed.
          </span>
        </label>
      </details>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-md)] bg-accent px-3 py-2 text-xs font-semibold text-on-accent disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save signature'}
        </button>
        {state ? (
          <span
            role="status"
            className={state.ok ? 'text-xs text-success' : 'text-xs text-danger'}
          >
            {state.ok ? state.message : state.error}
          </span>
        ) : null}
      </div>
    </form>
  )
}
