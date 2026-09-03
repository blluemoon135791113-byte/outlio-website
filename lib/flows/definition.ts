/**
 * What a flow IS — M7 Phase 20.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE CATALOGUE IS SPLIT: DETERMINISTIC ACTIONS ARE FREE, HUBBLE ACTIONS   ║
 * ║  COST THE CUSTOMER MONEY.                                                 ║
 * ║                                                                           ║
 * ║  The split is commercial as much as technical: a customer building a flow ║
 * ║  must be able to see, before running it on 10,000 contacts, exactly which ║
 * ║  steps will charge them. `creditBearingSteps()` answers that from a       ║
 * ║  definition alone, with no run required.                                  ║
 * ║                                                                           ║
 * ║  ⚠️ `costsCredits` IS STATED ON EVERY ACTION TYPE, not just the AI ones.  ║
 * ║  Writing `false` explicitly means anyone adding an action has to answer   ║
 * ║  the question, rather than inheriting `undefined` and quietly becoming    ║
 * ║  free.                                                                    ║
 * ║                                                                           ║
 * ║  ⚠️ EVERY `HUBBLE_*` ACTION GOES THROUGH `hubbleExecute`. None may call a ║
 * ║  model directly — that is the constitution's "never scatter LLM calls".   ║
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

  /*
   * ⚠️ EVERYTHING BELOW COSTS THE CUSTOMER MONEY. These are the only actions
   * with `costsCredits: true`, and the split is what lets the editor badge an
   * AI step differently from a free one — the brief requires exactly that
   * distinction to be visible before a flow is published.
   *
   * All of them go through the single `hubbleExecute` boundary. None may call
   * a model directly.
   */
  HUBBLE_ICP_SCORE: { costsCredits: true, reversible: true },
  HUBBLE_RESEARCH: { costsCredits: true, reversible: true },
  HUBBLE_CLASSIFY: { costsCredits: true, reversible: true },
  HUBBLE_PERSONALIZE: { costsCredits: true, reversible: true },
  HUBBLE_REPLY_DRAFT: { costsCredits: true, reversible: true },
  HUBBLE_CLASSIFY_REPLY: { costsCredits: true, reversible: true },
  HUBBLE_ACCOUNT_SUMMARY: { costsCredits: true, reversible: true },
} as const

export type ActionType = keyof typeof ACTION_TYPES

/**
 * Actions that have a handler behind them.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE CATALOGUE PROMISED 29 ACTIONS. 22 EXIST.                            ║
 * ║                                                                           ║
 * ║  ADD_TO_LIST, CREATE_OPPORTUNITY, DATE_CALC, MOVE_STAGE,                 ║
 * ║  REMOVE_FROM_LIST, TEXT_TRANSFORM and WEBHOOK are in `ACTION_TYPES`,      ║
 * ║  offered by the builder's step picker, accepted by the validator and      ║
 * ║  publishable — and `registerAllActions` registers no handler for any of   ║
 * ║  them. A flow using one publishes cleanly and dies on its first contact   ║
 * ║  with "the X action is not available yet".                                ║
 * ║                                                                           ║
 * ║  ⚠️ THIS FILE IS THE SINGLE PLACE THAT SAYS WHICH IS WHICH, and           ║
 * ║  `tests/unit/flow-action-coverage.test.ts` compares it against the real   ║
 * ║  `registerAction` calls — so implementing one, or adding a new unbacked   ║
 * ║  action, forces a decision here rather than quietly widening a promise.   ║
 * ║                                                                           ║
 * ║  Same reasoning as `lib/integrations/catalogue.ts`: an option that fails  ║
 * ║  on click is worse than an absent one, because the person retries.        ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export const UNIMPLEMENTED_ACTIONS: readonly ActionType[] = [
  /*
   * Empty as of 2026-09-04. Every action in the catalogue has a handler.
   *
   * ⚠️ KEEP THE MECHANISM EVEN THOUGH THE LIST IS EMPTY. It is what stops the
   * next action added to `ACTION_TYPES` from being offered before it works —
   * which is exactly how seven of them came to be publishable and dead.
   * `tests/unit/flow-action-coverage.test.ts` fails the moment one is added
   * without a runner.
   */
]

/** Whether a flow may actually use this action today. */
export function actionIsImplemented(type: ActionType): boolean {
  return !UNIMPLEMENTED_ACTIONS.includes(type)
}

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
 * Problems that should stop a PUBLISH but must never stop a parse.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ SEPARATE FROM `validateFlowDefinition`, AND THAT SEPARATION IS THE    ║
 * ║  WHOLE POINT.                                                             ║
 * ║                                                                           ║
 * ║  The first version of this check lived inside `validateFlowDefinition`,   ║
 * ║  which also parses definitions that are ALREADY STORED — `advanceRun`     ║
 * ║  calls it on every run to read the pinned version. Tightening the parser  ║
 * ║  therefore made previously-valid published flows fail to load, and broke  ║
 * ║  22 tests that build minimal fixtures. Retroactively invalidating stored  ║
 * ║  data is a migration, not a validation.                                   ║
 * ║                                                                           ║
 * ║  So this runs at the moment of publishing, where refusing is cheap and    ║
 * ║  the author is present to fix it.                                         ║
 * ║                                                                           ║
 * ║  WHY IT EXISTS: observed in production, a published flow whose            ║
 * ║  ASSIGN_OWNER step had `userId: ""`. It published, triggered on a real    ║
 * ║  contact, and failed at step one with "this step has no person configured ║
 * ║  to assign to" — a correct message nobody was going to read, because the  ║
 * ║  only place it appeared was a failed run.                                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * Returns the problems; the caller decides whether to refuse or warn.
 */
/**
 * Stamps the publisher's send authority onto every SEND_EMAIL step.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ NOTHING SET `actorAuthorized`, SO NO FLOW COULD EVER SEND MAIL.      ║
 * ║                                                                           ║
 * ║  `sendEmail` reads `config.actorAuthorized === true` and the gate fails   ║
 * ║  closed, refusing with "this flow runs as someone who is not allowed to   ║
 * ║  send email". The key was read in one place, typed in another, and        ║
 * ║  WRITTEN NOWHERE — so every send step refused at condition one.           ║
 * ║                                                                           ║
 * ║  ⚠️ THIS IS SET SERVER-SIDE AND IS DELIBERATELY NOT AN EDITOR FIELD.      ║
 * ║  A checkbox reading "I am allowed to send" is self-certification: anyone  ║
 * ║  who can open the builder could tick it, which is precisely the thing the ║
 * ║  gate exists to prevent. Authority is a fact about the PUBLISHER, checked ║
 * ║  against the permission catalogue at the moment of publishing, and it is  ║
 * ║  re-stamped on every publish so revoking someone's access takes effect on ║
 * ║  the next version rather than being frozen in at version one.             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export function stampSendAuthority(
  definition: FlowDefinition,
  publisherMaySend: boolean,
): FlowDefinition {
  return {
    ...definition,
    steps: definition.steps.map((step) =>
      step.type === 'ACTION' && step.action === 'SEND_EMAIL'
        ? { ...step, config: { ...step.config, actorAuthorized: publisherMaySend } }
        : step,
    ),
  }
}

/**
 * Stamps whose credit allowance every AI step draws on.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ NOTHING SET `userId`, SO EVERY HUBBLE STEP REFUSED.                  ║
 * ║                                                                           ║
 * ║  `hubbleHandler` reads `config.userId` and fails with NO_BILLING_USER —   ║
 * ║  "this AI step has nobody to bill" — when it is absent. Nothing in the    ║
 * ║  product wrote it. Third instance of the same shape as `actorAuthorized`  ║
 * ║  and the claim query: a required key read in one place and written in     ║
 * ║  none, so the whole feature refused politely and nobody could tell why.   ║
 * ║                                                                           ║
 * ║  ⚠️ THE PUBLISHER, NOT A PICKER — AND THAT IS A SPENDING DECISION.        ║
 * ║  Credits are user-scoped (Ledger KI11). A dropdown here would let one     ║
 * ║  member point a 10,000-contact flow at a colleague's allowance and spend  ║
 * ║  it without their knowledge. The handler's own comment says the spender   ║
 * ║  is "the flow's OWNER", so the publisher it is — shown in the editor, not ║
 * ║  chosen there.                                                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export function stampBillingUser(
  definition: FlowDefinition,
  publisherUserId: string | null,
): FlowDefinition {
  return {
    ...definition,
    steps: definition.steps.map((step) =>
      step.type === 'ACTION' && actionCostsCredits(step.action)
        ? { ...step, config: { ...step.config, userId: publisherUserId ?? '' } }
        : step,
    ),
  }
}

/** Whether a definition spends credits at all. */
export function definitionSpendsCredits(definition: FlowDefinition): boolean {
  return definition.steps.some(
    (step) => step.type === 'ACTION' && actionCostsCredits(step.action),
  )
}

/** Whether a definition sends mail at all — so the check is only applied when it matters. */
export function definitionSendsEmail(definition: FlowDefinition): boolean {
  return definition.steps.some(
    (step) => step.type === 'ACTION' && step.action === 'SEND_EMAIL',
  )
}

export function publishProblems(definition: FlowDefinition): string[] {
  const problems: string[] = []

  for (const step of definition.steps) {
    if (step.type !== 'ACTION') continue

    const required = REQUIRED_ACTION_CONFIG[step.action]
    if (!required) continue

    for (const key of required) {
      const value = (step.config as Record<string, unknown>)[key]
      const missing =
        value === undefined ||
        value === null ||
        (typeof value === 'string' && value.trim() === '') ||
        (Array.isArray(value) && value.length === 0)

      if (missing) {
        const name = step.label?.trim() || step.id
        problems.push(`“${name}” needs ${key} set before this flow can be published.`)
      }
    }
  }

  return problems
}

/**
 * Config keys an action cannot run without.
 *
 * ⚠️ EVERY ENTRY MIRRORS A `fail('NO_…')` GUARD IN THE HANDLER, and the key
 * names are read from those handlers rather than guessed — `ADD_TAG` reads
 * `config.tag`, not `config.name`, so validating "name" here would block a
 * correct flow while still letting the broken one through.
 *
 * ⚠️ ABSENT MEANS "NO REQUIRED CONFIG", WHICH IS THE SAFE DIRECTION. A missing
 * entry can only fail to catch a bad publish; a wrong entry would refuse a
 * good one. `tests/unit/flow-required-config.test.ts` keeps the two in step.
 */
const REQUIRED_ACTION_CONFIG: Partial<Record<string, readonly string[]>> = {
  ASSIGN_OWNER: ['userId'],
  ROUND_ROBIN: ['userIds'],
  CREATE_TASK: ['title'],
  ADD_TAG: ['tag'],
  REMOVE_TAG: ['tag'],
  ENROLL_SEQUENCE: ['campaignId'],
  REMOVE_SEQUENCE: ['campaignId'],
  PAUSE_SEQUENCE: ['campaignId'],
  RESUME_SEQUENCE: ['campaignId'],
  // Both, because `sendEmail` refuses on either being blank.
  SEND_EMAIL: ['accountId', 'subject', 'body'],
  /*
   * `field` only. `value` may legitimately be null — that is how a flow CLEARS
   * a field — and the missing-check below treats null as absent, so requiring
   * it would make clearing unpublishable.
   */
  UPDATE_FIELD: ['field'],
  // Implemented 2026-09-04; each refuses without these at run time.
  ADD_TO_LIST: ['listId'],
  REMOVE_FROM_LIST: ['listId'],
  CREATE_OPPORTUNITY: ['pipelineId', 'title'],
  MOVE_STAGE: ['stageId'],
  WEBHOOK: ['url'],
  /*
   * Both compute a value and hand it to the engine to store, so `storeAs` is
   * required: without it the step runs, works, and throws the answer away.
   */
  DATE_CALC: ['storeAs'],
  TEXT_TRANSFORM: ['operation', 'storeAs'],
  /*
   * Every AI step needs somebody to bill. Stamped from the publisher in
   * `publishFlow` BEFORE this check runs — listed here so a future publish
   * path that forgets to stamp is refused rather than shipping a flow that
   * fails with NO_BILLING_USER on its first contact.
   */
  HUBBLE_ICP_SCORE: ['userId'],
  HUBBLE_RESEARCH: ['userId'],
  HUBBLE_CLASSIFY: ['userId'],
  HUBBLE_PERSONALIZE: ['userId'],
  HUBBLE_REPLY_DRAFT: ['userId'],
  HUBBLE_CLASSIFY_REPLY: ['userId'],
  HUBBLE_ACCOUNT_SUMMARY: ['userId'],
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
