'use client'

import { useActionState, useState } from 'react'

import {
  enrollContactAction,
  type EnrollActionState,
} from '@/app/(product)/linkedin/enroll-actions'

const INITIAL: EnrollActionState = null

export type SenderChoice = { id: string; label: string }

/**
 * Start a LinkedIn sequence for this contact.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ IT ASKS FOR THE NOTE RATHER THAN PRETENDING TO KNOW ONE.              ║
 * ║                                                                           ║
 * ║  With honest evidence, `buildLinkedInContext` fills a greeting and the    ║
 * ║  customer's own topic — and almost never a verified relationship or       ║
 * ║  responsibility, because Outlio does not hold either. §4.9's answer to     ║
 * ║  that is a manual rewrite, not a plausible sentence.                      ║
 * ║                                                                           ║
 * ║  So the note field is offered up front, described as optional, and the     ║
 * ║  refusal names which fact was missing. A form that hid it and then said    ║
 * ║  "not enough detail" would be technically honest and practically useless.  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export function EnrollContact({
  contactId,
  senders,
}: {
  contactId: string
  senders: SenderChoice[]
}) {
  const [state, action, pending] = useActionState(enrollContactAction, INITIAL)
  const [open, setOpen] = useState(false)

  if (senders.length === 0) {
    return (
      <p className="text-sm text-muted">
        Link a LinkedIn account in settings before starting a sequence.
      </p>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-semibold text-ink underline decoration-border underline-offset-4 transition-opacity duration-150 hover:opacity-80"
      >
        Start a LinkedIn sequence…
      </button>
    )
  }

  return (
    <form action={action} className="space-y-3 rounded-[var(--radius-lg)] border border-border bg-surface-muted/40 p-4">
      <input type="hidden" name="contactId" value={contactId} />

      <label className="block space-y-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          Send from
        </span>
        <select name="senderId" className="w-full field px-3 py-2 text-sm text-ink">
          {senders.map((sender) => (
            <option key={sender.id} value={sender.id}>
              {sender.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          What is this about?
        </span>
        <input
          name="topic"
          maxLength={200}
          placeholder="helping SDR teams book more qualified calls"
          className="w-full field px-3 py-2 text-sm text-ink"
        />
        {/*
          ⚠️ THE CUSTOMER'S OWN WORDS, AND THE ONLY THING THAT FILLS `topic`.
          §4.9 marks it required at publication and nothing may stand in for it —
          it is the one sentence in the message that is a claim about the
          customer's own business rather than about the stranger.
        */}
        <span className="block text-xs text-muted">
          Your words, not ours. It goes into the message as written.
        </span>
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          Connection note (optional)
        </span>
        <textarea
          name="manualBody"
          rows={3}
          maxLength={300}
          placeholder="Leave blank to use the drafted note, if there is enough verified detail."
          className="w-full field px-3 py-2 text-sm leading-relaxed text-ink"
        />
        <span className="block text-xs text-muted">
          Outlio only drafts one when it has a verified fact to ground it in —
          usually it does not, and writing it yourself is the normal path.
        </span>
      </label>

      <Feedback state={state} />

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-md)] bg-accent px-3 py-2 text-sm font-semibold text-cream shadow-[var(--shadow-button)] transition-[background-color,transform] duration-150 hover:bg-accent-deep active:scale-[0.98] disabled:opacity-60"
        >
          {pending ? 'Adding…' : 'Add to sequence'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-[var(--radius-md)] border border-border px-3 py-2 text-sm font-semibold text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

function Feedback({ state }: { state: EnrollActionState }) {
  if (!state) return null
  return (
    <p
      role="alert"
      className={`rounded-[var(--radius-md)] px-3 py-2 text-sm ${
        state.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'
      }`}
    >
      {state.ok ? state.message : state.error}
    </p>
  )
}
