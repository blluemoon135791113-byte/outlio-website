'use client'

import { useActionState, useState } from 'react'

import { simulateFlowAction, type SimulateState } from '@/app/(product)/flows/actions'

/**
 * Flow test mode — R9.
 *
 * ⚠️ THE DIFFERENCE FROM "RUN NOW" IS THE WHOLE POINT, and the copy has to
 * carry it. This writes nothing and calls no handler; "Run now" does everything
 * for real. Two buttons that look alike and behave differently is how someone
 * mails a customer by accident.
 */
export function TestFlow({
  flowId,
  contacts,
}: {
  flowId: string
  contacts: { id: string; name: string }[]
}) {
  const [state, action, pending] = useActionState<SimulateState, FormData>(
    simulateFlowAction,
    null,
  )
  const [contactId, setContactId] = useState('')

  return (
    <div className="space-y-3">
      <form action={action} className="space-y-3">
        <input type="hidden" name="flowId" value={flowId} />

        <label className="block max-w-sm">
          <span className="text-xs font-medium text-ink">Test against</span>
          <select
            name="contactId"
            value={contactId}
            onChange={(event) => setContactId(event.target.value)}
            className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
          >
            {/*
              A contact is optional: without one the branches fall to their
              NO arms, which still shows the shape of the flow.
            */}
            <option value="">No contact — just walk the steps</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-[var(--radius-md)] bg-surface-muted px-3 py-1.5 text-xs font-medium text-ink transition-colors duration-150 hover:opacity-90 disabled:opacity-60"
          >
            {pending ? 'Walking…' : 'Test run'}
          </button>
          <span className="text-xs text-muted">
            Nothing is created, sent or changed.
          </span>
        </div>
      </form>

      {state && !state.ok ? (
        <p className="text-xs text-danger">{state.error}</p>
      ) : null}

      {state?.ok ? (
        <div className="space-y-2 border-t border-line pt-3">
          <p className="text-xs text-muted">
            Against <span className="font-medium text-ink">{state.contactName}</span>
            {state.result.creditsWouldSpend > 0 ? (
              <>
                {' · '}
                {/*
                  ⚠️ SHOWN BEFORE ANYONE PUBLISHES. Finding out a flow costs
                  credits per contact is worth far more here than on an invoice.
                */}
                <span className="font-medium text-warning">
                  a real run would spend {state.result.creditsWouldSpend} credit
                  {state.result.creditsWouldSpend === 1 ? '' : 's'} per contact
                </span>
              </>
            ) : null}
          </p>

          <ol className="space-y-1.5">
            {state.result.steps.map((step, index) => (
              <li key={`${step.stepId}-${index}`} className="flex gap-2 text-sm">
                <span aria-hidden className="text-muted">
                  {step.type === 'BRANCH' ? (step.branchTaken === 'yes' ? '✓' : '✗') : '·'}
                </span>
                <span className="min-w-0">
                  <span className="text-ink">{step.label}</span>
                  <span className="ml-2 text-xs text-muted">{step.outcome}</span>
                </span>
              </li>
            ))}
          </ol>

          {state.result.stoppedBecause ? (
            <p className="rounded-[var(--radius-md)] bg-warning-soft px-3 py-2 text-xs text-warning">
              {state.result.stoppedBecause}
            </p>
          ) : null}

          {state.result.steps.length === 0 ? (
            <p className="text-sm text-muted">This flow has no steps to walk.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
