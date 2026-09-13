'use client'

import { useActionState, useState } from 'react'

import {
  addSuppressionAction,
  removeSuppressionAction,
  type ActionState,
} from '@/app/(product)/email/actions'
import { REASON_COPY, type Suppression } from '@/lib/email/suppression-copy'
import { LocalTime } from '@/components/ui/LocalTime'

/**
 * The addresses this workspace will never email again.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE PRODUCT HONOURED OPT-OUTS AND COULD NOT SHOW THAT IT HAD.           ║
 * ║                                                                           ║
 * ║  `enqueueEmail` refuses a suppressed address — proven by mutation, since  ║
 * ║  removing that check fails five integration tests. But every write path   ║
 * ║  led somewhere no screen could read. A customer asking "did you remove    ║
 * ║  me?" got no answer, and a suppression added in error could not be undone ║
 * ║  without SQL.                                                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ PRESENTATION ONLY. Both actions assert `email.account.manage` server-side.
 */
export function SuppressionList({
  suppressions,
  total,
  search,
}: {
  suppressions: Suppression[]
  /** Every suppression in the workspace, which may exceed what is shown. */
  total: number
  /** The address the operator asked about, if any. */
  search?: string | null
}) {
  const shown = suppressions.length
  const truncated = !search && total > shown

  return (
    <div className="space-y-4">
      <AddForm />

      {/*
        ⚠️ THE LOOKUP EXISTS BECAUSE THE LIST CANNOT ANSWER THE QUESTION. The
        question a person is actually asked is "did you remove me?", about ONE
        address, and the list stops at 500 ordered newest first — so the oldest
        suppressions, the ones most likely to be asked about, are exactly the
        ones missing. An exact lookup answers it whatever the size of the list.
      */}
      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="min-w-56 flex-1 space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            Check one address
          </span>
          <input
            type="search"
            name="suppressed"
            defaultValue={search ?? ''}
            placeholder="someone@example.com"
            className="w-full field px-3 py-2 text-sm text-ink"
          />
        </label>
        <button
          type="submit"
          className="rounded-[var(--radius-md)] border border-border-strong px-3 py-2 text-sm font-semibold text-ink transition-colors duration-150 hover:bg-surface-muted"
        >
          Check
        </button>
        {search ? (
          <a
            href="?"
            className="rounded-[var(--radius-md)] px-2 py-2 text-sm font-semibold text-muted transition-colors duration-150 hover:text-ink"
          >
            Clear
          </a>
        ) : null}
      </form>

      {/*
        ⚠️ A "NOT FOUND" HERE IS A REAL ANSWER, and it has to be unambiguous:
        somebody is about to tell a person whether they were removed. It says
        the address was checked, not merely that nothing is on screen.
      */}
      {search && shown === 0 ? (
        <p className="rounded-[var(--radius-md)] border border-border bg-surface-muted/40 px-3 py-2 text-sm text-ink">
          <span className="font-semibold">{search}</span> is not on the suppression
          list. Mail to it is not blocked by this list.
        </p>
      ) : null}

      {truncated ? (
        /*
         * ⚠️ SAYS THE LIST IS SHORT, which it did not. Ordered newest first and
         * capped, so an operator scrolling to answer "did you remove me?" about
         * somebody who opted out a year ago would have concluded, confidently,
         * that they had not.
         */
        <p className="text-xs text-warning">
          Showing the {shown} most recent of {total}. Use the check above to look
          up an address that is not listed here.
        </p>
      ) : null}

      {suppressions.length === 0 && !search ? (
        /*
         * ⚠️ SAYS WHAT AN EMPTY LIST MEANS. A blank panel reads as "this is
         * broken" or "we lost your data" — and for a compliance control, the
         * difference between "nobody has opted out" and "we are not recording
         * opt-outs" is the whole question.
         */
        <p className="rounded-[var(--radius-lg)] border border-dashed border-border bg-surface-muted/40 p-6 text-center text-sm text-muted">
          Nobody has unsubscribed or bounced yet. Addresses appear here
          automatically when someone opts out or when mail to them is rejected,
          and they are refused before anything is queued.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-[var(--radius-lg)] border border-border">
          {suppressions.map((s) => (
            <Row key={s.id} suppression={s} />
          ))}
        </ul>
      )}
    </div>
  )
}

function AddForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    addSuppressionAction,
    null,
  )

  return (
    <form action={action} className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1 space-y-1">
          <span className="block text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            Suppress an address
          </span>
          <input
            type="email"
            name="email"
            required
            // Addresses are not prose, and a spellcheck squiggle on one is noise.
            spellCheck={false}
            autoComplete="off"
            placeholder="someone@example.com"
            className="w-full min-w-0 rounded-[var(--radius-md)] border border-border bg-panel px-2.5 py-1.5 text-sm text-ink focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          />
        </label>

        <label className="flex-1 space-y-1">
          <span className="block text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            Note (optional)
          </span>
          <input
            type="text"
            name="note"
            maxLength={200}
            placeholder="Asked us to stop by phone"
            className="w-full min-w-0 rounded-[var(--radius-md)] border border-border bg-panel px-2.5 py-1.5 text-sm text-ink focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-md)] border border-border-strong bg-panel px-3 py-1.5 text-sm font-semibold text-ink transition-colors duration-150 hover:bg-surface-muted disabled:opacity-60"
        >
          {pending ? 'Adding…' : 'Suppress'}
        </button>
      </div>
      <Feedback state={state} />
    </form>
  )
}

function Row({ suppression }: { suppression: Suppression }) {
  const [confirming, setConfirming] = useState(false)
  const [state, action, pending] = useActionState<ActionState, FormData>(
    removeSuppressionAction,
    null,
  )
  const copy = REASON_COPY[suppression.reason]

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-medium text-ink">{suppression.email}</span>
        <span className="text-xs text-muted">{copy.label}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted">
          {suppression.source ?? ''}
        </span>
        <LocalTime iso={suppression.createdAt} dateOnly className="text-xs text-muted" />

        {confirming ? null : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-[var(--radius-md)] px-2 py-1 text-xs font-semibold text-danger transition-colors duration-150 hover:underline"
          >
            Remove
          </button>
        )}
      </div>

      {confirming ? (
        /*
         * ⚠️ THE CONFIRMATION IS DIFFERENT PER REASON, AND THAT IS THE POINT.
         * Un-suppressing a bounce is a delivery decision that will simply recur;
         * un-suppressing an unsubscribe is overriding a person's stated wish.
         * One generic "are you sure?" flattens the two at the moment the
         * difference matters most.
         */
        <form action={action} className="space-y-2 rounded-[var(--radius-md)] bg-surface-muted p-3">
          <input type="hidden" name="suppressionId" value={suppression.id} />
          <p className="text-sm text-ink">{copy.removal}</p>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-[var(--radius-md)] bg-danger px-3 py-1.5 text-xs font-semibold text-cream transition-opacity duration-150 hover:opacity-90 disabled:opacity-60"
            >
              {pending ? 'Removing…' : 'Remove anyway'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-[var(--radius-md)] px-2 py-1.5 text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
            >
              Keep it
            </button>
          </div>
        </form>
      ) : null}

      <Feedback state={state} />
    </li>
  )
}

function Feedback({ state }: { state: ActionState }) {
  if (!state) return null
  return (
    <p
      role="status"
      aria-live="polite"
      className={`text-xs ${state.ok ? 'text-success' : 'text-danger'}`}
    >
      {state.ok ? state.message : state.error}
    </p>
  )
}
