import 'server-only'

/**
 * Flow test mode — a dry run that writes nothing.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ NO HANDLER IS EVER INVOKED HERE. NOT ONE.                            ║
 * ║                                                                           ║
 * ║  The brief asks for external and destructive steps to be simulated. This  ║
 * ║  goes further and simulates ALL of them, including the "reversible" ones  ║
 * ║  like CREATE_TASK — because a dry run that quietly creates three tasks    ║
 * ║  and assigns an owner is not a dry run, and the person who clicked "test" ║
 * ║  now has real work to undo by hand.                                       ║
 * ║                                                                           ║
 * ║  The ONLY database reads are the contact's facts, so branches can be      ║
 * ║  evaluated against reality rather than guessed at. Nothing is written.    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { ACTION_TYPES, type FlowDefinition, type FlowStep } from '@/lib/flows/definition'
import { evaluateBranch, gatherFacts } from '@/lib/flows/engine'

export type SimulatedStep = {
  stepId: string
  label: string
  type: 'ACTION' | 'WAIT' | 'BRANCH'
  /** What would happen, in a sentence someone can check. */
  outcome: string
  /** True when a real run would have written something here. */
  simulated: boolean
  /** Credits a real run would have spent at this step. */
  credits: number
  /** For a branch: the arm that was taken, given this contact's real facts. */
  branchTaken?: 'yes' | 'no'
}

export type SimulationResult = {
  steps: SimulatedStep[]
  /** Total credits a real run would spend, so nobody is surprised by a bill. */
  creditsWouldSpend: number
  /** Set when the walk stopped early. */
  stoppedBecause: string | null
}

/**
 * ⚠️ BOUNDED. A flow may legitimately loop back to an earlier step, and the
 * engine's own loop protection does not apply here because nothing is being
 * recorded. Without a ceiling a cyclic definition would spin forever inside a
 * request.
 */
const MAX_SIMULATED_STEPS = 100

function describeAction(step: Extract<FlowStep, { type: 'ACTION' }>): string {
  const meta = ACTION_TYPES[step.action]
  const parts = [`Would run ${step.action}`]

  if (!meta.reversible) {
    // Named explicitly: these are the steps that reach outside Outlio and
    // cannot be taken back once a real run makes them.
    parts.push('(external — cannot be undone once it really runs)')
  }
  if (meta.costsCredits) parts.push('(spends credits)')

  return parts.join(' ')
}

function describeWait(step: Extract<FlowStep, { type: 'WAIT' }>): string {
  if (step.hours === 0) return 'No wait — continues immediately'
  if (step.hours < 24) return `Would wait ${step.hours} hour${step.hours === 1 ? '' : 's'}`
  const days = Math.round(step.hours / 24)
  return `Would wait ${days} day${days === 1 ? '' : 's'}`
}

/**
 * Walks a definition as if it were running, against one real contact.
 *
 * ⚠️ WAITS ARE REPORTED AND STEPPED OVER. A dry run that honoured a three-day
 * wait would tell someone nothing for three days, which defeats the purpose —
 * so the wait is described and the walk continues past it.
 */
export async function simulateFlow(input: {
  workspaceId: string
  definition: FlowDefinition
  contactId: string | null
}): Promise<SimulationResult> {
  const byId = new Map(input.definition.steps.map((s) => [s.id, s]))
  const steps: SimulatedStep[] = []
  let creditsWouldSpend = 0
  let stoppedBecause: string | null = null

  /*
   * The contact's real values, so a branch resolves the way it actually would.
   * A simulation that guessed at conditions would be worse than none: it would
   * confidently show the wrong path.
   */
  const facts = await gatherFacts(input.workspaceId, input.contactId)

  let currentId: string | null = input.definition.entryStepId
  let guard = 0

  while (currentId) {
    if (guard >= MAX_SIMULATED_STEPS) {
      stoppedBecause = `Stopped after ${MAX_SIMULATED_STEPS} steps — this definition may loop.`
      break
    }
    guard += 1

    const step: FlowStep | undefined = byId.get(currentId)
    if (!step) {
      // The publish validator prevents this, but a draft can be mid-edit.
      stoppedBecause = `Step “${currentId}” does not exist in this definition.`
      break
    }

    if (step.type === 'ACTION') {
      const meta = ACTION_TYPES[step.action]
      // Reported, never charged — nothing is spent by a simulation.
      const credits = meta.costsCredits ? 1 : 0
      creditsWouldSpend += credits

      steps.push({
        stepId: step.id,
        label: step.label ?? step.action,
        type: 'ACTION',
        outcome: describeAction(step),
        simulated: true,
        credits,
      })
      currentId = step.next
      continue
    }

    if (step.type === 'WAIT') {
      steps.push({
        stepId: step.id,
        label: step.label ?? 'Wait',
        type: 'WAIT',
        outcome: describeWait(step),
        // A wait writes nothing even in a real run, so it is not "simulated"
        // in the sense the others are — it is genuinely skipped.
        simulated: false,
        credits: 0,
      })
      currentId = step.next
      continue
    }

    const taken = evaluateBranch(step.conditions, step.match, facts)

    steps.push({
      stepId: step.id,
      label: step.label ?? 'Condition',
      type: 'BRANCH',
      outcome: taken
        ? 'Conditions met — takes the YES path'
        : 'Conditions not met — takes the NO path',
      simulated: false,
      credits: 0,
      branchTaken: taken ? 'yes' : 'no',
    })

    currentId = taken ? step.onTrue : step.onFalse
  }

  return { steps, creditsWouldSpend, stoppedBecause }
}
