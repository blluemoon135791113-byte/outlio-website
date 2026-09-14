/**
 * Phase 13 — natural language in, a flow definition out, or an honest refusal.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS MODULE PROPOSES. IT DOES NOT PUBLISH.                               ║
 * ║                                                                           ║
 * ║  It returns a definition for a person to read, edit and publish through    ║
 * ║  the builder they already have. Nothing here writes `flows`,               ║
 * ║  `flow_versions`, or enrolls a contact.                                    ║
 * ║                                                                           ║
 * ║  ⚠️ AND `flows.copilot` HAS NO `flowAction`, DELIBERATELY, so this can     ║
 * ║  never become a flow STEP. A flow that generates and publishes flows is a  ║
 * ║  flow writing flows unattended, and 0093's loop protection counts RUNS,    ║
 * ║  not authored definitions — nothing in the product would stop it.         ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * §5.10's two-attempt repair loop lives here. The validation it repairs against
 * lives in `lib/flows/generated.ts`, which was built first and on purpose: if
 * the compiler and the prompt arrive together, every bad output has two
 * candidate causes and no way to tell them apart — the argument PHASE_13's
 * original deferral made about the engine, one level down.
 */
import { hubbleExecute, type HubbleTools } from '@/lib/hubble/execute'
import { FlowDefinitionError, type FlowDefinition } from '@/lib/flows/definition'
import {
  compileGeneratedDefinition,
  registrySnapshot,
  type RegistrySnapshot,
} from '@/lib/flows/generated'

/** What one pass at the model produced, kept whether it succeeded or not. */
export type CopilotAttempt = {
  attempt: number
  /** Empty when this attempt compiled. */
  problems: string[]
}

export type CopilotResult =
  | { ok: true; definition: FlowDefinition; attempts: CopilotAttempt[] }
  | {
      ok: false
      /** `refused` never reached a model; `unusable` means both attempts failed to compile. */
      reason: 'refused' | 'unusable'
      message: string
      attempts: CopilotAttempt[]
    }

/**
 * ⚠️ TWO, AND THE NUMBER IS THE DECISION. §5.10 says "two-attempt repair loop".
 *
 * One attempt wastes a correctable near-miss — models routinely omit a required
 * config key and fix it immediately when told. A third attempt is where a model
 * that has misunderstood the request starts reshaping the flow to satisfy the
 * validator rather than the person, and each pass costs real money and real
 * latency while looking like progress.
 */
const MAX_ATTEMPTS = 2

/**
 * The response shape. Mirrors `flowDefinitionSchema` — Zod still has the final
 * say, because a JSON Schema handed to a provider is a request, not a guarantee.
 */
const FLOW_SCHEMA = {
  type: 'object',
  required: ['registryVersion'],
  properties: {
    registryVersion: { type: 'integer' },
    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  ⚠️ THE MODEL NEEDS A WAY TO SAY "I CANNOT", OR IT WILL SUBSTITUTE.    ║
     * ║                                                                       ║
     * ║  The first real run passed 28 of 30 buildable cases and failed ALL TEN ║
     * ║  refusals: asked to send an SMS, to connect on LinkedIn, to charge a   ║
     * ║  customer, it built a flow every time. The compiler cannot catch that  ║
     * ║  — what it builds is VALID, it just does something else.              ║
     * ║                                                                       ║
     * ║  Two causes, both mine. The schema REQUIRED a flow, so "no" was not an ║
     * ║  expressible answer. And the prompt asked for "the closest flow",      ║
     * ║  which is substitution by instruction.                                ║
     * ║                                                                       ║
     * ║  Someone who asks for SMS and silently receives a task has been handed ║
     * ║  something they never agreed to, in a machine that will then run       ║
     * ║  unattended against real people.                                      ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     */
    cannotBuild: { type: 'string' },
    trigger: {
      type: 'object',
      required: ['type'],
      properties: { type: { type: 'string' } },
    },
    entryStepId: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'type'],
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          type: { type: 'string', enum: ['ACTION', 'WAIT', 'BRANCH'] },
          action: { type: 'string' },
          /*
           * ╔═══════════════════════════════════════════════════════════════════╗
           * ║  ⚠️ `{ type: 'object' }` WITH NO PROPERTIES MADE THE FEATURE     ║
           * ║  IMPOSSIBLE, NOT MERELY WORSE.                                    ║
           * ║                                                                   ║
           * ║  Structured output strips anything the schema does not declare, so ║
           * ║  `config` came back `{}` EVERY TIME — proven directly against the  ║
           * ║  model. `publishProblems` then refused every ACTION step for       ║
           * ║  missing its required config, on both attempts, for every prompt.  ║
           * ║                                                                   ║
           * ║  The copilot was shipped and reachable and could not produce a     ║
           * ║  publishable flow for anyone. No unit test could see it: they all  ║
           * ║  fed the compiler hand-written JSON, which is the one input the    ║
           * ║  schema never touches.                                            ║
           * ╚═══════════════════════════════════════════════════════════════════╝
           *
           * ⚠️ EVERY KEY IS LISTED BECAUSE AN OMITTED ONE IS SILENTLY DROPPED —
           * the same failure in miniature. These are the keys the handlers read
           * (`lib/flows/actions/*`) plus every entry in `REQUIRED_ACTION_CONFIG`.
           * `flow-copilot-schema.test.ts` keeps the two in step.
           */
          config: {
            type: 'object',
            properties: {
              tag: { type: 'string' },
              title: { type: 'string' },
              userId: { type: 'string' },
              userIds: { type: 'array', items: { type: 'string' } },
              campaignId: { type: 'string' },
              accountId: { type: 'string' },
              subject: { type: 'string' },
              body: { type: 'string' },
              field: { type: 'string' },
              value: { type: 'string' },
              listId: { type: 'string' },
              pipelineId: { type: 'string' },
              stageId: { type: 'string' },
              url: { type: 'string' },
              storeAs: { type: 'string' },
              operation: { type: 'string' },
              message: { type: 'string' },
              event: { type: 'string' },
              dueInHours: { type: 'integer' },
              addDays: { type: 'integer' },
              addHours: { type: 'integer' },
              valueAmount: { type: 'number' },
            },
          },
          hours: { type: 'integer' },
          conditions: {
            type: 'array',
            items: {
              type: 'object',
              required: ['field', 'operator'],
              properties: {
                field: { type: 'string' },
                operator: { type: 'string' },
                value: {},
              },
            },
          },
          match: { type: 'string', enum: ['all', 'any'] },
          next: { type: ['string', 'null'] },
          onTrue: { type: ['string', 'null'] },
          onFalse: { type: ['string', 'null'] },
        },
      },
    },
  },
} as const

/**
 * The closed world, written out for the model.
 *
 * ⚠️ KEYS AND CAPABILITY NAMES ONLY — NO CUSTOMER DATA. `LlmRequest.system`
 * says "never contains lead records", and this honours it literally: fact KEYS
 * are schema, fact VALUES are a person's details. A prompt that illustrated
 * `contact.job_title` with a real contact's title would put a lead record in a
 * third party's logs to make an example clearer.
 */
function systemPrompt(snapshot: RegistrySnapshot): string {
  return [
    'You design automation flows for a B2B CRM called Outlio.',
    'Return ONE flow definition as JSON. Nothing else.',
    '',
    '## The only things that exist',
    '',
    `Registry version: ${snapshot.version}`,
    `Triggers: ${snapshot.triggers.join(', ')}`,
    `Actions: ${snapshot.actions.join(', ')}`,
    `Comparisons: ${snapshot.operators.join(', ')}`,
    `Match modes: ${snapshot.matchModes.join(', ')}`,
    `Fact keys a BRANCH may read: ${snapshot.factKeys.join(', ')}`,
    '',
    '## Config each action must carry',
    '',
    /*
     * ⚠️ THE SINGLE BIGGEST CAUSE OF REJECTED OUTPUT. Without these lines the
     * model emitted `ADD_TAG` with an empty config and was refused by
     * `publishProblems` — on the first real eval run that was nearly every
     * case. It was being marked wrong for not knowing something unsaid.
     */
    ...Object.entries(snapshot.requiredConfig).map(
      ([action, keys]) => `- ${action} requires: ${keys.join(', ')}`,
    ),
    '',
    '## Rules',
    '',
    /*
     * ⚠️ STATED AS A REFUSAL, NOT AS A PREFERENCE. "Prefer existing actions"
     * invites a model to invent one when nothing fits, which is the case that
     * matters. Saying the request cannot be satisfied is a valid answer and the
     * model must know that.
     */
    /*
     * ⚠️ REFUSE, DO NOT APPROXIMATE. This previously read "build the closest
     * flow that uses only these, and leave out what you cannot express" — and
     * the model obediently turned "text the contact" into a task and "charge
     * the customer" into something else entirely. Every refusal case failed
     * because the instruction asked for exactly that.
     */
    '1. Use ONLY the names listed above. If the request needs something that is not listed — a different channel, a fact you were not given, an action that does not exist — do NOT approximate it with something that is. Set "cannotBuild" to one sentence naming what is missing, and return no steps.',
    '   A flow that quietly does something other than what was asked is worse than no flow.',
    '   But a missing id is NOT a missing capability: if the action exists and you simply do not know which list or person, build the step and leave that field empty.',
    /*
     * ⚠️ THE MODEL EMITS THE VERSION; THE SERVER DOES NOT STAMP IT.
     * Stamping would make the version check vacuous — it would always match,
     * and a guard that cannot fail is not a guard. Asking for it back is a
     * cheap test that the model actually read the snapshot we handed it rather
     * than answering from training data.
     */
    `2. Set "registryVersion" to exactly ${snapshot.version}.`,
    '3. Every step needs a unique "id". "entryStepId" must be one of them.',
    '4. A step that ends the flow has "next": null.',
    '5. Steps must be reachable from the entry step, and must not loop back without a WAIT in between.',
    '6. A BRANCH needs "conditions", "onTrue" and "onFalse". An ACTION needs "action" and "config".',
    /*
     * ⚠️ "LEAVE IT EMPTY" IS DELIBERATE, AND REPLACED "do not leave a required
     * field empty". The model has no way to know this workspace's list, stage,
     * pipeline or user ids — so that instruction made it DECLINE buildable
     * requests rather than draft them. An empty dropdown beside the right step
     * is a far better answer than nothing.
     */
    '7. Fill every config value you can infer from the request. You do NOT know this workspace\'s list ids, stage ids, pipeline ids or user ids — leave those empty rather than guessing or refusing; the person will pick them in the builder.',
  ].join('\n')
}

/** The repair turn: the model's own output, and exactly what was wrong with it. */
function repairPrompt(description: string, problems: string[]): string {
  return [
    `ORIGINAL REQUEST: ${description}`,
    '',
    'Your previous answer was rejected. Fix these and return the whole definition again:',
    ...problems.map((p) => `- ${p}`),
    '',
    /*
     * ⚠️ NAMED SO THE SECOND ATTEMPT DOES NOT BECOME A DIFFERENT FLOW. A model
     * told only "that was wrong" often rewrites the whole thing, and the person
     * gets something they never asked for that happens to validate.
     */
    'Change only what is needed to fix these problems. Keep the rest of the flow as it was.',
  ].join('\n')
}

/**
 * Generates a flow definition from a description.
 *
 * Never throws for a model or validation problem — both are outcomes the caller
 * renders. A thrown error here would surface as a 500 on what is a normal,
 * expected result: sometimes the request cannot be expressed as a flow.
 */
export async function generateFlowDefinition(input: {
  workspaceId: string
  userId: string
  description: string
  /**
   * Where the request came from, recorded on the `hubble_calls` row.
   *
   * ╔═══════════════════════════════════════════════════════════════════════════╗
   * ║  ⚠️ THE EVAL MUST NOT LOOK LIKE A CUSTOMER, AND IT DID.                  ║
   * ║                                                                           ║
   * ║  Every call here writes a metering row, and `flows.copilot` is priced at  ║
   * ║  0 precisely so that ledger fills with REAL usage before anyone picks a   ║
   * ║  number: "a price picked over an empty ledger is a guess."                ║
   * ║                                                                           ║
   * ║  A 40-case eval run writes 40-80 rows in a few minutes. Tagged the same   ║
   * ║  as a real draft, they are indistinguishable afterwards — so the evidence ║
   * ║  under the pricing decision would be mostly me, and nobody would be able  ║
   * ║  to tell. That is a guess wearing the costume of data.                   ║
   * ║                                                                           ║
   * ║  Defaulting to the customer path keeps the product honest by omission:    ║
   * ║  only a caller that deliberately says otherwise is excluded.             ║
   * ╚═══════════════════════════════════════════════════════════════════════════╝
   */
  source?: string
}): Promise<CopilotResult> {
  const snapshot = registrySnapshot()
  const attempts: CopilotAttempt[] = []

  const metered = await hubbleExecute(
    'flows.copilot',
    {
      workspaceId: input.workspaceId,
      userId: input.userId,
      source: input.source ?? 'http:flow-copilot',
    },
    async (tools: HubbleTools) => {
      let problems: string[] = []

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        const result = await tools.llm.generateJson({
          system: systemPrompt(snapshot),
          user:
            attempt === 1
              ? `REQUEST: ${input.description}`
              : repairPrompt(input.description, problems),
          schema: FLOW_SCHEMA as unknown as Record<string, unknown>,
          // Structure, not prose. A creative temperature here invents step ids.
          temperature: 0.1,
          maxOutputTokens: 2_000,
        })

        if (!result.ok) {
          /*
           * ⚠️ A VENDOR FAILURE IS NOT A VALIDATION FAILURE, and retrying it as
           * one would burn the repair attempt on a problem the model never saw.
           * `generateJson` never throws for a vendor problem, so this is the
           * documented shape rather than an exception path.
           */
          attempts.push({ attempt, problems: ['The model was unavailable.'] })
          return { definition: null, attempts }
        }

        /*
         * ⚠️ CHECKED BEFORE COMPILING. An answer that declines is not a
         * malformed answer, and running it through the compiler would report
         * "entryStepId is not one of the steps" — a parser complaint standing
         * in for a real and useful sentence about what Outlio cannot do.
         */
        const declined = (result.json as { cannotBuild?: unknown })?.cannotBuild
        if (typeof declined === 'string' && declined.trim().length > 0) {
          attempts.push({ attempt, problems: [declined.trim()] })
          return { definition: null, attempts, declined: declined.trim() }
        }

        try {
          const definition = compileGeneratedDefinition(result.json, snapshot)
          attempts.push({ attempt, problems: [] })
          return { definition, attempts }
        } catch (error) {
          if (!(error instanceof FlowDefinitionError)) throw error
          problems = error.problems
          attempts.push({ attempt, problems })
        }
      }

      return { definition: null, attempts }
    },
  )

  /*
   * ⚠️ THE DOOR'S OWN REFUSALS COME FIRST AND ARE NOT RESHAPED. `hubbleExecute`
   * refuses before spending for no credits, an unpriced entry, or a capability
   * that is not AI. Those messages state what actually happened; replacing them
   * with "could not generate a flow" would claim a model ran.
   */
  if (!metered.ok) {
    return { ok: false, reason: 'refused', message: metered.message, attempts }
  }

  const { definition, attempts: made, declined } = metered.result as {
    definition: FlowDefinition | null
    attempts: CopilotAttempt[]
    declined?: string
  }

  if (!definition) {
    /*
     * ⚠️ NO PARTIAL RESULT, AND NO "CLOSEST VALID FLOW". §5.10: a capability or
     * value outside the snapshot is "a validation failure, not a repair
     * opportunity". Returning a nearly-right definition for a person to fix
     * sounds helpful and is the fabrication risk — they would be reviewing a
     * machine's guess about intent while believing they were reviewing their
     * own request.
     */
    /*
     * ⚠️ THE MODEL'S OWN SENTENCE WINS WHEN IT DECLINED. "Outlio has no SMS
     * action" is something the person can act on — they rephrase, or they stop
     * expecting a channel that does not exist. Burying it under the generic
     * "could not turn that into a flow" would throw away the only useful part
     * of the answer.
     */
    if (declined) {
      return { ok: false, reason: 'unusable', message: declined, attempts: made }
    }

    const last = made[made.length - 1]?.problems ?? []
    return {
      ok: false,
      reason: 'unusable',
      message:
        last.length > 0
          ? `Outlio could not turn that into a flow it can run. ${last.join(' ')}`
          : 'Outlio could not turn that into a flow it can run.',
      attempts: made,
    }
  }

  return { ok: true, definition, attempts: made }
}
