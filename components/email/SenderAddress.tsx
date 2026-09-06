'use client'

import { useActionState } from 'react'

import {
  updateSenderPostalAddress,
  type PostalAddressState,
} from '@/app/(product)/email/actions'

/**
 * The postal address every commercial email has to carry.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ AN EMPTY VALUE BLOCKS LAUNCHING ANY CAMPAIGN, so this component must  ║
 * ║  say so BEFORE somebody builds a sequence and hits a wall at the last     ║
 * ║  step. A validation message at launch time is a worse version of this     ║
 * ║  sentence.                                                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export function SenderAddress({ address }: { address: string | null }) {
  const [state, action, pending] = useActionState<PostalAddressState, FormData>(
    updateSenderPostalAddress,
    { ok: null },
  )

  return (
    <section className="rounded-clay border border-line bg-surface p-5">
      <h3 className="text-sm font-semibold tracking-[-0.01em] text-ink">Business postal address</h3>
      <p className="mt-1 text-sm text-ink-subtle">
        Added to the footer of every campaign email, next to the unsubscribe link. Commercial
        email is required by law to include one, and mail without it is far more likely to be
        marked as spam.
      </p>

      <form action={action} className="mt-4 max-w-lg">
        <label htmlFor="senderPostalAddress" className="sr-only">
          Business postal address
        </label>
        <textarea
          id="senderPostalAddress"
          name="senderPostalAddress"
          rows={3}
          /*
           * ⚠️ `defaultValue`, and the form is uncontrolled. React 19's
           * useActionState RESETS uncontrolled fields when the action returns —
           * which bit this codebase twice already. It is correct here only
           * because a successful save revalidates and re-renders with the new
           * `address` prop, so the reset lands on the value just saved.
           */
          defaultValue={address ?? ''}
          placeholder={'Outlio Ltd\n9 Example Street\nSpringfield, IL 62704'}
          className="w-full rounded-clay border border-line bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:shadow-[0_0_0_2px_var(--focus)]"
        />

        <div className="mt-3 flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-clay bg-ink px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? 'Saving…' : 'Save address'}
          </button>

          {/* Live region: the outcome has to reach a screen reader too. */}
          <p aria-live="polite" className="text-sm">
            {state.ok === true ? (
              <span className="text-success">{state.message}</span>
            ) : state.ok === false ? (
              <span className="text-danger">{state.error}</span>
            ) : null}
          </p>
        </div>
      </form>

      {!address ? (
        <p className="mt-3 text-sm text-warning">
          Until this is set, campaigns cannot be launched.
        </p>
      ) : null}
    </section>
  )
}
