'use client'

import { useActionState, useState } from 'react'

import {
  addNoteAction,
  assignContactAction,
  requestReassignmentAction,
  type ContactActionState,
} from '@/lib/crm/contact-actions'
import type { CollisionReport } from '@/lib/crm/collision'

const INITIAL: ContactActionState = { status: 'idle' }

const inputClass =
  'w-full field px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-none'
const buttonClass =
  'rounded-[var(--radius-md)] bg-accent px-3 py-2 text-sm font-semibold text-cream shadow-[var(--shadow-button)] transition-[background-color,transform] duration-150 hover:bg-accent-deep active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60'
const ghostClass =
  'rounded-[var(--radius-md)] border border-border px-3 py-2 text-sm font-semibold text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-ink'

function Feedback({ state }: { state: ContactActionState }) {
  if (state.status === 'idle') return null
  const error = state.status === 'error'
  return (
    <p
      role="alert"
      className={`rounded-[var(--radius-md)] px-3 py-2 text-sm ${
        error ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'
      }`}
    >
      {state.message}
    </p>
  )
}

/**
 * Owner picker, with the collision guard in front of it.
 *
 * ⚠️ THE WARNING IS NOT DECORATION. The server refuses an assignment that has
 * not acknowledged a live collision, and refuses outright when the workspace
 * requires approval. This component only decides what to SHOW; it cannot
 * decide what is allowed.
 */
export function AssignOwner({
  contactId,
  currentOwnerUserId,
  members,
  collision,
}: {
  contactId: string
  currentOwnerUserId: string | null
  members: { userId: string; name: string }[]
  collision: CollisionReport
}) {
  const [state, action] = useActionState(assignContactAction, INITIAL)
  const [acknowledged, setAcknowledged] = useState(false)

  const party = collision.contact
  const blocked = collision.blocked

  return (
    <section className="clay space-y-3 p-4">
      <h3 className="text-sm font-semibold text-ink">Owner</h3>

      {party ? (
        <div
          className={`rounded-[var(--radius-md)] px-3 py-2.5 text-sm ${
            blocked ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'
          }`}
        >
          <p className="font-semibold">
            {party.ownerName ?? 'A teammate'} is already working this contact
          </p>
          <p className="mt-1 leading-relaxed">
            Last activity {party.lastActivityType?.toLowerCase().replace(/_/g, ' ')} on{' '}
            {new Date(party.lastActivityAt!).toLocaleDateString()}
            {party.openOpportunities > 0
              ? ` · ${party.openOpportunities} open ${party.openOpportunities === 1 ? 'deal' : 'deals'}`
              : ''}
          </p>
          {blocked ? (
            <p className="mt-1.5 leading-relaxed">
              This workspace requires approval before reassigning. Ask the owner below.
            </p>
          ) : null}
        </div>
      ) : null}

      {collision.company ? (
        <div className="rounded-[var(--radius-md)] bg-warning-soft px-3 py-2.5 text-sm text-warning">
          <p className="font-semibold">
            Colleagues are working {collision.company.companyName ?? 'this company'}
          </p>
          <ul className="mt-1 space-y-0.5 leading-relaxed">
            {collision.company.parties.map((p) => (
              <li key={p.contactId}>
                {p.ownerName ?? 'A teammate'} — {p.contactName ?? 'a contact'}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Feedback state={state} />

      {!blocked ? (
        <form action={action} className="space-y-3">
          <input type="hidden" name="contact_id" value={contactId} />
          <input type="hidden" name="acknowledged" value={String(acknowledged)} />

          <label className="block">
            <span className="sr-only">Assign to</span>
            <select name="owner_user_id" defaultValue={currentOwnerUserId ?? ''} className={inputClass}>
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>

          {party ? (
            <>
              <label className="flex items-start gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  className="mt-0.5"
                />
                <span>I have checked with {party.ownerName ?? 'the current owner'}</span>
              </label>
              <label className="block">
                <span className="sr-only">Why are you taking this over?</span>
                <input
                  name="override_reason"
                  placeholder="Why are you taking this over? (recorded)"
                  maxLength={200}
                  className={inputClass}
                />
              </label>
            </>
          ) : null}

          <button type="submit" className={buttonClass} disabled={Boolean(party) && !acknowledged}>
            Save owner
          </button>
        </form>
      ) : null}

      {party ? <RequestReassignment contactId={contactId} /> : null}
    </section>
  )
}

function RequestReassignment({ contactId }: { contactId: string }) {
  const [state, action] = useActionState(requestReassignmentAction, INITIAL)
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={ghostClass}>
        Request this contact
      </button>
    )
  }

  return (
    <form action={action} className="space-y-2 border-t border-border pt-3">
      <input type="hidden" name="contact_id" value={contactId} />
      <Feedback state={state} />
      <label className="block">
        <span className="sr-only">Why do you want this contact?</span>
        <input name="note" placeholder="Why do you want it?" maxLength={280} className={inputClass} />
      </label>
      <button type="submit" className={ghostClass}>
        Send request
      </button>
    </form>
  )
}

export function AddNote({ contactId }: { contactId: string }) {
  const [state, action] = useActionState(addNoteAction, INITIAL)

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="contact_id" value={contactId} />
      <Feedback state={state} />
      <label className="block">
        <span className="sr-only">Add a note</span>
        <textarea
          name="body"
          rows={3}
          required
          maxLength={20000}
          placeholder="What happened?"
          className={inputClass}
        />
      </label>
      <button type="submit" className={buttonClass}>
        Add note
      </button>
    </form>
  )
}
