'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useState } from 'react'

import {
  bulkEnrollContactsAction,
  type BulkEnrollState,
} from '@/app/(product)/linkedin/enroll-actions'
import {
  AudiencePicker,
  type AudienceCatalogue,
} from '@/components/crm/AudiencePicker'
import type { SenderChoice } from '@/components/linkedin/EnrollContact'

/**
 * Starting a LinkedIn sequence for a group.
 *
 * ⚠️ THE SAME PICKER AND THE SAME RESOLVER AS EMAIL. Only the fields around it
 * differ — LinkedIn needs a sending account and the customer's own topic, and
 * email needs neither. See `components/crm/AudiencePicker.tsx`.
 *
 * ⚠️ ENROLLING IS NOT CONTACTING, AND THE COPY SAYS SO BEFORE THE BUTTON.
 * This queues task cards for a person to perform in LinkedIn themselves;
 * nothing here reaches linkedin.com (CLAUDE.md rule 1). Someone adding two
 * hundred people needs to know that before pressing it, not after.
 */
export function BulkEnroll({
  catalogue,
  senders,
}: {
  catalogue: AudienceCatalogue
  senders: SenderChoice[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState<BulkEnrollState, FormData>(
    bulkEnrollContactsAction,
    null,
  )

  // Kept open on success: the result names refusals that are a worklist, and
  // closing the panel would take the only copy of it off the screen.
  useEffect(() => {
    if (state?.ok) router.refresh()
  }, [state, router])

  if (senders.length === 0) {
    return (
      <section className="clay p-4">
        <h3 className="text-sm font-semibold text-ink">Start a sequence for a group</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Link a LinkedIn account in settings first — a sequence needs an account to be
          performed from.
        </p>
      </section>
    )
  }

  return (
    <section className="clay space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Start a sequence for a group</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            Queues a task card per person. Outlio performs nothing on LinkedIn — you do,
            and then record what happened.
          </p>
        </div>
        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:bg-accent-deep"
          >
            Add a group
          </button>
        ) : null}
      </div>

      {open ? (
        <form action={action} className="space-y-3 border-t border-border pt-3">
          <AudiencePicker catalogue={catalogue} />

          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
              Send from
            </span>
            <select
              name="senderId"
              required
              className="w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink [color-scheme:light]"
            >
              {senders.map((sender) => (
                <option key={sender.id} value={sender.id}>
                  {sender.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
              What is this about?
            </span>
            <input
              name="topic"
              required
              maxLength={200}
              placeholder="helping SDR teams book more qualified calls"
              className="w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
            />
            {/*
              ⚠️ THE CUSTOMER'S OWN WORDS, and the only thing that fills `topic`
              — §4.9 marks it required and nothing may stand in for it. It is
              the one sentence in the message that is a claim about the
              customer's business rather than about the stranger, which is
              exactly why it is safe to apply to a whole group when a personal
              connection note is not.
            */}
            <span className="block text-xs leading-relaxed text-muted">
              Your words, not ours. The same sentence goes to everyone in this group —
              anyone who needs a personal note instead is skipped and listed for you to
              do one by one.
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:bg-accent-deep disabled:opacity-60"
            >
              {pending ? 'Adding…' : 'Add to sequence'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
            >
              Done
            </button>
          </div>

          {state ? (
            <p
              role="status"
              aria-live="polite"
              /*
                ⚠️ `whitespace-pre-line` IS LOAD-BEARING. `summarizeEnrollment`
                returns one refusal per line, and without this they collapse
                into a wall of text — the "N need a note written by hand" line
                is a worklist and has to be readable.
              */
              className={`whitespace-pre-line rounded-[var(--radius-md)] px-3 py-2 text-xs leading-relaxed ${
                state.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'
              }`}
            >
              {state.ok ? state.message : state.error}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  )
}
