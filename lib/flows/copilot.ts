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
  required: ['trigger', 'entryStepId', 'steps', 'registryVersion'],
  properties: {
    registryVersion: { type: 'integer' },
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
          config: { type: 'object' },
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
    '## Rules',
    '',
    /*
     * ⚠️ STATED AS A REFUSAL, NOT AS A PREFERENCE. "Prefer existing actions"
     * invites a model to invent one when nothing fits, which is the case that
     * matters. Saying the request cannot be satisfied is a valid answer and the
     * model must know that.
     */
    '1. Use ONLY the names listed above. If the request needs something not listed, do not invent it — build the closest flow that uses only these, and leave out what you cannot express.',
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
    '7. Fill every config value the action needs. Do not leave a required field empty or guess an id you were not given.',
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
}): Promise<CopilotResult> {
  const snapshot = registrySnapshot()
  const attempts: CopilotAttempt[] = []

  const metered = await hubbleExecute(
    'flows.copilot',
    { workspaceId: input.workspaceId, userId: input.userId, source: 'http:flow-copilot' },
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

  const { definition, attempts: made } = metered.result

  if (!definition) {
    /*
     * ⚠️ NO PARTIAL RESULT, AND NO "CLOSEST VALID FLOW". §5.10: a capability or
     * value outside the snapshot is "a validation failure, not a repair
     * opportunity". Returning a nearly-right definition for a person to fix
     * sounds helpful and is the fabrication risk — they would be reviewing a
     * machine's guess about intent while believing they were reviewing their
     * own request.
     */
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
