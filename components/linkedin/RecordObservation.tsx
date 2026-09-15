'use client'

import { useActionState } from 'react'

import {
  recordObservationAction,
  type ObservationState,
} from '@/app/(product)/linkedin/enroll-actions'

/**
 * ⚠️ THESE ARE OBSERVATIONS, NEVER TASK OUTCOMES.
 *
 * The list deliberately contains nothing like "mark request sent". `outcomes.ts`
 * keeps the two vocabularies apart because collapsing them lets a result form
 * assert acceptance — and acceptance gates the first DM, so the collapse sends
 * a message into a connection that was never made.
 *
 * Every label is past tense and about the other person. "Replied", not "send
 * reply": nothing on this form performs anything in LinkedIn.
 */
const KINDS = [
  { value: 'REPLY_RECORDED', label: 'They replied' },
  { value: 'CONNECTION_ACCEPTANCE_RECORDED', label: 'They accepted the connection' },
  { value: 'MEETING_BOOKED_RECORDED', label: 'They booked a meeting' },
  { value: 'MEETING_HELD_RECORDED', label: 'The meeting happened' },
  { value: 'INBOX_REVIEW_RECORDED', label: 'I reviewed their inbox message' },
] as const

/**
 * Records something the operator saw on LinkedIn.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ IT CAN BE REFUSED, AND THE REFUSAL IS THE FEATURE.                    ║
 * ║                                                                           ║
 * ║  A reply from somebody Outlio never messaged is the shape that put 254    ║
 * ║  false `replied` rows into `email_events` — a whole mailbox counted as    ║
 * ║  prospect replies against two messages ever sent.                        ║
 * ║                                                                           ║
 * ║  So the error is written to be ACTED ON rather than dismissed: it says    ║
 * ║  Outlio has no record of contacting this person, which invites the reader ║
 * ║  to check. They may well have messaged from LinkedIn directly, and that   ║
 * ║  is worth discovering.                                                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export function RecordObservation({ contactId }: { contactId: string }) {
  const [state, action, pending] = useActionState<ObservationState, FormData>(
    recordObservationAction,
    null,
  )

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        Record what you saw happen on LinkedIn. This changes Outlio&apos;s records only — it
        performs nothing.
      </p>

      <form action={action} className="space-y-2">
        <input type="hidden" name="contactId" value={contactId} />

        <label className="block">
          <span className="sr-only">What happened</span>
          <select
            name="kind"
            defaultValue="REPLY_RECORDED"
            className="w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink [color-scheme:light]"
          >
            {KINDS.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="sr-only">Note</span>
          <input
            name="note"
            maxLength={2000}
            placeholder="Optional note — what they said"
            className="w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-md)] bg-surface-muted px-3 py-1.5 text-xs font-medium text-ink transition-colors duration-150 hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Recording…' : 'Record'}
        </button>
      </form>

      {state && !state.ok ? (
        <p role="alert" className="text-xs text-danger">
          {state.error}
        </p>
      ) : null}

      {state?.ok ? (
        /*
          ⚠️ THE FLAGGED CASE GETS THE WARNING COLOUR, NOT THE QUIET ONE. It
          succeeded, so it is not an error — but the reader should know the
          outreach underneath it was never confirmed, because that is the
          difference between a reply they can trust and one they cannot.
        */
        <p role="status" className={state.unconfirmed ? 'text-xs text-warning' : 'text-xs text-muted'}>
          {state.message}
        </p>
      ) : null}
    </div>
  )
}
