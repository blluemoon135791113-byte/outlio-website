/**
 * Turning a flow definition into something a person can edit — M7 Phase 23.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  A VERTICAL STEP LIST, NOT A DRAG-AND-DROP CANVAS.                        ║
 * ║                                                                           ║
 * ║  A canvas needs a graph library — a real dependency decision — and this   ║
 * ║  engine's shape does not call for one. A flow is a trigger, then steps in ║
 * ║  order, with branches that fork and rejoin. That is a LIST with           ║
 * ║  indentation, which is how every sequence tool people already know        ║
 * ║  presents it, and it stays legible on a phone.                            ║
 * ║                                                                           ║
 * ║  ⚠️ PURE, SO THE ORDERING RULES ARE TESTABLE. The builder UI is a thin    ║
 * ║  shell over these functions; every "can this move up?" and "what breaks   ║
 * ║  if I delete this?" is decided here, not in a component.                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import {
  actionCostsCredits,
  type ActionType,
  type FlowDefinition,
  type FlowStep,
} from '@/lib/flows/definition'

export type StepRow = {
  step: FlowStep
  /** How far to indent. Branch targets sit one level in. */
  depth: number
  /** Reached only when a branch condition holds. */
  branchLabel: 'yes' | 'no' | null
  costsCredits: boolean
}

/**
 * Lays the graph out as an ordered, indented list.
 *
 * ⚠️ FOLLOWS THE REAL EDGES rather than listing steps in array order. A
 * definition's array order is arbitrary — the engine walks `next` and
 * `onTrue`/`onFalse` — so showing the array would draw a flow that does not
 * match what runs.
 */
export function layoutSteps(definition: FlowDefinition): StepRow[] {
  const byId = new Map(definition.steps.map((s) => [s.id, s]))
  const rows: StepRow[] = []
  const seen = new Set<string>()

  const walk = (id: string | null, depth: number, branchLabel: StepRow['branchLabel']): void => {
    if (!id) return
    const step = byId.get(id)
    if (!step) return

    /*
     * A step reached twice — a branch rejoining, or a legitimate loop back to
     * an earlier step — is drawn once, at its first position. Drawing it twice
     * would imply it runs twice.
     */
    if (seen.has(id)) return
    seen.add(id)

    rows.push({
      step,
      depth,
      branchLabel,
      costsCredits: step.type === 'ACTION' ? actionCostsCredits(step.action) : false,
    })

    if (step.type === 'BRANCH') {
      walk(step.onTrue, depth + 1, 'yes')
      walk(step.onFalse, depth + 1, 'no')
      return
    }

    walk(step.next, depth, null)
  }

  walk(definition.entryStepId, 0, null)

  /*
   * ⚠️ UNREACHABLE STEPS ARE STILL SHOWN, at the end and flagged. Hiding them
   * would make a step someone configured silently vanish, and they would
   * assume it was deleted rather than orphaned.
   */
  for (const step of definition.steps) {
    if (seen.has(step.id)) continue
    rows.push({
      step,
      depth: 0,
      branchLabel: null,
      costsCredits: step.type === 'ACTION' ? actionCostsCredits(step.action) : false,
    })
  }

  return rows
}

/** Step ids that nothing points at, and that are not the entry. */
export function unreachableStepIds(definition: FlowDefinition): string[] {
  const reachable = new Set(layoutStepsReachable(definition))
  return definition.steps.filter((s) => !reachable.has(s.id)).map((s) => s.id)
}

function layoutStepsReachable(definition: FlowDefinition): string[] {
  const byId = new Map(definition.steps.map((s) => [s.id, s]))
  const seen = new Set<string>()

  const walk = (id: string | null): void => {
    if (!id || seen.has(id)) return
    const step = byId.get(id)
    if (!step) return
    seen.add(id)
    if (step.type === 'BRANCH') {
      walk(step.onTrue)
      walk(step.onFalse)
      return
    }
    walk(step.next)
  }

  walk(definition.entryStepId)
  return [...seen]
}

/** A step id that is unique within this definition. */
export function nextStepId(definition: FlowDefinition, prefix: string): string {
  const taken = new Set(definition.steps.map((s) => s.id))
  const base = prefix.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'step'
  if (!taken.has(base)) return base

  let n = 2
  while (taken.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

/**
 * Inserts a step immediately after another, rewiring the edge.
 *
 * ⚠️ THE PREDECESSOR'S `next` IS MOVED ONTO THE NEW STEP, not dropped. Simply
 * appending would silently cut the rest of the flow off — the commonest way a
 * builder loses work.
 */
export function insertAfter(
  definition: FlowDefinition,
  afterId: string | null,
  step: FlowStep,
): FlowDefinition {
  const steps = definition.steps.map((s) => ({ ...s }))

  /*
   * ⚠️ A BRANCH HAS NO `next` — IT HAS TWO EDGES. Writing `next` onto one
   * produces an object the schema strips on validate, so the rest of the flow
   * would silently detach: the branch would point nowhere and every step after
   * it become unreachable. The successor goes on `onTrue` instead — "the rest
   * of the flow happens if this holds" — and `onFalse` stays null, which reads
   * on the canvas as the no-path ending.
   */
  const pointAt = (candidate: FlowStep, successor: string | null): FlowStep =>
    candidate.type === 'BRANCH'
      ? ({ ...candidate, onTrue: successor, onFalse: null } as FlowStep)
      : ({ ...candidate, next: successor } as FlowStep)

  // Inserting at the top: the new step becomes the entry and points at the old.
  if (afterId === null) {
    const inserted = pointAt(step, definition.entryStepId)
    return { ...definition, entryStepId: step.id, steps: [inserted, ...steps] }
  }

  const previous = steps.find((s) => s.id === afterId)
  if (!previous) return { ...definition, steps: [...steps, step] }

  if (previous.type === 'BRANCH') {
    // A branch has two edges; appending after it goes down the "yes" side,
    // which is the one a person means by "then".
    const inserted = pointAt(step, previous.onTrue)
    previous.onTrue = step.id
    return { ...definition, steps: [...steps, inserted] }
  }

  const inserted = pointAt(step, previous.next)
  previous.next = step.id
  return { ...definition, steps: [...steps, inserted] }
}

/**
 * Removes a step and closes the gap.
 *
 * ⚠️ EVERY EDGE POINTING AT IT IS REWIRED TO WHATEVER IT POINTED AT. Deleting
 * without rewiring leaves dangling targets, which the validator would reject —
 * so the builder would produce definitions it cannot publish.
 */
export function removeStep(definition: FlowDefinition, stepId: string): FlowDefinition {
  const target = definition.steps.find((s) => s.id === stepId)
  if (!target) return definition

  // A branch has two successors and no single "after", so the yes-side is used.
  const successor = target.type === 'BRANCH' ? target.onTrue : target.next

  const steps = definition.steps
    .filter((s) => s.id !== stepId)
    .map((s) => {
      const copy = { ...s }
      if (copy.type === 'BRANCH') {
        if (copy.onTrue === stepId) copy.onTrue = successor
        if (copy.onFalse === stepId) copy.onFalse = successor
      } else if (copy.next === stepId) {
        copy.next = successor
      }
      return copy
    })

  return {
    ...definition,
    entryStepId: definition.entryStepId === stepId ? (successor ?? '') : definition.entryStepId,
    steps,
  }
}

/** Replaces one step's contents, keeping its position in the graph. */
export function updateStep(
  definition: FlowDefinition,
  stepId: string,
  patch: Partial<FlowStep>,
): FlowDefinition {
  return {
    ...definition,
    steps: definition.steps.map((s) => (s.id === stepId ? ({ ...s, ...patch } as FlowStep) : s)),
  }
}

/** A human summary of what a step does, for the collapsed row. */
export function describeStep(step: FlowStep): string {
  if (step.type === 'WAIT') {
    if (step.hours === 0) return 'Continue immediately'
    if (step.hours % 24 === 0) {
      const days = step.hours / 24
      return `Wait ${days} day${days === 1 ? '' : 's'}`
    }
    return `Wait ${step.hours} hour${step.hours === 1 ? '' : 's'}`
  }

  if (step.type === 'BRANCH') {
    const first = step.conditions[0]
    const rest = step.conditions.length - 1
    const base = first ? `If ${first.field} ${first.operator.replace(/_/g, ' ')}` : 'If'
    return rest > 0 ? `${base} and ${rest} more` : base
  }

  return ACTION_LABEL[step.action] ?? step.action
}

/**
 * ⚠️ LABELS PEOPLE WOULD USE, not enum names. `HUBBLE_ICP_SCORE` means nothing
 * to a customer; "Score against your ICP" does, and the credit badge beside it
 * carries the rest of the meaning.
 */
export const ACTION_LABEL: Record<ActionType, string> = {
  ASSIGN_OWNER: 'Assign to someone',
  ROUND_ROBIN: 'Assign round robin',
  CREATE_TASK: 'Create a task',
  MOVE_STAGE: 'Move pipeline stage',
  UPDATE_FIELD: 'Update a field',
  ADD_TAG: 'Add a tag',
  REMOVE_TAG: 'Remove a tag',
  ADD_TO_LIST: 'Add to a list',
  REMOVE_FROM_LIST: 'Remove from a list',
  CREATE_OPPORTUNITY: 'Create an opportunity',
  CREATE_ACTIVITY: 'Log an activity',
  NOTIFY: 'Notify someone',
  DEDUPE_CHECK: 'Check for duplicates',
  DATE_CALC: 'Calculate a date',
  TEXT_TRANSFORM: 'Transform text',
  WEBHOOK: 'Call a webhook',
  ENROLL_SEQUENCE: 'Enrol in a sequence',
  REMOVE_SEQUENCE: 'Remove from a sequence',
  PAUSE_SEQUENCE: 'Pause a sequence',
  RESUME_SEQUENCE: 'Resume a sequence',
  CREATE_EMAIL_TASK: 'Create an email task',
  SEND_EMAIL: 'Send an email',
  HUBBLE_ICP_SCORE: 'Score against your ICP',
  HUBBLE_RESEARCH: 'Research this company',
  HUBBLE_CLASSIFY: 'Classify',
  HUBBLE_PERSONALIZE: 'Personalise this message',
  HUBBLE_REPLY_DRAFT: 'Draft a reply',
  HUBBLE_CLASSIFY_REPLY: 'Classify this reply',
  HUBBLE_ACCOUNT_SUMMARY: 'Summarise this account',
}

export const TRIGGER_LABEL: Record<string, string> = {
  contact_created: 'A contact is created',
  contact_assigned: 'A contact is assigned',
  list_added: 'A contact joins a list',
  batch_added: 'A contact arrives from an extraction',
  campaign_enrolled: 'A contact is enrolled in a campaign',
  stage_changed: 'A deal changes stage',
  task_completed: 'A task is completed',
  email_sent: 'An email is sent',
  email_replied: 'Someone replies',
  email_bounced: 'An email bounces',
  email_unsubscribed: 'Someone unsubscribes',
  call_booked: 'A call is booked',
  opportunity_won: 'A deal is won',
  no_activity: 'Nothing has happened for a while',
  webhook: 'A webhook arrives',
  scheduled: 'On a schedule',
  manual: 'Someone starts it by hand',
}
