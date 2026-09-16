import 'server-only'

/**
 * Drafting a message from the operator's own instruction — Phase 20.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  Owner, 2026-09-15: "will give the option to get it written from ai but   ║
 * ║  for that the user has to give input into ai on how he wants it written   ║
 * ║  (a possible templete etc)… what Ai will do is have place holders for     ║
 * ║  Name, Company name, Location".                                           ║
 * ║                                                                           ║
 * ║  ⚠️ SO THE MODEL WRITES A TEMPLATE, NEVER A PER-PERSON MESSAGE. It is     ║
 * ║  given the operator's instruction and the three placeholder names, and it  ║
 * ║  is given NO CONTACT DATA AT ALL — no name, no company, no headline.      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ WITHHOLDING THE CONTACT IS THE ANTI-FABRICATION CONTROL, NOT A PRIVACY
 * GESTURE. A model shown "VP Engineering at Acme, Berlin" will write "loved what
 * you're building on the payments side" — plausible, specific, and invented.
 * Rule 4 forbids exactly that, and no amount of prompt instruction reliably
 * stops a model from using a fact it can see. So it cannot see one.
 *
 * What it produces is a template with `{{first_name}}`-style slots, which
 * `resolveBody` then fills from values Outlio literally observed — and refuses
 * to fill when it did not. The familiarity is structural, not imagined.
 *
 * ⚠️ AND THE OPERATOR IS STILL THE AUTHOR. The draft lands in a textarea they
 * read and edit before anything is saved. Nothing here writes a message into a
 * campaign or a prospect record by itself.
 */
import { hubbleExecute, type HubbleTools } from '@/lib/hubble/execute'
import { CONNECTION_NOTE_LIMIT } from '@/lib/linkedin/render'
import { PLACEHOLDERS, PLACEHOLDER_SPECS, validateBody } from '@/lib/linkedin/placeholders'

export type DraftPurpose =
  | 'CONNECTION_NOTE'
  | 'DIRECT_MESSAGE'
  | 'INMAIL'
  | 'OPENER'
  | 'PITCH'

/** What each purpose is for, and what it must fit. */
const PURPOSE: Readonly<
  Record<DraftPurpose, { label: string; limit: number; brief: string }>
> = {
  CONNECTION_NOTE: {
    label: 'connection request note',
    limit: CONNECTION_NOTE_LIMIT,
    brief: 'A note attached to a connection request. It must be short and give a reason to accept.',
  },
  DIRECT_MESSAGE: {
    label: 'LinkedIn message',
    limit: 1_200,
    brief: 'A direct message to someone already connected.',
  },
  INMAIL: {
    label: 'InMail',
    limit: 1_500,
    brief: 'An InMail to someone not connected. It is paid and rationed, so it has to earn the reply.',
  },
  OPENER: {
    label: 'opening message',
    limit: 1_200,
    brief: 'The first thing this rep would say to a prospect.',
  },
  PITCH: {
    label: 'pitch',
    limit: 2_000,
    brief: 'What this rep would say once the prospect has replied and is interested.',
  },
}

export type DraftResult =
  | { ok: true; text: string; usedPlaceholders: readonly string[] }
  | { ok: false; reason: 'refused' | 'unusable' | 'no_credits'; message: string }

const MAX_INSTRUCTION = 2_000

/**
 * ⚠️ THE SCHEMA DECLARES `message` AND NOTHING ELSE THAT MATTERS. Phase 13's
 * defect was a `config: { type: 'object' }` with no declared properties:
 * structured output stripped everything inside it, so the copilot returned
 * `config: {}` on every call and could never produce a publishable flow. An
 * undeclared property is not optional — it is deleted.
 */
function schema() {
  return {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description:
          'The message text. May contain {{first_name}}, {{company}} and {{location}} and no other placeholders.',
      },
      /*
       * ⚠️ A WAY TO DECLINE, so a refusal arrives as a sentence rather than as a
       * malformed message. Without it a model asked for something it should not
       * write produces its objection INSIDE `message`, and that lands in a
       * textarea looking like copy.
       */
      cannotWrite: {
        type: 'string',
        description: 'If the instruction cannot be followed, explain why here and leave message empty.',
      },
    },
    required: ['message'],
  }
}

function systemPrompt(purpose: DraftPurpose): string {
  const spec = PURPOSE[purpose]
  const placeholders = PLACEHOLDERS.map(
    (name) => `  {{${name}}} — ${PLACEHOLDER_SPECS[name].label}. ${PLACEHOLDER_SPECS[name].note}`,
  ).join('\n')

  return [
    'You write B2B LinkedIn outreach copy for a salesperson.',
    '',
    `You are writing: a ${spec.label}. ${spec.brief}`,
    `Hard limit: ${spec.limit} characters.`,
    '',
    'PLACEHOLDERS — these are the only ones that exist:',
    placeholders,
    '',
    /*
     * ⚠️ STATED AS A CAPABILITY LIMIT, NOT AS A RULE TO OBEY. "Do not invent
     * details" invites a model to decide what counts as inventing. "You have not
     * been given any information about the recipient" is a fact it can act on,
     * and it is true — nothing about the contact is in this prompt.
     */
    'YOU HAVE NOT BEEN GIVEN ANY INFORMATION ABOUT THE RECIPIENT. You do not know',
    'their name, their company, their role, their posts or their industry. Write a',
    'template that works for anyone the salesperson chooses, using the placeholders',
    'above for the three facts that will be filled in later.',
    '',
    'Never write a placeholder that is not on the list. Never claim to have seen',
    'their profile, read their post, or met them. Never promise a result.',
    '',
    'Write only the message. No subject line, no greeting label, no sign-off block,',
    'no commentary, no quotation marks around the whole thing.',
  ].join('\n')
}

/**
 * Drafts one message from an instruction the operator wrote.
 *
 * ⚠️ IT REFUSES AN EMPTY INSTRUCTION RATHER THAN INVENTING A BRIEF. The owner's
 * requirement is explicit — "for that the user has to give input into ai on how
 * he wants it written". A button that produces generic outreach from nothing is
 * the feature they were careful to say they did not want.
 */
export async function draftMessage(input: {
  workspaceId: string
  userId: string
  purpose: DraftPurpose
  /** The operator's own words about how they want it written. */
  instruction: string
  /** An existing draft to rewrite, when they are iterating. */
  current?: string | null
}): Promise<DraftResult> {
  const instruction = input.instruction.trim()

  if (instruction.length < 3) {
    return {
      ok: false,
      reason: 'refused',
      message: 'Say how you want it written — a tone, an angle, or a template to follow.',
    }
  }

  if (instruction.length > MAX_INSTRUCTION) {
    return {
      ok: false,
      reason: 'refused',
      message: `That instruction is ${instruction.length} characters — keep it under ${MAX_INSTRUCTION}.`,
    }
  }

  const spec = PURPOSE[input.purpose]

  const metered = await hubbleExecute(
    'linkedin.draft',
    { workspaceId: input.workspaceId, userId: input.userId, source: 'http:linkedin-draft' },
    async (tools: HubbleTools) => {
      const result = await tools.llm.generateJson({
        system: systemPrompt(input.purpose),
        user: [
          `HOW THE SALESPERSON WANTS IT WRITTEN:\n${instruction}`,
          input.current?.trim()
            ? `\nTHEIR CURRENT DRAFT, to rewrite rather than replace wholesale:\n${input.current.trim()}`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
        schema: schema() as unknown as Record<string, unknown>,
        /*
         * ⚠️ HIGHER THAN THE COPILOT'S 0.1, AND THAT IS THE DIFFERENCE BETWEEN
         * THE TWO JOBS. The copilot emits structure, where a creative
         * temperature invents step ids. This emits prose a human will read and
         * edit, and at 0.1 every draft reads like the same email.
         */
        temperature: 0.7,
        maxOutputTokens: 800,
      })

      if (!result.ok) return { text: null, declined: null as string | null }

      const json = result.json as { message?: unknown; cannotWrite?: unknown }
      const declined =
        typeof json?.cannotWrite === 'string' && json.cannotWrite.trim()
          ? json.cannotWrite.trim()
          : null
      const text = typeof json?.message === 'string' ? json.message.trim() : null

      return { text, declined }
    },
  )

  if (!metered.ok) {
    return {
      ok: false,
      reason: metered.reason === 'no_credits' ? 'no_credits' : 'unusable',
      message:
        metered.reason === 'no_credits'
          ? 'Your workspace is out of AI credits.'
          : 'The model was unavailable. Try again, or write it yourself.',
    }
  }

  const { text, declined } = metered.result

  if (declined && !text) {
    return { ok: false, reason: 'refused', message: declined }
  }

  if (!text) {
    return { ok: false, reason: 'unusable', message: 'The model returned nothing usable.' }
  }

  /*
   * ⚠️ THE OUTPUT IS VALIDATED, NOT TRUSTED. `schema()` describes the allowed
   * placeholders and a model will still emit `{{firstName}}` or `{{industry}}`
   * — an enum in a response schema is ADVISORY with these providers unless
   * strict mode applies, and strict mode needs every property in `required`.
   *
   * A bad placeholder is REPORTED rather than stripped: stripping silently
   * changes a sentence, and leaving it lands `{{industry}}` in a stranger's
   * inbox. The operator sees what happened and can retry.
   */
  const placeholders = validateBody(text)
  if (!placeholders.ok) {
    return {
      ok: false,
      reason: 'unusable',
      message: `The draft used a placeholder Outlio cannot fill (${placeholders.unknown
        .map((name) => `{{${name}}}`)
        .join(', ')}). Try again, or write it yourself.`,
    }
  }

  /*
   * ⚠️ THE LENGTH CAP IS REFUSED, NEVER TRUNCATED — matching `enroll.ts` and
   * `compileWorkflow`. A note clipped mid-sentence is worse than one that was
   * never written, and a connection note is the case where it actually bites.
   *
   * ⚠️ MEASURED ON THE UNRESOLVED TEMPLATE, WHICH UNDERCOUNTS: `{{first_name}}`
   * is 14 characters and "Jo" is 2. Per-contact overflow is caught at render,
   * where the real length is knowable.
   */
  if (text.length > spec.limit) {
    return {
      ok: false,
      reason: 'unusable',
      message: `The draft came back at ${text.length} characters and a ${spec.label} has to fit ${spec.limit}. Try asking for something shorter.`,
    }
  }

  return { ok: true, text, usedPlaceholders: placeholders.used }
}
