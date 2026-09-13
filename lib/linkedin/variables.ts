/**
 * §4.9's variable dictionary, with its exact missing-data behaviour.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  A VALUE IS NOT ENOUGH. THE EVIDENCE BEHIND IT DECIDES WHETHER IT CAN BE  ║
 * ║  USED.                                                                    ║
 * ║                                                                           ║
 * ║  §4.9 does not say "use role_area if present" — it says "use that         ║
 * ║  fallback only when role_area is VERIFIED". A role we inferred from a     ║
 * ║  job title string is a different thing from one we read on the profile,   ║
 * ║  and putting the first into "Your work in {{role_area}} caught my         ║
 * ║  attention" is a claim about a stranger that we made up.                  ║
 * ║                                                                           ║
 * ║  So every value carries its §4.4 verification status, and every variable  ║
 * ║  declares the minimum it will accept.                                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ THIS FILE HOLDS NO COPY. The templates are in `templates.ts`; this is only
 * the contract about what may fill them. Splitting them is what stops a
 * variable being added to a sentence without anyone deciding what happens when
 * it is absent — which is how `{{first_name}}` reaches an inbox.
 */

/** §4.4's verification ladder, strongest first. */
export const VERIFICATION_ORDER = [
  'VERIFIED',
  'USER_RECORDED',
  'INFERRED',
  'UNKNOWN',
] as const

export type Verification = (typeof VERIFICATION_ORDER)[number]

/** A value and how well we know it. Never a bare string. */
export type Evidenced = {
  value: string
  verification: Verification
}

export function atLeast(actual: Verification, required: Verification): boolean {
  return VERIFICATION_ORDER.indexOf(actual) <= VERIFICATION_ORDER.indexOf(required)
}

export type VariableName =
  | 'greeting'
  | 'name_suffix'
  | 'connection_context'
  | 'topic'
  | 'topic_short'
  | 'role_area'
  | 'relevance_sentence'
  | 'offer_sentence'
  | 'practical_insight'
  | 'desired_outcome'
  | 'capability_short'
  | 'outline_delivery'
  | 'qualification_question'
  | 'agreed_topic'
  | 'slot_one'
  | 'slot_two'
  | 'meeting_timezone'
  | 'meeting_datetime'
  | 'meeting_join_instruction'

export type VariableSpec = {
  /**
   * `publication` — the campaign cannot be published without it (§4.9 marks
   * these **required**). `render` — needed only by the variant using it.
   */
  requiredAt: 'publication' | 'render'
  /** The weakest evidence this variable will accept. */
  minVerification: Verification
  /**
   * A literal substitute, used ONLY where §4.9 states one exactly. `null` means
   * there is no honest substitute and the variant must not render.
   */
  literalFallback: string | null
  /** Why, in the words of the brief. Rendered in the builder's help text. */
  note: string
}

/**
 * ⚠️ EVERY ENTRY HERE IS §4.9 TRANSCRIBED, NOT DESIGNED. Where the brief gives
 * an exact fallback string it is reproduced verbatim; where it says a value is
 * required, `literalFallback` is null and nothing can paper over its absence.
 */
export const VARIABLES: Readonly<Record<VariableName, VariableSpec>> = {
  greeting: {
    requiredAt: 'render',
    // A first name has to be right, not probable — it is the first word a
    // stranger reads.
    minVerification: 'VERIFIED',
    literalFallback: 'Hi,',
    note: '"Hi " plus a verified first name and a comma. Never a nickname from an uncertain field.',
  },
  name_suffix: {
    requiredAt: 'render',
    minVerification: 'VERIFIED',
    literalFallback: '',
    note: 'Comma-space plus a verified first name, or nothing at all.',
  },
  connection_context: {
    requiredAt: 'render',
    minVerification: 'VERIFIED',
    // No literal: §4.9 routes to T01's role variant instead, and forbids
    // inferred context outright.
    literalFallback: null,
    note: 'One factual relationship sentence grounded in a source. Never inferred.',
  },
  topic: {
    requiredAt: 'publication',
    minVerification: 'USER_RECORDED',
    literalFallback: null,
    note: 'The customer-approved plain-language problem. Missing blocks publication.',
  },
  topic_short: {
    requiredAt: 'render',
    minVerification: 'USER_RECORDED',
    literalFallback: null,
    note: 'A short subject phrase; falls back to topic when it fits the length cap.',
  },
  role_area: {
    requiredAt: 'render',
    minVerification: 'VERIFIED',
    literalFallback: null,
    note: 'A verified responsibility or function — not an inferred seniority.',
  },
  relevance_sentence: {
    requiredAt: 'render',
    minVerification: 'VERIFIED',
    literalFallback: null,
    note: 'One verified observation. Its literal fallback needs verified role evidence, so it is a variant rather than a default.',
  },
  offer_sentence: {
    requiredAt: 'publication',
    minVerification: 'USER_RECORDED',
    literalFallback: null,
    note: 'What the customer can actually help with. No unsupported guarantees.',
  },
  practical_insight: {
    requiredAt: 'render',
    minVerification: 'USER_RECORDED',
    literalFallback: null,
    note: 'Approved advice from the knowledge base. A generic compliment is not an insight.',
  },
  desired_outcome: {
    requiredAt: 'publication',
    minVerification: 'USER_RECORDED',
    literalFallback: null,
    note: 'An objective, not a guaranteed result. Missing blocks publication.',
  },
  capability_short: {
    requiredAt: 'publication',
    minVerification: 'USER_RECORDED',
    literalFallback: null,
    note: "Required for T03's fallback variant.",
  },
  outline_delivery: {
    requiredAt: 'render',
    minVerification: 'USER_RECORDED',
    literalFallback: null,
    note: 'Approved inline text or an existing approved link. Check permissions before linking a private asset.',
  },
  qualification_question: {
    requiredAt: 'render',
    minVerification: 'USER_RECORDED',
    literalFallback: 'Which part would you like me to explain further?',
    note: 'One customer-defined question needed to assess fit.',
  },
  agreed_topic: {
    requiredAt: 'render',
    // It came out of the actual thread, which a human read.
    minVerification: 'USER_RECORDED',
    literalFallback: null,
    note: 'The topic actually discussed in the reply thread.',
  },
  slot_one: {
    requiredAt: 'render',
    minVerification: 'VERIFIED',
    literalFallback: null,
    note: 'A verified free slot. Never invent availability.',
  },
  slot_two: {
    requiredAt: 'render',
    minVerification: 'VERIFIED',
    literalFallback: null,
    note: 'A verified free slot. Missing either slot routes to the T07 fallback.',
  },
  meeting_timezone: {
    requiredAt: 'render',
    minVerification: 'VERIFIED',
    literalFallback: null,
    note: 'A verified IANA zone. Missing means ask — and do not confirm a booking.',
  },
  meeting_datetime: {
    requiredAt: 'render',
    minVerification: 'VERIFIED',
    literalFallback: null,
    note: 'A verified booking time. Missing means no T08 at all.',
  },
  meeting_join_instruction: {
    requiredAt: 'render',
    minVerification: 'USER_RECORDED',
    literalFallback: "I'll confirm the joining details in this thread.",
    note: 'Only use the fallback if an owner task is created to supply the real details.',
  },
}

/** Variables a program must supply before it can be published (§4.3). */
export function publicationRequired(): VariableName[] {
  return (Object.keys(VARIABLES) as VariableName[]).filter(
    (name) => VARIABLES[name].requiredAt === 'publication',
  )
}

/**
 * Whether a value is good enough to use for this variable.
 *
 * ⚠️ AN EMPTY OR WHITESPACE VALUE IS ABSENT, however well verified. "Verified
 * empty string" is how a blank lands in the middle of a sentence.
 */
export function usable(name: VariableName, evidence: Evidenced | null | undefined): boolean {
  if (!evidence) return false
  if (evidence.value.trim() === '') return false
  return atLeast(evidence.verification, VARIABLES[name].minVerification)
}
