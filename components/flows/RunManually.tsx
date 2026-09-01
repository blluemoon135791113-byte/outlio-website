'use client'

import { useActionState, useState } from 'react'

import { runFlowManually, type ManualRunState } from '@/app/(product)/flows/actions'

/**
 * Starting a manually-triggered flow — R8.
 *
 * ⚠️ THE COPY HERE IS THE SAFETY FEATURE. Every action runs for real: tasks are
 * created, owners assigned, notifications sent. Anything that read like "test"
 * or "try" would invite someone to point it at a real contact expecting a
 * rehearsal, and there is no rehearsal — the brief's simulated test mode is
 * still deferred.
 */
export function RunManually({
  flowId,
  contacts,
}: {
  flowId: string
  contacts: { id: string; name: string }[]
}) {
  const [state, action, pending] = useActionState<ManualRunState, FormData>(
    runFlowManually,
    null,
  )
  const [contactId, setContactId] = useState('')

  if (contacts.length === 0) {
    return (
      <p className="text-sm text-muted">
        Add a contact first — a manual run needs someone to run against.
      </p>
    )
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="flowId" value={flowId} />

      <label className="block max-w-sm">
        <span className="text-xs font-medium text-ink">Run against</span>
        <select
          name="contactId"
          value={contactId}
          onChange={(event) => setContactId(event.target.value)}
          required
          className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
        >
          <option value="">Choose a contact…</option>
          {contacts.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.name}
            </option>
          ))}
        </select>
      </label>

      {/*
        Said before the click, not after. Someone about to start a flow against
        a real person needs to know it is not a dry run while they can still
        change their mind.
      */}
      <p className="rounded-[var(--radius-md)] bg-warning-soft px-3 py-2 text-xs text-warning">
        This runs for real. Tasks, assignments and notifications all happen.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || !contactId}
          className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Starting…' : 'Run now'}
        </button>

        {state ? (
          <p className={`text-xs ${state.ok ? 'text-success' : 'text-danger'}`}>
            {state.ok ? state.message : state.error}
          </p>
        ) : null}
      </div>
    </form>
  )
}
