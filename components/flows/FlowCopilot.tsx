'use client'

import { useActionState } from 'react'

import { generateFlowAction, type CopilotState } from '@/app/(product)/flows/actions'

/**
 * Describe a flow; Outlio drafts it.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE COPY'S JOB IS TO SAY THAT NOTHING RUNS YET.                       ║
 * ║                                                                           ║
 * ║  A person who types "email everyone who opens twice" and sees a flow       ║
 * ║  appear can reasonably assume it is now doing that. It is not — it is a    ║
 * ║  draft, and drafts run nothing until published. Every state below says so  ║
 * ║  rather than leaving it to be inferred from the word "draft".             ║
 * ║                                                                           ║
 * ║  This is the same reason `TestFlow` spells out how it differs from "Run    ║
 * ║  now": two things that look alike and behave differently is how someone    ║
 * ║  mails a customer by accident.                                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export function FlowCopilot() {
  const [state, action, pending] = useActionState<CopilotState, FormData>(
    generateFlowAction,
    null,
  )

  return (
    <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-4">
      <h2 className="text-sm font-semibold text-ink">Describe a flow</h2>
      <p className="mt-1 text-xs text-muted">
        Outlio drafts the steps. Nothing runs until you read it and publish it.
      </p>

      <form action={action} className="mt-3 space-y-3">
        <label className="block">
          <span className="text-xs font-medium text-ink">Name</span>
          <input
            name="name"
            required
            maxLength={120}
            placeholder="Tag and assign new inbound leads"
            className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-ink">What should it do?</span>
          <textarea
            name="description"
            required
            minLength={10}
            maxLength={2000}
            rows={3}
            placeholder="When a contact is created, tag them as new and assign them to me."
            className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-medium text-cream transition-colors duration-150 hover:bg-accent-deep disabled:opacity-60"
        >
          {pending ? 'Drafting…' : 'Draft it'}
        </button>
      </form>

      {/*
        ⚠️ THE FAILURE MESSAGE IS THE COMPILER'S, NOT A GENERIC APOLOGY. It names
        the fact key that does not exist or the config that is missing, because
        the person can usually rephrase around it — "sort by seniority" fails and
        "sort by job title" works, and only the specific message tells them that.
      */}
      {state && !state.ok ? (
        <p role="alert" className="mt-3 text-xs text-danger">
          {state.error}
        </p>
      ) : null}

      {state?.ok ? (
        <div className="mt-3 rounded-[var(--radius-md)] border border-line bg-surface-muted p-3">
          <p className="text-xs font-medium text-ink">
            “{state.name}” saved as a draft. It is not running.
          </p>
          <p className="mt-1 text-xs text-muted">
            {state.definition.steps.length}{' '}
            {state.definition.steps.length === 1 ? 'step' : 'steps'}, starting from{' '}
            {state.definition.trigger.type.replace(/_/g, ' ')}.
            {/*
              ⚠️ THE SECOND ATTEMPT IS SHOWN, NOT HIDDEN. Outlio corrected itself
              once before this compiled, and a person reviewing the steps should
              know the first answer was wrong — it is a reason to read carefully,
              not a detail to tidy away.
            */}
            {state.attempts > 1 ? ' Outlio corrected itself once while drafting it.' : null}
          </p>
          <a
            href={`/flows/${state.flowId}`}
            className="mt-2 inline-block text-xs font-medium text-accent underline underline-offset-2"
          >
            Review the steps
          </a>
        </div>
      ) : null}
    </div>
  )
}
