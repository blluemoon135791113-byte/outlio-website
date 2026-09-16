/**
 * Turning what Outlio actually knows about a person into §4.9's variables.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THIS FILE'S REAL JOB IS REFUSING, NOT FILLING.                        ║
 * ║                                                                           ║
 * ║  A mapper that fills every variable is trivial to write and is the single ║
 * ║  most dangerous thing in this codebase: it puts a confident sentence      ║
 * ║  about a stranger into a message sent from a customer's own LinkedIn      ║
 * ║  account, under their name. CLAUDE.md rule 4 with a friendly tone.        ║
 * ║                                                                           ║
 * ║  §4.9: "If neither context nor role is supported, require a manual        ║
 * ║  rewrite or skip; do not fabricate familiarity." So most contacts will    ║
 * ║  yield a context that cannot render a grounded opener, and that is this   ║
 * ║  working — not failing.                                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ NO NETWORK, NO DATABASE, NO CLOCK. Pure, so the mapping rules can be
 * tested exhaustively against every combination of evidence rather than against
 * whatever happens to be in a fixture.
 */
import type { LinkedInContext } from '@/lib/linkedin/render'
import type { Evidenced, VariableName, Verification } from '@/lib/linkedin/variables'

/** How a contact record came to exist — `crm_contacts.source` (0071). */
export type RecordSource = 'lead_engine' | 'csv_import' | 'manual' | 'api' | 'flow'

/**
 * The facts a contact row carries. Deliberately NOT the row type: this names
 * exactly what the mapper is allowed to look at, so adding a field to
 * `crm_contacts` cannot silently start feeding a message.
 */
export type ContactFacts = {
  source: RecordSource
  firstName: string | null
  fullName: string | null
  jobTitle: string | null
  headline: string | null
}

/**
 * What the customer wrote about their own offer.
 *
 * ⚠️ ALWAYS `USER_RECORDED`, NEVER `VERIFIED`. These are the customer's claims
 * about their own business — true in the sense that they said them, which is a
 * different kind of true from a fact read off a profile. §4.9 requires only
 * `USER_RECORDED` here precisely because nobody can verify "we help teams ship
 * faster" from outside.
 */
export type CampaignCopy = {
  topic: string | null
  topicShort?: string | null
  offerSentence?: string | null
  practicalInsight?: string | null
  desiredOutcome?: string | null
  capabilityShort?: string | null
  qualificationQuestion?: string | null
}

/**
 * ⚠️ THE WHOLE SAFETY ARGUMENT IN ONE FUNCTION.
 *
 * `lead_engine` means the row was parsed from a Sales Navigator page the
 * customer opened themselves — the name and title on it are what LinkedIn
 * displays for that person, so reading them is an observation.
 *
 * Everything else is somebody's spreadsheet, somebody's typing, or somebody's
 * CRM integration. A name in a CSV may be years stale, a nickname, or simply
 * wrong, and no amount of it being in our database makes it verified.
 */
export function verificationForSource(source: RecordSource): Verification {
  return source === 'lead_engine' ? 'VERIFIED' : 'USER_RECORDED'
}

function evidenced(value: string | null | undefined, verification: Verification): Evidenced | null {
  const trimmed = value?.trim()
  return trimmed ? { value: trimmed, verification } : null
}

/**
 * Builds the context for a contact.
 *
 * ⚠️ WHAT IT WILL NOT DO, AND WHY EACH REFUSAL IS DELIBERATE:
 *
 * **It never splits a full name to get a first name.** Which token is the given
 * name depends on the culture the name comes from, and guessing wrong means
 * opening a cold message by calling somebody by their family name. §4.9:
 * "Never a nickname from an uncertain field."
 *
 * **It never derives `role_area` from `job_title`.** The spec is explicit — "a
 * verified responsibility or function — NOT an inferred seniority" — and
 * turning "VP of Engineering" into "engineering" is exactly that inference.
 * `role_area` therefore stays empty until something actually observes a
 * responsibility, which nothing does yet.
 *
 * **It never invents `connection_context`.** "One factual relationship sentence
 * grounded in a source. Never inferred." Outlio holds no relationship data —
 * no shared group, no mutual connection, no event — so there is nothing honest
 * to put here and the variable is absent by construction rather than by
 * accident.
 *
 * The consequence is that T01 will usually route to `manual_rewrite`: neither
 * its context variant nor its role variant can render. That is §4.9's stated
 * outcome, and the product's answer is that a human writes the note.
 */
export function buildLinkedInContext(input: {
  contact: ContactFacts
  campaign: CampaignCopy
}): LinkedInContext {
  const { contact, campaign } = input
  const context: Partial<Record<VariableName, Evidenced>> = {}

  const nameVerification = verificationForSource(contact.source)

  /*
   * ⚠️ ONLY THE STORED `first_name`. When it is absent the variable is absent,
   * and `variables.ts` supplies the literal "Hi," — a greeting with no name is
   * ordinary and correct, while a greeting with the wrong name is memorable for
   * the wrong reason.
   */
  const first = evidenced(contact.firstName, nameVerification)
  if (first) {
    context.greeting = { value: `Hi ${first.value},`, verification: first.verification }
    // §4.9: comma-space plus a verified first name, or nothing at all.
    context.name_suffix = { value: `, ${first.value}`, verification: first.verification }
  }

  /*
   * ⚠️ `role_area` IS NOT SET FROM `job_title`, AND THAT IS NOT AN OMISSION.
   * See the banner above. The title is kept out of the context entirely rather
   * than passed through at a lower verification, because a variable present at
   * the wrong level is one `atLeast()` change away from being used.
   */

  // The customer's own words, at the level the brief assigns them.
  const recorded: Array<[VariableName, string | null | undefined]> = [
    ['topic', campaign.topic],
    ['topic_short', campaign.topicShort],
    ['offer_sentence', campaign.offerSentence],
    ['practical_insight', campaign.practicalInsight],
    ['desired_outcome', campaign.desiredOutcome],
    ['capability_short', campaign.capabilityShort],
    ['qualification_question', campaign.qualificationQuestion],
  ]

  for (const [name, value] of recorded) {
    const filled = evidenced(value, 'USER_RECORDED')
    if (filled) context[name] = filled
  }

  /*
   * ⚠️ `topic_short` FALLS BACK TO `topic`, WHICH IS THE ONE DERIVATION HERE
   * AND IS NOT AN INFERENCE. `variables.ts` states it: "a short subject phrase;
   * falls back to topic when it fits the length cap." Reusing the customer's
   * own words at their own verification invents nothing.
   */
  if (!context.topic_short && context.topic) {
    context.topic_short = context.topic
  }

  return context
}

/**
 * What is missing before this contact can be approached with grounded copy.
 *
 * ⚠️ FOR TELLING A PERSON WHY, NOT FOR DECIDING. `renderLinkedInMessage` makes
 * the decision; this exists so the refusal can say something better than "not
 * enough detail" — an operator who is told which fact is absent can go and find
 * it, and one who is not will retry the same contact tomorrow.
 */
export function missingForGroundedOpener(context: LinkedInContext): VariableName[] {
  const missing: VariableName[] = []
  if (!context.connection_context && !context.role_area) {
    // Either would satisfy T01; neither being present is the common case.
    missing.push('connection_context', 'role_area')
  }
  if (!context.topic) missing.push('topic')
  return missing
}
