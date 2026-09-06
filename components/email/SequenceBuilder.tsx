'use client'

import { useActionState, useState } from 'react'

import {
  deleteStep,
  moveStep,
  saveStep,
  type SequenceState,
} from '@/app/(product)/email/campaigns/[id]/sequence-actions'

export type SequenceStep = {
  id: string
  stepIndex: number
  waitHours: number
  subject: string
  bodyText: string
}

/** Turns hours into the words someone actually thinks in. */
function describeWait(hours: number): string {
  if (hours === 0) return 'Sends immediately'
  if (hours < 24) return `Waits ${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.round(hours / 24)
  return `Waits ${days} day${days === 1 ? '' : 's'}`
}

function StepEditor({
  campaignId,
  step,
  isFirst,
  onDone,
}: {
  campaignId: string
  step?: SequenceStep
  isFirst: boolean
  onDone?: () => void
}) {
  const [state, action, pending] = useActionState<SequenceState, FormData>(saveStep, null)

  return (
    <form action={action} className="space-y-3 border-t border-line pt-3">
      <input type="hidden" name="campaignId" value={campaignId} />
      {step ? <input type="hidden" name="stepId" value={step.id} /> : null}

      <label className="block">
        <span className="text-xs font-medium text-ink">Subject</span>
        <input
          name="subject"
          defaultValue={step?.subject ?? ''}
          required
          maxLength={300}
          placeholder="Quick question, {{first_name}}"
          className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
        />
      </label>

      <label className="block">
        <span className="text-xs font-medium text-ink">Body</span>
        <textarea
          name="body"
          defaultValue={step?.bodyText ?? ''}
          required
          rows={6}
          maxLength={20000}
          className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 font-mono text-xs text-ink"
        />
      </label>

      {/*
        ⚠️ THE VARIABLE LIST IS SHOWN, NOT LEFT TO MEMORY. An unknown variable
        is refused on save rather than sent literally — {{firstname}} would
        otherwise go out as those exact characters to every recipient, which is
        the most visible possible failure and cannot be taken back.
      */}
      <p className="text-xs text-muted">
        Variables:{' '}
        <code className="text-ink">
          {'{{first_name}} {{last_name}} {{company_name}} {{job_title}} {{sender_name}}'}
        </code>
      </p>

      <label className="block max-w-xs">
        <span className="text-xs font-medium text-ink">
          {isFirst ? 'Wait before the first email' : 'Wait before this email'}
        </span>
        <input
          name="waitHours"
          type="number"
          min={0}
          defaultValue={step?.waitHours ?? (isFirst ? 0 : 72)}
          className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
        />
        {/*
          The wait is BEFORE the step, which is what makes step 0 with wait 0
          send immediately and inserting a step not change its neighbours.
        */}
        <span className="mt-1 block text-xs text-muted">
          Hours. {isFirst ? '0 sends as soon as the campaign launches.' : 'Counted from the previous email.'}
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Saving…' : step ? 'Save step' : 'Add step'}
        </button>

        {onDone ? (
          <button
            type="button"
            onClick={onDone}
            className="rounded-[var(--radius-md)] px-3 py-1.5 text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
          >
            Cancel
          </button>
        ) : null}

        {/* Announced as well as shown. */}
        <p
          role="status"
          aria-live="polite"
          className={`text-xs ${state?.ok ? 'text-success' : 'text-danger'}`}
        >
          {state ? (state.ok ? state.message : state.error) : ''}
        </p>
      </div>
    </form>
  )
}

function StepRow({
  campaignId,
  step,
  isFirst,
  isLast,
  canEditStructure,
}: {
  campaignId: string
  step: SequenceStep
  isFirst: boolean
  isLast: boolean
  canEditStructure: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [, removeAction] = useActionState<SequenceState, FormData>(deleteStep, null)
  const [, moveAction] = useActionState<SequenceState, FormData>(moveStep, null)

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">
            Step {step.stepIndex + 1} · {describeWait(step.waitHours)}
          </p>
          <p className="mt-0.5 truncate text-sm font-medium text-ink">{step.subject}</p>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="rounded-[var(--radius-md)] px-2 py-1 text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
          >
            {editing ? 'Close' : 'Edit'}
          </button>

          {canEditStructure ? (
            <>
              <form action={moveAction}>
                <input type="hidden" name="campaignId" value={campaignId} />
                <input type="hidden" name="stepId" value={step.id} />
                <input type="hidden" name="direction" value="up" />
                <button
                  type="submit"
                  disabled={isFirst}
                  aria-label="Move earlier"
                  className="px-1 text-xs text-muted transition-colors duration-150 hover:text-ink disabled:opacity-30"
                >
                  ▲
                </button>
              </form>

              <form action={moveAction}>
                <input type="hidden" name="campaignId" value={campaignId} />
                <input type="hidden" name="stepId" value={step.id} />
                <input type="hidden" name="direction" value="down" />
                <button
                  type="submit"
                  disabled={isLast}
                  aria-label="Move later"
                  className="px-1 text-xs text-muted transition-colors duration-150 hover:text-ink disabled:opacity-30"
                >
                  ▼
                </button>
              </form>

              <form action={removeAction}>
                <input type="hidden" name="campaignId" value={campaignId} />
                <input type="hidden" name="stepId" value={step.id} />
                <button
                  type="submit"
                  className="rounded-[var(--radius-md)] px-2 py-1 text-xs font-medium text-muted transition-colors duration-150 hover:text-danger"
                >
                  Remove
                </button>
              </form>
            </>
          ) : null}
        </div>
      </div>

      {editing ? (
        <StepEditor
          campaignId={campaignId}
          step={step}
          isFirst={isFirst}
          onDone={() => setEditing(false)}
        />
      ) : null}
    </li>
  )
}

/**
 * The sequence builder — R12.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  `email_sequence_steps` HAS EXISTED SINCE M6 AND NOTHING COULD WRITE ONE.║
 * ║                                                                           ║
 * ║  The campaign screen read the steps and offered no way to author them, so ║
 * ║  every campaign was empty and `assertLaunchable` refused it. Sending has  ║
 * ║  worked since R10; this is what there was to send.                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export function SequenceBuilder({
  campaignId,
  steps,
  status,
}: {
  campaignId: string
  steps: SequenceStep[]
  status: string
}) {
  const [adding, setAdding] = useState(false)

  /*
   * ⚠️ WORDING IS ALWAYS EDITABLE; STRUCTURE IS NOT. Fixing a typo mid-flight
   * changes the next send, which is what anyone expects. Inserting or
   * reordering renumbers steps that live enrolments are pointing at, so
   * somebody skips one or gets it twice.
   */
  const canEditStructure = status === 'draft' || status === 'paused'

  return (
    <section className="clay p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Sequence</h3>
          <p className="mt-0.5 text-sm text-muted">
            {steps.length === 0
              ? 'No steps yet. A campaign cannot launch without at least one.'
              : `${steps.length} step${steps.length === 1 ? '' : 's'}. A reply stops the rest.`}
          </p>
        </div>

        {canEditStructure && !adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90"
          >
            Add step
          </button>
        ) : null}
      </div>

      {!canEditStructure ? (
        /* Says the rule and the remedy, rather than disabling controls in silence. */
        <p className="mt-3 rounded-[var(--radius-md)] bg-surface-muted px-3 py-2 text-xs text-muted">
          This campaign is {status}. You can still fix the wording of a step — pause it to
          add, remove or reorder, so nobody mid-sequence skips an email.
        </p>
      ) : null}

      {steps.length > 0 ? (
        <ul className="mt-2 divide-y divide-line">
          {steps.map((step, index) => (
            <StepRow
              key={step.id}
              campaignId={campaignId}
              step={step}
              isFirst={index === 0}
              isLast={index === steps.length - 1}
              canEditStructure={canEditStructure}
            />
          ))}
        </ul>
      ) : null}

      {adding ? (
        <StepEditor
          campaignId={campaignId}
          isFirst={steps.length === 0}
          onDone={() => setAdding(false)}
        />
      ) : null}
    </section>
  )
}
