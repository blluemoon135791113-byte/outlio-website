'use client'

import { useActionState, useState } from 'react'

import {
  saveWorkflowAction,
  type WorkflowActionState,
} from '@/app/(product)/linkedin/campaigns/workflow-actions'
import { PLACEHOLDERS, PLACEHOLDER_SPECS } from '@/lib/linkedin/placeholders'
import { STEPS, STEP_ACTIONS, type StepAction } from '@/lib/linkedin/steps'
import { Button } from '@/components/ui/Button'
import { EmptyState, FormMessage } from '@/components/ui/Feedback'
import { Input, Textarea } from '@/components/ui/Field'
import { MAX_STEPS, MAX_WAIT_DAYS } from '@/lib/linkedin/workflow'

/**
 * The card the customer is editing. `id` absent = not saved yet.
 *
 * ⚠️ A CLIENT-SIDE `key` SEPARATE FROM `id`. React needs a stable identity for
 * a list item that can be reordered, and a new card has no database id yet —
 * keying on the array index makes React reuse the wrong textarea's DOM node
 * when a card above it is deleted, so the text the operator typed appears to
 * jump to a different step.
 */
type Card = {
  key: string
  id?: string
  action: StepAction
  body: string
  waitDays: number | null
  /** Per-action settings (0139). Only `ADD_TAG` reads one, as `tag`. */
  config: Record<string, unknown>
}

export type WorkflowBuilderProps = {
  campaignId: string
  initial: {
    id: string
    action: StepAction
    body: string | null
    waitDays: number | null
    config: Record<string, unknown>
  }[]
  /** How many live enrollments are standing on each step id. */
  standingOn: Record<string, number>
  /** Total people in the campaign, for the header card. */
  contactCount: number
}

let counter = 0
const nextKey = () => `card-${++counter}`

/**
 * The campaign workflow builder — Phase 20.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ IT SAYS WHO PERFORMS EACH STEP, ON EVERY CARD, ALWAYS.                ║
 * ║                                                                           ║
 * ║  This screen looks exactly like the ones that DO send — an ordered list    ║
 * ║  of "Send LinkedIn message" cards with waits between them. That            ║
 * ║  resemblance is the whole risk: the owner's complaint that produced this   ║
 * ║  phase was "does that really send a message or something like that? There  ║
 * ║  is no automation which I can see."                                        ║
 * ║                                                                           ║
 * ║  So `performs` is not a tooltip and not help text at the bottom of the     ║
 * ║  page. It is on the face of every card, in the place a competitor would    ║
 * ║  put "automated".                                                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export function WorkflowBuilder({
  campaignId,
  initial,
  standingOn,
  contactCount,
}: WorkflowBuilderProps) {
  const [cards, setCards] = useState<Card[]>(() =>
    initial.map((step) => ({
      key: nextKey(),
      id: step.id,
      action: step.action,
      body: step.body ?? '',
      waitDays: step.waitDays,
      config: step.config,
    })),
  )
  /** Where the "Add an action" sheet will insert, or null when it is closed. */
  const [insertAt, setInsertAt] = useState<number | null>(null)
  const [state, action, pending] = useActionState<WorkflowActionState, FormData>(
    saveWorkflowAction,
    null,
  )

  const problems = state && !state.ok ? (state.problems ?? []) : []
  const problemFor = (card: Card) =>
    card.id ? problems.find((p) => p.stepId === card.id)?.message : undefined
  const generalProblems = problems.filter((p) => p.stepId === null)

  function add(actionName: StepAction) {
    const card: Card = {
      key: nextKey(),
      action: actionName,
      body: '',
      waitDays: actionName === 'WAIT' ? 1 : null,
      config: {},
    }
    setCards((current) => {
      const at = insertAt ?? current.length
      return [...current.slice(0, at), card, ...current.slice(at)]
    })
    setInsertAt(null)
  }

  const payload = JSON.stringify({
    campaignId,
    steps: cards.map((card) => ({
      id: card.id,
      action: card.action,
      body: STEPS[card.action].body === 'none' ? null : card.body.trim() || null,
      waitDays: card.action === 'WAIT' ? card.waitDays : null,
      /*
       * ⚠️ SENT ONLY FOR `ADD_TAG`. 0139's `config_shape` CHECK refuses a
       * non-empty config on any other action, so forwarding a stale one left
       * behind by switching a card's action would fail the save with a
       * database error rather than a sentence.
       */
      config: card.action === 'ADD_TAG' ? card.config : {},
    })),
  })

  return (
    <div className="space-y-4">
      {/*
        ⚠️ THE HEADER STATES THE PRODUCT'S ONE HARD FACT BEFORE ANYTHING ELSE.
        Not a disclaimer at the bottom — the first thing read on the screen that
        most looks like automation.
      */}
      <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold text-ink">Workflow</h2>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
          The steps below become tasks for <strong className="font-semibold text-ink">you</strong>,
          in order, with the waits you set. Outlio never signs in to LinkedIn and never sends
          anything — it decides who, when, and what to say, and you perform each action yourself.
        </p>
      </div>

      <form action={action} className="space-y-3">
        <input type="hidden" name="payload" value={payload} />

        {/* ---- the start card, matching the reference ---- */}
        <div className="rounded-[var(--radius-lg)] border border-line bg-surface-muted px-4 py-3 text-center">
          <p className="text-sm font-medium text-ink">Start the campaign</p>
          <p className="text-xs text-muted">
            {contactCount === 1 ? '1 person' : `${contactCount} people`}
          </p>
        </div>

        <Inserter onClick={() => setInsertAt(0)} disabled={cards.length >= MAX_STEPS} />

        {cards.length === 0 ? (
          /*
            ⚠️ A DESIGNED EMPTY STATE, NOT AN EMPTY DIV. Required on every screen
            by the design rules, and this one carries the sentence that stops a
            reader assuming the campaign is already doing something.
          */
          <EmptyState
            title="No steps yet"
            body="Add the first action you want to take. Nobody is contacted until you build the workflow and perform the tasks it creates."
          />
        ) : null}

        {cards.map((card, index) => (
          <div key={card.key}>
            <StepCard
              card={card}
              problem={problemFor(card)}
              standing={card.id ? (standingOn[card.id] ?? 0) : 0}
              onChange={(patch) =>
                setCards((current) =>
                  current.map((c) => (c.key === card.key ? { ...c, ...patch } : c)),
                )
              }
              onRemove={() =>
                setCards((current) => current.filter((c) => c.key !== card.key))
              }
            />
            <Inserter
              onClick={() => setInsertAt(index + 1)}
              disabled={cards.length >= MAX_STEPS}
            />
          </div>
        ))}

        {generalProblems.length > 0 ? (
          <ul role="alert" className="space-y-1">
            {generalProblems.map((problem, i) => (
              <li key={i} className="text-xs text-danger">
                {problem.message}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button type="submit" pending={pending} pendingLabel="Saving…">
            Save workflow
          </Button>

          {state && !state.ok ? <FormMessage tone="error">{state.error}</FormMessage> : null}
          {state?.ok ? <FormMessage tone="success">{state.message}</FormMessage> : null}
        </div>
      </form>

      {insertAt !== null ? (
        <ActionSheet onPick={add} onClose={() => setInsertAt(null)} />
      ) : null}
    </div>
  )
}

/**
 * The "+" between cards.
 *
 * ⚠️ A REAL BUTTON WITH A LABEL, not a clickable div with a plus glyph. It is
 * the only way to add a step, so a keyboard or screen-reader user who cannot
 * reach it cannot use this screen at all.
 */
function Inserter({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <div className="flex justify-center py-1">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={disabled ? `A workflow can have at most ${MAX_STEPS} steps.` : undefined}
        className="flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface text-muted transition-colors duration-150 hover:border-accent hover:text-accent disabled:opacity-40"
      >
        <span aria-hidden>+</span>
        <span className="sr-only">Add a step here</span>
      </button>
    </div>
  )
}

function StepCard({
  card,
  problem,
  standing,
  onChange,
  onRemove,
}: {
  card: Card
  problem: string | undefined
  standing: number
  onChange: (patch: Partial<Card>) => void
  onRemove: () => void
}) {
  const spec = STEPS[card.action]

  if (card.action === 'WAIT') {
    return (
      <div
        className={`rounded-[var(--radius-lg)] border bg-surface px-4 py-3 ${
          problem ? 'border-danger' : 'border-line'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-ink">
            <span className="font-medium">Wait for</span>
            {/*
              ⚠️ A NUMBER INPUT, NOT THE REFERENCE'S − / + PAIR ALONE. Steppers
              cost one click per day, so "wait 30 days" is thirty clicks; typing
              is the fast path and the input's own controls still give the
              nudge. `min`/`max` mirror the database CHECK rather than replacing
              it — this is a hint, and 0137 is the rule.
            */}
            <Input
              type="number"
              min={1}
              max={MAX_WAIT_DAYS}
              value={card.waitDays ?? 1}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10)
                onChange({ waitDays: Number.isNaN(parsed) ? null : parsed })
              }}
              /* ⚠️ `tabular-nums` so the field does not resize between 1 and 30. */
              className="w-16 px-2 py-1 tabular-nums"
            />
            <span className="text-muted">{card.waitDays === 1 ? 'day' : 'days'}</span>
          </label>
          <RemoveButton onRemove={onRemove} standing={standing} label="wait" />
        </div>
        {problem ? (
          <FormMessage tone="error" className="mt-2">
            {problem}
          </FormMessage>
        ) : null}
      </div>
    )
  }

  return (
    <div
      className={`rounded-[var(--radius-lg)] border bg-surface p-4 ${
        problem ? 'border-danger' : 'border-line'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{spec.label}</p>
          {/*
            ⚠️ THE SENTENCE THIS WHOLE SCREEN EXISTS TO CARRY. See the component
            banner: on a card that looks identical to an automated one, "You do
            this" is the difference between the product being understood and the
            owner's original complaint.
          */}
          <p className="mt-0.5 text-xs text-muted">
            <span className="font-medium text-ink">You do this:</span> {spec.performs}
          </p>
        </div>
        <RemoveButton onRemove={onRemove} standing={standing} label="step" />
      </div>

      {/*
        ⚠️ THE ZERO-BUDGET WARNING IS ON THE CARD, AT THE MOMENT OF ADDING IT.
        §4.10 caps `engagement` at 0/day at every warm-up stage, so these two
        steps produce tasks that never release until somebody deliberately
        raises it. Discovered later that is an unexplained empty inbox; said
        here it is a decision.
      */}
      {card.action === 'LIKE_POST' || card.action === 'COMMENT_POST' ? (
        <p className="mt-2 rounded-[var(--radius-md)] bg-surface-muted px-3 py-2 text-xs leading-relaxed text-warning">
          Engagement actions are capped at zero per day on every warm-up stage, so this step
          will not release a task until that cap is raised for the sending account.
        </p>
      ) : null}

      {/*
        ⚠️ `ADD_TAG` IS THE ONE STEP WITH A SETTING, AND IT IS REQUIRED.
        0139 exists because the step previously had nowhere to say WHICH tag,
        which left the walker with nothing to execute — it would either skip
        silently, so a step the customer added does nothing forever, or fail
        mid-sequence on a workflow that had already saved as valid.

        A free-text field rather than a picker of existing tags, deliberately:
        `ensureTagAttached` creates the tag if it does not exist, and a picker
        would mean building a segment before you can route anybody into it.
        The name is normalised, so "Hot Lead" and "hot lead" cannot become two
        tags that render identically.
      */}
      {card.action === 'ADD_TAG' ? (
        <div className="mt-3">
          <label className="block">
            <span className="text-xs font-medium text-ink">Tag to add</span>
            <Input
              value={typeof card.config.tag === 'string' ? card.config.tag : ''}
              onChange={(event) => onChange({ config: { tag: event.target.value } })}
              maxLength={100}
              placeholder="Replied — warm"
              className="mt-1 sm:max-w-xs"
            />
          </label>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">
            Created if it does not exist yet. Nothing reaches LinkedIn — this changes the
            contact record in Outlio.
          </p>
        </div>
      ) : spec.body === 'none' ? (
        <p className="mt-2 text-xs leading-relaxed text-muted">{spec.note}</p>
      ) : (
        <div className="mt-3">
          <label className="block">
            <span className="text-xs font-medium text-ink">
              {card.action === 'CONNECTION_REQUEST' ? 'Your note' : 'Your message'}
              {spec.body === 'optional' ? (
                <span className="font-normal text-muted"> — optional</span>
              ) : null}
            </span>
            <Textarea
              value={card.body}
              onChange={(event) => onChange({ body: event.target.value })}
              maxLength={8_000}
              placeholder={
                card.action === 'CONNECTION_REQUEST'
                  ? 'Hi {{first_name}} — saw your work at {{company}} and wanted to connect.'
                  : 'Write what you want to say. Use the placeholders below to personalise it.'
              }
              className="mt-1"
            />
          </label>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted">Insert:</span>
            {PLACEHOLDERS.map((name) => (
              <button
                key={name}
                type="button"
                title={PLACEHOLDER_SPECS[name].note}
                onClick={() => onChange({ body: `${card.body}{{${name}}}` })}
                className="rounded-full border border-line px-2 py-0.5 text-xs text-muted transition-colors duration-150 hover:border-accent hover:text-accent"
              >
                {PLACEHOLDER_SPECS[name].label}
              </button>
            ))}
          </div>

          {/*
            ⚠️ THE REFUSAL IS STATED WHILE THEY WRITE, not discovered per contact
            later. `resolveBody` blocks a task whose placeholder has no value,
            which is rule 4 applied to their own sentence — and an operator who
            knows that writes differently.
          */}
          <p className="mt-1.5 text-xs leading-relaxed text-muted">
            A placeholder Outlio cannot fill for someone will hold that person&apos;s task back
            rather than send a gap.
          </p>
        </div>
      )}

      {problem ? (
        <FormMessage tone="error" className="mt-2">
          {problem}
        </FormMessage>
      ) : null}
    </div>
  )
}

/**
 * ⚠️ IT WARNS BEFORE THE DELETE RATHER THAN AFTER THE FAILURE. 0137's
 * `on delete restrict` is what actually protects the enrolment, and this count
 * is a stale read — but a customer who can see that four people are standing on
 * a card is not the customer who presses save and gets a refusal.
 */
function RemoveButton({
  onRemove,
  standing,
  label,
}: {
  onRemove: () => void
  standing: number
  label: string
}) {
  return (
    <div className="flex items-center gap-2">
      {standing > 0 ? (
        <span className="text-xs text-warning">
          {standing === 1 ? '1 person here' : `${standing} people here`}
        </span>
      ) : null}
      <Button variant="danger" onClick={onRemove}>
        Remove<span className="sr-only"> this {label}</span>
      </Button>
    </div>
  )
}

/**
 * The action picker.
 *
 * ⚠️ IT GROUPS BY WHO ACTS, WHICH THE REFERENCE'S FLAT GRID DOES NOT. In a tool
 * that sends for you the distinction does not exist. Here it is the single most
 * important thing about each action, so "Wait" and "Add a tag" — the two that
 * need nothing from the operator — are not sitting in the same undifferentiated
 * grid as six that do.
 */
function ActionSheet({
  onPick,
  onClose,
}: {
  onPick: (action: StepAction) => void
  onClose: () => void
}) {
  const manual = STEP_ACTIONS.filter((name) => STEPS[name].performs !== null)
  const internal = STEP_ACTIONS.filter((name) => STEPS[name].performs === null)

  return (
    <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">Add a step</h3>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>

      <p className="mt-2 text-xs font-medium text-muted">You perform these in LinkedIn</p>
      <div className="mt-1.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {manual.map((name) => (
          <ActionOption key={name} name={name} onPick={onPick} />
        ))}
      </div>

      <p className="mt-4 text-xs font-medium text-muted">These run inside Outlio</p>
      <div className="mt-1.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {internal.map((name) => (
          <ActionOption key={name} name={name} onPick={onPick} />
        ))}
      </div>
    </div>
  )
}

function ActionOption({
  name,
  onPick,
}: {
  name: StepAction
  onPick: (action: StepAction) => void
}) {
  const spec = STEPS[name]
  return (
    <button
      type="button"
      onClick={() => onPick(name)}
      className="rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2.5 text-left transition-colors duration-150 hover:border-accent"
    >
      <span className="block text-sm font-medium text-ink">{spec.label}</span>
      <span className="mt-0.5 block text-xs leading-relaxed text-muted">{spec.note}</span>
    </button>
  )
}
