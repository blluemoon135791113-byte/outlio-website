'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'

import { dismissFirstRun } from '@/lib/onboarding/actions'
import type { FirstRun as FirstRunData, FirstRunStep } from '@/lib/onboarding/steps'

function Tick({ done }: { done: boolean }) {
  return done ? (
    <span
      aria-hidden
      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success text-cream"
    >
      <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M2.5 6.2 4.8 8.5 9.5 3.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  ) : (
    <span
      aria-hidden
      className="mt-0.5 h-5 w-5 shrink-0 rounded-full border border-line bg-surface"
    />
  )
}

function Step({ step, blocker }: { step: FirstRunStep; blocker: FirstRunStep | undefined }) {
  const locked = step.lockedBy !== null && !step.done

  return (
    <li className="flex gap-3 py-3">
      <Tick done={step.done} />

      <div className="min-w-0 flex-1">
        <p
          className={`text-sm font-medium ${
            step.done ? 'text-muted line-through decoration-1' : 'text-ink'
          }`}
        >
          {step.title}
        </p>

        {!step.done ? (
          <p className="mt-0.5 text-xs leading-relaxed text-muted">{step.body}</p>
        ) : null}

        {locked ? (
          /*
            The reason, not just a disabled control. "Create a campaign" greyed
            out with no explanation reads as broken; naming the prerequisite
            turns it into a next action.
          */
          <p className="mt-1.5 text-xs text-muted">
            First: <span className="font-medium text-ink">{blocker?.title ?? 'an earlier step'}</span>
          </p>
        ) : !step.done ? (
          <Link
            href={step.href}
            className="mt-2 inline-block rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90"
          >
            {step.cta}
          </Link>
        ) : null}
      </div>
    </li>
  )
}

export function FirstRun({ data, canDismiss }: { data: FirstRunData; canDismiss: boolean }) {
  const [hidden, setHidden] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (hidden) return null

  const pct = data.total === 0 ? 0 : Math.round((data.completed / data.total) * 100)

  return (
    <section aria-labelledby="first-run-heading" className="clay p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="first-run-heading" className="text-base font-semibold text-ink">
            Get set up
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            {data.completed} of {data.total} done. Nothing sends until you say so.
          </p>
        </div>

        {canDismiss ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                const result = await dismissFirstRun()
                if (result?.ok) setHidden(true)
                else setError(result?.ok === false ? result.error : 'Could not hide the checklist.')
              })
            }}
            className="rounded-[var(--radius-md)] px-2.5 py-1 text-xs font-medium text-muted transition-colors duration-150 hover:text-ink disabled:opacity-60"
          >
            {pending ? 'Hiding…' : 'Hide this'}
          </button>
        ) : null}
      </div>

      {/* Progress. `aria-hidden` because the count above already says it. */}
      <div aria-hidden className="mt-3 h-1 w-full overflow-hidden rounded-full bg-surface-muted">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-150"
          style={{ width: `${pct}%` }}
        />
      </div>

      <ul className="mt-1 divide-y divide-line">
        {data.steps.map((step) => (
          <Step
            key={step.id}
            step={step}
            blocker={data.steps.find((s) => s.id === step.lockedBy)}
          />
        ))}
      </ul>

      {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
    </section>
  )
}
