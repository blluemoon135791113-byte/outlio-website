'use client'

import { useActionState } from 'react'

import { replyToThread, type ReplyState } from '@/app/(product)/email/inbox/actions'

/**
 * Replying from the inbox — R11.
 *
 * ⚠️ THE ALTERNATIVE IS WORSE THAN IT LOOKS. Without this, answering means
 * leaving Outlio for a real mail client — and that reply is then invisible to
 * the CRM timeline, the campaign report, and every metric derived from them.
 * The conversation continues and the product stops knowing about it.
 */
export function ReplyComposer({
  threadId,
  toEmail,
  canThread,
}: {
  threadId: string
  toEmail: string
  canThread: boolean
}) {
  const [state, action, pending] = useActionState<ReplyState, FormData>(replyToThread, null)

  if (state?.ok) {
    return (
      <p className="rounded-[var(--radius-md)] bg-success-soft px-3 py-2 text-sm text-success">
        {state.message}
      </p>
    )
  }

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="threadId" value={threadId} />

      <label className="block">
        <span className="text-xs font-medium text-ink">Reply to {toEmail}</span>
        <textarea
          name="body"
          rows={5}
          required
          maxLength={20000}
          placeholder="Write your reply…"
          className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
        />
      </label>

      {!canThread ? (
        /*
          ⚠️ SAID PLAINLY RATHER THAN HIDDEN. This message arrived without a
          Message-ID, so the reply cannot carry In-Reply-To and may open a new
          conversation on their side. Sending anyway is right — losing the
          threading is cosmetic, losing the reply is not — but the person
          sending it should know.
        */
        <p className="text-xs text-muted">
          This message arrived without a threading header, so your reply may appear as a new
          conversation in their inbox.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Sending…' : 'Send reply'}
        </button>

        <p role="status" aria-live="polite" className="text-xs text-danger">
          {state && !state.ok ? state.error : ''}
        </p>
      </div>
    </form>
  )
}
