/**
 * Compiling and validating a campaign's workflow — Phase 20.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ LINEAR, BY OWNER DECISION 2026-09-15 ("OK ship lenier").              ║
 * ║                                                                           ║
 * ║  The reference tool has an "Add a condition" tab; Outlio does not, yet.    ║
 * ║  A linear list is an ordering; a branching one is a graph with edges,      ║
 * ║  cycle detection, and a real answer for what happens to somebody standing  ║
 * ║  on a branch that gets rewritten. Linear → branching is additive. The      ║
 * ║  reverse is not, which is why this is the order.                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ AN ENROLMENT POINTS AT A STEP ID, NEVER AT A POSITION NUMBER, and this is
 * the single most load-bearing decision in the file.
 *
 * Positions renumber. The owner's requirement is that "people can enter at diff
 * points", so a campaign routinely has people standing on several different
 * steps at once — and inserting a step in the middle of that shifts every
 * position after it. If the pointer were the integer 5, inserting at 3 would
 * silently move everybody standing on old-5 onto a step they had already done,
 * or one they had never seen. Nobody would get an error. They would just get the
 * wrong message, from a real account, to a real stranger.
 *
 * With an id pointer, inserting and reordering are safe by construction, and the
 * one genuinely dangerous edit — deleting the step somebody is standing on —
 * becomes a case this module can detect and refuse by name.
 */
import {
  isStepAction,
  producesTask,
  STEPS,
  type StepAction,
} from '@/lib/linkedin/steps'
import { validateBody } from '@/lib/linkedin/placeholders'

/*
 * ⚠️ IMPORTED, NOT REDECLARED. `enroll.ts` already enforces this exact number on
 * a human's text; a second `300` here would be a second thing to change when
 * LinkedIn moves it, and the two would disagree in the direction that lets an
 * overlong note through.
 */
import { CONNECTION_NOTE_LIMIT } from '@/lib/linkedin/render'

export type WorkflowStep = {
  id: string
  position: number
  action: StepAction
  /** Operator-authored copy. Null for steps that hold none. */
  body: string | null
  /**
   * Days to hold, for `WAIT` only.
   *
   * ⚠️ DAYS RATHER THAN AN INTERVAL, matching the reference the owner supplied
   * ("Wait for 1 day", editable). Hours would be a knob that invites a sequence
   * tight enough to look automated — which, on an account Outlio does not own
   * and cannot protect, is the customer's risk to carry, not one to make easy.
   */
  waitDays: number | null
  /**
   * Per-action settings (0139). Only `ADD_TAG` uses it today: `{ tag }`.
   *
   * ⚠️ IT EXISTS BECAUSE `ADD_TAG` COULD NOT SAY WHICH TAG. 0137 gave every step
   * a `body` and then correctly forbade one on `ADD_TAG` — a tag name is not a
   * message — which left the step with nowhere to record its only setting. The
   * walker then had nothing to execute: it would either skip silently, so a step
   * the customer added does nothing forever, or fail at run time on a workflow
   * that had passed validation.
   */
  config: Record<string, unknown>
}

export type WorkflowProblem = {
  /** The step it belongs to, or null for a whole-workflow problem. */
  stepId: string | null
  message: string
}

export type CompiledWorkflow =
  | { ok: true; steps: readonly WorkflowStep[] }
  | { ok: false; problems: readonly WorkflowProblem[] }

/**
 * ⚠️ A CAP, BECAUSE AN UNCAPPED WORKFLOW IS AN UNCAPPED TASK GENERATOR. Forty
 * steps against a stage-2 account at ten invitations a day is months of work for
 * one person; the number matters less than the existence of a ceiling that
 * cannot be reached by holding down a button.
 */
export const MAX_STEPS = 40

/** The longest a single wait may be, in days. */
export const MAX_WAIT_DAYS = 90

/**
 * Validates a workflow the customer just built.
 *
 * ⚠️ IT RETURNS EVERY PROBLEM, NOT THE FIRST. The builder marks bad cards
 * in place; stopping at one would have somebody fix a DM, save, and only then
 * learn the wait three cards down is also wrong.
 */
export function compileWorkflow(steps: readonly WorkflowStep[]): CompiledWorkflow {
  const problems: WorkflowProblem[] = []

  if (steps.length === 0) {
    problems.push({
      stepId: null,
      message: 'Add at least one step before saving this workflow.',
    })
  }

  if (steps.length > MAX_STEPS) {
    problems.push({
      stepId: null,
      message: `A workflow can have at most ${MAX_STEPS} steps — this one has ${steps.length}.`,
    })
  }

  const ordered = [...steps].sort((a, b) => a.position - b.position)

  for (const [index, step] of ordered.entries()) {
    /*
     * ⚠️ THE GUARD COMES BEFORE THE LOOKUP, NOT AFTER IT. `step.action` is typed
     * `StepAction`, but this data arrives from a form and a database row, and a
     * type annotation is a claim rather than a check. Indexing `STEPS` with an
     * action from an older schema version yields `undefined`, and the next line
     * to touch `spec.label` throws inside a validator whose whole job is to
     * return problems rather than raise them.
     */
    if (!isStepAction(step.action)) {
      problems.push({ stepId: step.id, message: `"${String(step.action)}" is not an action Outlio knows.` })
      continue
    }

    const spec = STEPS[step.action]

    // ---- waits ----------------------------------------------------------
    if (step.action === 'WAIT') {
      if (step.waitDays === null || !Number.isInteger(step.waitDays) || step.waitDays < 1) {
        problems.push({ stepId: step.id, message: 'A wait has to be at least one whole day.' })
      } else if (step.waitDays > MAX_WAIT_DAYS) {
        problems.push({
          stepId: step.id,
          message: `A single wait cannot be longer than ${MAX_WAIT_DAYS} days.`,
        })
      }

      /*
       * ⚠️ A TRAILING WAIT IS REFUSED RATHER THAN IGNORED. It holds people in
       * the campaign, doing nothing, until somebody notices — and what they see
       * meanwhile is an enrolment that is neither finished nor working, which is
       * exactly the "silent partial" 0135 exists to keep visible.
       */
      if (index === ordered.length - 1) {
        problems.push({
          stepId: step.id,
          message: 'A workflow cannot end on a wait — there is nothing after it to release.',
        })
      }

      /*
       * ⚠️ A LEADING WAIT IS ALLOWED, and it is not an oversight. "Add them
       * today, first touch on Monday" is a real thing to want, and the owner's
       * entry-point requirement makes it more so: somebody entering at step 1
       * may deliberately need to sit before the first action.
       */

      const next = ordered[index + 1]
      if (next?.action === 'WAIT') {
        problems.push({
          stepId: next.id,
          message: 'Two waits in a row — combine them into one, or put a step between them.',
        })
      }
      continue
    }

    // ---- bodies ---------------------------------------------------------
    const body = step.body?.trim() ?? ''

    if (spec.body === 'none' && body !== '') {
      /*
       * ⚠️ REFUSED, NOT DISCARDED. Somebody typed that text expecting it to be
       * used. Dropping it silently means they find out when a card arrives with
       * their comment missing, on a post they are now looking at.
       */
      problems.push({
        stepId: step.id,
        message: `"${spec.label}" carries no message — Outlio prepares nothing for this step.`,
      })
    }

    if (spec.body === 'required' && body === '') {
      problems.push({
        stepId: step.id,
        message: `Write the message for "${spec.label}" before saving.`,
      })
    }

    if (body !== '') {
      /*
       * ⚠️ THE NOTE CAP IS ENFORCED HERE AND REFUSES RATHER THAN TRUNCATES,
       * matching `enroll.ts`: "an overlong connection note is REFUSED rather
       * than cut, because a note silently clipped mid-sentence is worse than one
       * that was never sent."
       *
       * ⚠️ AND IT IS MEASURED ON THE UNRESOLVED BODY, WHICH UNDERCOUNTS.
       * `{{first_name}}` is 14 characters and "Jo" is 2, so a note that fits
       * here can still overflow for one contact with a long company name. That
       * is caught per contact at render, where the real length is knowable — this
       * check exists to catch the note that cannot fit for anybody.
       */
      if (step.action === 'CONNECTION_REQUEST' && body.length > CONNECTION_NOTE_LIMIT) {
        problems.push({
          stepId: step.id,
          message: `A connection note has to fit ${CONNECTION_NOTE_LIMIT} characters — this one is ${body.length}.`,
        })
      }

      const placeholders = validateBody(body)
      if (!placeholders.ok) {
        problems.push({
          stepId: step.id,
          message:
            placeholders.unknown.length === 1
              ? `{{${placeholders.unknown[0]}}} is not a placeholder Outlio knows.`
              : `These are not placeholders Outlio knows: ${placeholders.unknown
                  .map((name) => `{{${name}}}`)
                  .join(', ')}.`,
        })
      }
    }

    if (step.waitDays !== null) {
      problems.push({
        stepId: step.id,
        message: `"${spec.label}" is not a wait and cannot have a duration.`,
      })
    }

    // ---- per-action settings --------------------------------------------
    if (step.action === 'ADD_TAG') {
      /*
       * ⚠️ REQUIRED, BECAUSE THE ALTERNATIVE IS A STEP THAT DOES NOTHING. The
       * walker performs `ADD_TAG` itself, so an unconfigured one would either be
       * skipped — silently excluding people from whatever the tag segments — or
       * fail mid-sequence on a workflow that had already been saved as valid.
       * 0139's CHECK refuses it in the database too; this is the message a
       * person can act on.
       */
      const tag = typeof step.config.tag === 'string' ? step.config.tag.trim() : ''
      if (!tag) {
        problems.push({ stepId: step.id, message: 'Choose which tag to add.' })
      } else if (tag.length > 100) {
        problems.push({ stepId: step.id, message: 'A tag name has to be under 100 characters.' })
      }
    } else if (Object.keys(step.config).length > 0) {
      /*
       * ⚠️ REFUSED RATHER THAN IGNORED, matching how a `wait_days` on a message
       * step is handled. A setting sitting on an action that does not read it
       * looks meaningful to the next person and is not.
       */
      problems.push({
        stepId: step.id,
        message: `"${spec.label}" takes no settings.`,
      })
    }
  }

  /*
   * ⚠️ A WORKFLOW OF NOTHING BUT INTERNAL STEPS IS REFUSED. `ADD_TAG` and `WAIT`
   * never reach LinkedIn, so a campaign built only from them enrols people,
   * completes instantly, and reports activity that involved no outreach at all.
   *
   * ⚠️ FILTERED TO KNOWN ACTIONS FIRST — THE SAME BUG AS THE LOOP GUARD, ONE
   * LINE LOWER. The loop `continue`s past an unrecognised action, but the step
   * is still in `ordered`, so calling `producesTask` on it here indexes `STEPS`
   * with a key that is not there and throws on `.performs`. Fixing the guard
   * inside the loop did not fix this, and a test asserting only that the
   * unknown action is *reported* would still have passed — the throw happens
   * after the problem has already been pushed.
   */
  const known = ordered.filter((step) => isStepAction(step.action))
  if (known.length > 0 && !known.some((step) => producesTask(step.action))) {
    problems.push({
      stepId: null,
      message: 'This workflow never asks anyone to do anything on LinkedIn. Add at least one action.',
    })
  }

  return problems.length > 0 ? { ok: false, problems } : { ok: true, steps: ordered }
}

/**
 * The step after this one, or null at the end of the workflow.
 *
 * ⚠️ IT TAKES AN ID AND SEARCHES, RATHER THAN INDEXING BY POSITION. See the
 * banner: positions renumber under the customer's hands while people are
 * standing on them.
 *
 * ⚠️ AN UNKNOWN ID IS `'deleted'`, NOT `null`. Both mean "no next step", and
 * conflating them would have an enrolment whose step was deleted mid-flight
 * silently report as having finished the campaign — a completion nobody
 * performed. The caller has to decide what to do about it, so it has to be
 * told the difference.
 */
export function nextStep(
  steps: readonly WorkflowStep[],
  currentStepId: string,
): { kind: 'step'; step: WorkflowStep } | { kind: 'end' } | { kind: 'deleted' } {
  const ordered = [...steps].sort((a, b) => a.position - b.position)
  const index = ordered.findIndex((step) => step.id === currentStepId)
  if (index === -1) return { kind: 'deleted' }
  const next = ordered[index + 1]
  return next ? { kind: 'step', step: next } : { kind: 'end' }
}

/**
 * Whether a step may be removed, given who is standing on it.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE ONE EDIT THE ID POINTER DOES NOT MAKE SAFE.                       ║
 * ║                                                                           ║
 * ║  Inserting and reordering are harmless: everyone's pointer still names a   ║
 * ║  step that exists. Deleting the step somebody is standing on orphans them  ║
 * ║  — their pointer names a row that is gone, and `nextStep` can only say     ║
 * ║  `deleted`.                                                               ║
 * ║                                                                           ║
 * ║  So it is REFUSED, with the count, rather than resolved by guessing. The   ║
 * ║  two guesses available are both wrong for somebody: advancing them skips   ║
 * ║  a message the customer meant them to get, and ending their enrolment      ║
 * ║  drops a live conversation on the floor.                                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export function canRemoveStep(
  stepId: string,
  liveEnrollmentsOnStep: number,
): { ok: true } | { ok: false; message: string } {
  if (liveEnrollmentsOnStep === 0) return { ok: true }
  return {
    ok: false,
    message:
      liveEnrollmentsOnStep === 1
        ? 'One person is waiting on this step right now. Move them on, or end their enrolment, before deleting it.'
        : `${liveEnrollmentsOnStep} people are waiting on this step right now. Move them on, or end their enrolments, before deleting it.`,
  }
}

/** Every distinct action used, for `campaignOutcomes`. */
export function actionsIn(steps: readonly WorkflowStep[]): readonly StepAction[] {
  const seen: StepAction[] = []
  for (const step of steps) if (!seen.includes(step.action)) seen.push(step.action)
  return seen
}
