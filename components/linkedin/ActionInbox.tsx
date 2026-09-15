'use client'

import { useActionState, useState } from 'react'

import {
  allowedOutcomes,
  requiresReason,
  type TaskKind,
  type TaskOutcome,
} from '@/lib/linkedin/outcomes'
import {
  recordOutcomeAction,
  releaseTaskAction,
  type InboxActionState,
} from '@/app/(product)/linkedin/actions'
import type { InboxTask } from '@/lib/linkedin/tasks'

const INITIAL: InboxActionState = null

/**
 * ⚠️ WORDS FOR WHAT THE PERSON DID, NOT THE ENUM. `REQUEST_MARKED_SENT` is a
 * database value; "I sent the request" is what somebody clicks. The distinction
 * matters most on `OUTCOME_UNKNOWN`, where the honest label is the one that
 * makes an operator willing to choose it instead of guessing.
 */
const OUTCOME_LABEL: Record<TaskOutcome, string> = {
  REQUEST_MARKED_SENT: 'I sent the request',
  MESSAGE_MARKED_SENT: 'I sent the message',
  PROFILE_REVIEW_RECORDED: 'I reviewed the profile',
  SKIPPED: 'Skip this one',
  FAILED: 'I could not do it',
  OUTCOME_UNKNOWN: 'Not sure whether it went',
  /*
   * ⚠️ "I engaged with the post" COVERS BOTH LIKING AND COMMENTING, matching the
   * single `ENGAGEMENT_RECORDED` outcome. The card above already says which of
   * the two was asked for, so a label naming one of them would contradict the
   * card on half of these tasks.
   */
  ENGAGEMENT_RECORDED: 'I engaged with the post',
}

const KIND_LABEL: Record<TaskKind, string> = {
  REVIEW_PROFILE: 'Review profile',
  CONNECTION_REQUEST: 'Connection request',
  DIRECT_MESSAGE: 'Message',
  INMAIL: 'InMail',
  LIKE_POST: 'Like recent post',
  COMMENT_POST: 'Comment on recent post',
}

export function ActionInbox({ tasks }: { tasks: InboxTask[] }) {
  if (tasks.length === 0) {
    return (
      <div className="clay p-6">
        <h3 className="text-sm font-semibold text-ink">Nothing waiting</h3>
        <p className="mt-1 text-sm text-muted">
          Tasks appear here when a contact is enrolled in a LinkedIn sequence.
        </p>
      </div>
    )
  }

  return (
    <ul className="space-y-3">
      {tasks.map((task) => (
        <li key={task.id}>
          <TaskCard task={task} />
        </li>
      ))}
    </ul>
  )
}

function TaskCard({ task }: { task: InboxTask }) {
  const [releaseState, release, releasing] = useActionState(releaseTaskAction, INITIAL)
  const [outcomeState, record, recording] = useActionState(recordOutcomeAction, INITIAL)
  const [outcome, setOutcome] = useState<TaskOutcome | ''>('')

  const needsReason = outcome !== '' && requiresReason(outcome)

  return (
    <article className="clay space-y-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">
            {task.contactName ?? 'Unnamed contact'}
          </h3>
          <p className="mt-0.5 text-xs text-muted">{KIND_LABEL[task.kind]}</p>
        </div>
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
          {task.state === 'PENDING' ? 'Held' : 'Ready'}
        </span>
      </div>

      {task.body ? (
        <p className="whitespace-pre-wrap rounded-[var(--radius-md)] bg-surface-muted px-3 py-2 text-sm leading-relaxed text-ink">
          {task.body}
        </p>
      ) : null}

      {task.state === 'PENDING' ? (
        <form action={release} className="space-y-2">
          <input type="hidden" name="taskId" value={task.id} />
          {/*
            ⚠️ SAYS WHAT "HELD" MEANS. §4.13 holds a task whose approval is
            stale, whose account is warned, or that nobody has checked the
            thread for. A card that just sits there with no explanation reads as
            a broken queue.
          */}
          <p className="text-xs text-muted">
            Held until it passes its checks — the contact has not changed, the
            account is healthy, and there is budget left today.
          </p>
          <Feedback state={releaseState} />
          <button
            type="submit"
            disabled={releasing}
            className="rounded-[var(--radius-md)] bg-accent px-3 py-2 text-sm font-semibold text-cream shadow-[var(--shadow-button)] transition-[background-color,transform] duration-150 hover:bg-accent-deep active:scale-[0.98] disabled:opacity-60"
          >
            {releasing ? 'Checking…' : 'Check and release'}
          </button>
        </form>
      ) : (
        <form action={record} className="space-y-2">
          <input type="hidden" name="taskId" value={task.id} />

          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              What happened?
            </span>
            {/*
              ⚠️ ONLY OUTCOMES, NEVER OBSERVATIONS. §4.13: "'Mark request sent'
              cannot mark acceptance." `allowedOutcomes` is the same predicate
              the server validates with, so this list cannot offer something the
              action would refuse — and an Observation is not in that type at
              all, so it cannot appear here by accident.
            */}
            <select
              name="outcome"
              value={outcome}
              onChange={(event) => setOutcome(event.target.value as TaskOutcome | '')}
              className="w-full field px-3 py-2 text-sm text-ink"
            >
              <option value="">Choose…</option>
              {allowedOutcomes(task.kind).map((value) => (
                <option key={value} value={value}>
                  {OUTCOME_LABEL[value]}
                </option>
              ))}
            </select>
          </label>

          {needsReason ? (
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                Why — the next person will read this
              </span>
              <input name="reason" maxLength={500} className="w-full field px-3 py-2 text-sm text-ink" />
            </label>
          ) : null}

          <Feedback state={outcomeState} />

          <button
            type="submit"
            disabled={recording || outcome === ''}
            className="rounded-[var(--radius-md)] bg-accent px-3 py-2 text-sm font-semibold text-cream shadow-[var(--shadow-button)] transition-[background-color,transform] duration-150 hover:bg-accent-deep active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {recording ? 'Recording…' : 'Record result'}
          </button>
        </form>
      )}
    </article>
  )
}

function Feedback({ state }: { state: InboxActionState }) {
  if (!state) return null
  return (
    <p
      role="alert"
      className={`rounded-[var(--radius-md)] px-3 py-2 text-xs ${
        state.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'
      }`}
    >
      {state.ok ? state.message : state.error}
    </p>
  )
}
