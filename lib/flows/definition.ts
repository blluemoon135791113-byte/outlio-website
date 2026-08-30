/**
 * What a flow IS — M7 Phase 20.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  EVERY ACTION HERE IS DETERMINISTIC AND COSTS ZERO CREDITS.               ║
 * ║                                                                           ║
 * ║  The brief lists the free actions explicitly, and the reason is           ║
 * ║  commercial as much as technical: a customer building a flow must be able ║
 * ║  to see, before they run it on 10,000 contacts, exactly which steps will  ║
 * ║  charge them. Hubble steps arrive in Phase 22 through ONE boundary and    ║
 * ║  are badged separately — they are never mixed into this list.             ║
 * ║                                                                           ║
 * ║  ⚠️ `costsCredits` IS ON EVERY ACTION TYPE, not just the AI ones. Listing ║
 * ║  it as `false` explicitly means anyone adding an action has to state the  ║
 * ║  answer, rather than inheriting `undefined` and quietly becoming free.    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { z } from 'zod'

/** Everything that can start a flow. */
export const TRIGGER_TYPES = [
  'contact_created',
  'contact_assigned',
  'list_added',
  'batch_added',
  'campaign_enrolled',
  'stage_changed',
  'task_completed',
  'email_sent',
  'email_replied',
  'email_bounced',
  'email_unsubscribed',
  'call_booked',
  'opportunity_won',
  'no_activity',
  'webhook',
  'scheduled',
  'manual',
] as const

export type TriggerType = (typeof TRIGGER_TYPES)[number]

/**
 * The deterministic action catalogue. Zero credits, every one.
 *
 * ⚠️ `SEND_EMAIL` IS FREE BUT GUARDED. Sending costs no AI credits, but it is
 * the only action here with an irreversible external effect, so Phase 21 gates
 * it on six conditions (provider connected, recipient eligible, not
 * suppressed, limit available, provider healthy, user authorized) before it
 * may run.
 */
export const ACTION_TYPES = {
  ASSIGN_OWNER: { costsCredits: false, reversible: true },
  ROUND_ROBIN: { costsCredits: false, reversible: true },
  CREATE_TASK: { costsCredits: false, reversible: true },
  MOVE_STAGE: { costsCredits: false, reversible: true },
  UPDATE_FIELD: { costsCredits: false, reversible: true },
  ADD_TAG: { costsCredits: false, reversible: true },
  REMOVE_TAG: { costsCredits: false, reversible: true },
  ADD_TO_LIST: { costsCredits: false, reversible: true },
  REMOVE_FROM_LIST: { costsCredits: false, reversible: true },
  CREATE_OPPORTUNITY: { costsCredits: false, reversible: true },
  CREATE_ACTIVITY: { costsCredits: false, reversible: true },
  NOTIFY: { costsCredits: false, reversible: false },
  DEDUPE_CHECK: { costsCredits: false, reversible: true },
  DATE_CALC: { costsCredits: false, reversible: true },
  TEXT_TRANSFORM: { costsCredits: false, reversible: true },
  WEBHOOK: { costsCredits: false, reversible: false },
  // Sequence controls.
  ENROLL_SEQUENCE: { costsCredits: false, reversible: true },
  REMOVE_SEQUENCE: { costsCredits: false, reversible: true },
  PAUSE_SEQUENCE: { costsCredits: false, reversible: true },
  RESUME_SEQUENCE: { costsCredits: false, reversible: true },
  CREATE_EMAIL_TASK: { costsCredits: false, reversible: true },
  /** ⚠️ Irreversible: an email cannot be unsent. Guarded in Phase 21. */
  SEND_EMAIL: { costsCredits: false, reversible: false },
} as const

export type ActionType = keyof typeof ACTION_TYPES

export function actionCostsCredits(type: ActionType): boolean {
  return ACTION_TYPES[type].costsCredits
}

/** Whether an action can be undone if a later step fails. */
export function actionIsReversible(type: ActionType): boolean {
  return ACTION_TYPES[type].reversible
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const stepIdSchema = z
  .string()
  .min(1)
  .max(64)
  // Referenced by `next`/`branches`, so it must be safe to compare and print.
  .regex(/^[a-zA-Z0-9_-]+$/, 'A step id may contain only letters, numbers, _ and -.')

const conditionSchema = z.object({
  field: z.string().min(1).max(120),
  operator: z.enum([
    'equals', 'not_equals', 'contains', 'not_contains',
    'is_empty', 'is_not_empty', 'greater_than', 'less_than', 'in', 'not_in',
  ]),
  value: z.unknown().optional(),
})

const baseStep = { id: stepIdSchema, label: z.string().max(200).optional() }

/**
 * ⚠️ A WAIT IS BOUNDED. An unbounded wait is a run that never finishes and
 * never surfaces — it just sits there, and nobody notices until someone asks
 * why a contact stalled three months ago. 90 days is longer than any real
 * follow-up cadence.
 */
const MAX_WAIT_HOURS = 24 * 90

export const flowStepSchema = z.discriminatedUnion('type', [
  z.object({
    ...baseStep,
    type: z.literal('ACTION'),
    action: z.enum(Object.keys(ACTION_TYPES) as [ActionType, ...ActionType[]]),
    config: z.record(z.string(), z.unknown()).default({}),
    next: stepIdSchema.nullable().default(null),
  }),
  z.object({
    ...baseStep,
    type: z.literal('WAIT'),
    hours: z.number().int().min(0).max(MAX_WAIT_HOURS),
    next: stepIdSchema.nullable().default(null),
  }),
  z.object({
    ...baseStep,
    type: z.literal('BRANCH'),
    conditions: z.array(conditionSchema).min(1),
    /** All conditions must hold, or any of them. */
    match: z.enum(['all', 'any']).default('all'),
    onTrue: stepIdSchema.nullable().default(null),
    onFalse: stepIdSchema.nullable().default(null),
  }),
])

export type FlowStep = z.infer<typeof flowStepSchema>

export const flowDefinitionSchema = z.object({
  trigger: z.object({
    type: z.enum(TRIGGER_TYPES),
    config: z.record(z.string(), z.unknown()).default({}),
  }),
  entryStepId: stepIdSchema,
  steps: z.array(flowStepSchema).min(1).max(200),
  /**
   * ⚠️ RE-ENROLLMENT IS OFF BY DEFAULT. A contact who already ran through a
   * flow re-entering it is occasionally wanted and usually a mistake — and the
   * mistake mails someone the same sequence twice. Opt in, never out.
   */
  allowReEnrollment: z.boolean().default(false),
})

export type FlowDefinition = z.infer<typeof flowDefinitionSchema>

export class FlowDefinitionError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join(' '))
    this.name = 'FlowDefinitionError'
  }
}

/** Every step id a step can hand control to. */
function outgoing(step: FlowStep): (string | null)[] {
  if (step.type === 'BRANCH') return [step.onTrue, step.onFalse]
  return [step.next]
}

/**
 * Validates a definition BEFORE it can be published.
 *
 * ⚠️ THE GRAPH CHECKS ARE THE POINT. Zod proves each step is well-formed;
 * these prove the steps form a flow that can actually terminate. A dangling
 * `next` or a cycle passes every per-step check and then strands a run at
 * execution time, when the contact is already halfway through.
 */
export function validateFlowDefinition(input: unknown): FlowDefinition {
  const parsed = flowDefinitionSchema.safeParse(input)
  if (!parsed.success) {
    throw new FlowDefinitionError(
      parsed.error.issues.map((i) => `${i.path.join('.') || 'definition'}: ${i.message}`),
    )
  }

  const definition = parsed.data
  const problems: string[] = []
  const ids = new Set<string>()

  for (const step of definition.steps) {
    if (ids.has(step.id)) problems.push(`Two steps share the id "${step.id}".`)
    ids.add(step.id)
  }

  if (!ids.has(definition.entryStepId)) {
    problems.push(`The entry step "${definition.entryStepId}" is not one of the steps.`)
  }

  for (const step of definition.steps) {
    for (const target of outgoing(step)) {
      if (target !== null && !ids.has(target)) {
        problems.push(`Step "${step.id}" points at "${target}", which does not exist.`)
      }
    }
  }

  /*
   * ⚠️ A CYCLE WITH NO WAIT IN IT IS AN INFINITE LOOP THAT NEVER YIELDS.
   *
   * The database's loop protection catches a flow that RE-TRIGGERS itself, but
   * it cannot help with a cycle inside a single run — that would spin the
   * worker until something else killed it. A cycle containing a WAIT is
   * legitimate (a nurture loop that checks back weekly); one without is not.
   */
  const byId = new Map(definition.steps.map((s) => [s.id, s]))
  const state = new Map<string, 'visiting' | 'done'>()

  const walk = (id: string, waitsOnPath: number): void => {
    const seen = state.get(id)
    if (seen === 'done') return
    if (seen === 'visiting') {
      if (waitsOnPath === 0) {
        problems.push(
          `Steps loop back to "${id}" with no wait in between, which would run forever. Add a wait, or break the loop.`,
        )
      }
      return
    }

    state.set(id, 'visiting')
    const step = byId.get(id)
    if (step) {
      const waits = waitsOnPath + (step.type === 'WAIT' ? 1 : 0)
      for (const target of outgoing(step)) {
        if (target !== null && byId.has(target)) walk(target, waits)
      }
    }
    state.set(id, 'done')
  }

  if (ids.has(definition.entryStepId)) walk(definition.entryStepId, 0)

  // Unreachable steps are a mistake worth naming: the author thinks they
  // configured something that will never run.
  for (const step of definition.steps) {
    if (!state.has(step.id)) {
      problems.push(`Step "${step.id}" cannot be reached from the entry step.`)
    }
  }

  if (problems.length > 0) throw new FlowDefinitionError(problems)
  return definition
}

/**
 * Which steps in a definition will charge credits.
 *
 * ⚠️ ANSWERED BEFORE A FLOW RUNS, not after. The brief requires expected
 * credit usage to be shown; a customer must be able to see the cost before
 * pointing a flow at 10,000 contacts.
 */
export function creditBearingSteps(definition: FlowDefinition): string[] {
  return definition.steps
    .filter((s) => s.type === 'ACTION' && actionCostsCredits(s.action))
    .map((s) => s.id)
}
