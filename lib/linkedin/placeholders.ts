/**
 * The three placeholders a customer may put in their own copy — Phase 20.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  Owner, 2026-09-15: "what Ai will do is have place holders for Name,      ║
 * ║  Company name, Location".                                                 ║
 * ║                                                                           ║
 * ║  ⚠️ SO THIS IS THE ONE PLACE RULE 4 APPLIES TO OPERATOR-AUTHORED TEXT.    ║
 * ║  The operator wrote the sentence, which is what makes the sentence         ║
 * ║  trustworthy. The values dropped into it did not come from them — they     ║
 * ║  come from a CRM row that was parsed out of a saved page, and rule 4 says  ║
 * ║  a missing value is NULL plus a missing-data indicator, never a guess.    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ A MISSING VALUE BLOCKS THE TASK. It does not render empty and it does not
 * fall back. "I loved what you're building at " is not a degraded message, it is
 * a message that tells the recipient they were mail-merged — and the operator
 * whose account sends it is the one who pays for that.
 *
 * ⚠️ AN UNKNOWN PLACEHOLDER IS REFUSED AT SAVE, NOT AT SEND, and the timing is
 * the whole point. `{{firstname}}` is a plausible typo for `{{first_name}}`.
 * Caught at save it is a squiggle under a word in the builder. Discovered at
 * send there are only bad options: leave it literal and a stranger reads
 * "Hey {{firstname}}", or strip it and silently send a sentence the operator
 * never wrote.
 */
import { atLeast, type Evidenced } from '@/lib/linkedin/variables'

/**
 * ⚠️ THREE, AND ADDING A FOURTH IS A DECISION RATHER THAN A CONVENIENCE. Every
 * placeholder is a promise that Outlio holds that fact for enough contacts to be
 * worth writing a sentence around. `{{job_title}}` looks equally easy and is
 * present on far fewer rows, so a template built on it would block most of the
 * campaign — which the operator only discovers after writing it.
 */
export const PLACEHOLDERS = ['first_name', 'company', 'location'] as const

export type Placeholder = (typeof PLACEHOLDERS)[number]

export type PlaceholderSpec = {
  /** What the builder's insert menu calls it. */
  label: string
  /**
   * The weakest evidence that may fill it, reusing §4.4's ladder.
   *
   * ⚠️ `first_name` DEMANDS `VERIFIED` FOR THE REASON `variables.ts` ALREADY
   * GIVES about `greeting`: "a first name has to be right, not probable — it is
   * the first word a stranger reads". Splitting a full name is exactly the
   * inference that produces "Hi Van" for "Van der Berg".
   */
  minVerification: Evidenced['verification']
  /** Shown beside the placeholder so its cost is visible while writing. */
  note: string
}

export const PLACEHOLDER_SPECS: Readonly<Record<Placeholder, PlaceholderSpec>> = {
  first_name: {
    label: 'First name',
    minVerification: 'VERIFIED',
    note: 'Only a first name Outlio read directly. Never split out of a full name — that is how "Hi Van" happens.',
  },
  company: {
    label: 'Company name',
    // Parsed from the page, or typed by a person. Both are literal observations.
    minVerification: 'USER_RECORDED',
    note: 'The company on the contact record.',
  },
  location: {
    label: 'Location',
    minVerification: 'USER_RECORDED',
    note: 'As recorded — often a region rather than a city. Read it before you build a sentence around it.',
  },
}

/**
 * ⚠️ ONE PATTERN, USED BY BOTH THE VALIDATOR AND THE RESOLVER. Two regexes that
 * are meant to agree is two regexes that will not: the classic failure is a
 * validator that tolerates `{{ first_name }}` and a resolver that does not, so
 * the spaces survive save and reach the inbox.
 *
 * Inner whitespace is permitted and trimmed, because a person typing braces by
 * hand will add it and refusing would be pedantry with a real cost.
 */
const TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

export type BodyValidation =
  | { ok: true; used: readonly Placeholder[] }
  | { ok: false; unknown: readonly string[] }

/**
 * Checks the placeholders in a body the operator just typed.
 *
 * ⚠️ IT REPORTS THE UNKNOWN NAMES RATHER THAN A COUNT, because the operator is
 * looking at their own paragraph and has to find the one word that is wrong.
 * "1 invalid placeholder" makes them re-read the whole thing.
 */
export function validateBody(body: string): BodyValidation {
  const used: Placeholder[] = []
  const unknown: string[] = []

  for (const match of body.matchAll(TOKEN)) {
    const name = match[1]!
    if (isPlaceholder(name)) {
      if (!used.includes(name)) used.push(name)
    } else if (!unknown.includes(name)) {
      unknown.push(name)
    }
  }

  return unknown.length > 0 ? { ok: false, unknown } : { ok: true, used }
}

export type ContactValues = Partial<Record<Placeholder, Evidenced | null>>

export type Resolution =
  | { ok: true; text: string }
  /**
   * ⚠️ THE MISSING NAMES, NOT A BOOLEAN. This message reaches an operator
   * looking at one named person: "no company on this contact" sends them to fix
   * the record, and "cannot personalise" sends them nowhere.
   */
  | { ok: false; missing: readonly Placeholder[] }

/**
 * Fills a body for one contact, or refuses and says which fact is absent.
 *
 * ⚠️ IT COLLECTS EVERY MISSING PLACEHOLDER BEFORE RETURNING. Failing on the
 * first would have an operator fix the company, retry, and be told about the
 * location — one round trip per gap, on a contact they may decide to skip
 * entirely once they can see the whole bill.
 *
 * ⚠️ `usable()` IS REUSED RATHER THAN REIMPLEMENTED, and it carries a rule worth
 * restating: "an empty or whitespace value is absent, however well verified.
 * 'Verified empty string' is how a blank lands in the middle of a sentence."
 */
export function resolveBody(body: string, values: ContactValues): Resolution {
  const missing: Placeholder[] = []

  for (const match of body.matchAll(TOKEN)) {
    const name = match[1]!
    /*
     * ⚠️ AN UNKNOWN NAME THROWS HERE. It cannot be reported as "missing" — the
     * operator would go looking for a contact field that does not exist — and it
     * must not be silently left in place. `validateBody` is the gate at save, so
     * reaching this line means a body was stored without passing it, which is a
     * bug in the caller rather than a state an operator can fix.
     */
    if (!isPlaceholder(name)) {
      throw new Error(`resolveBody: unvalidated placeholder {{${name}}} reached rendering`)
    }
    if (!usableValue(name, values[name])) {
      if (!missing.includes(name)) missing.push(name)
    }
  }

  if (missing.length > 0) return { ok: false, missing }

  return {
    ok: true,
    text: body.replace(TOKEN, (_whole, raw: string) => {
      const name = raw as Placeholder
      // Non-null: the loop above proved every token resolves.
      return values[name]!.value.trim()
    }),
  }
}

/**
 * ⚠️ `atLeast` FROM `variables.ts`, NOT A SECOND LADDER. The ranking of
 * VERIFIED > USER_RECORDED > INFERRED > UNKNOWN exists there and is the rule
 * §4.4 states; copying the array here would create a second copy to keep in
 * agreement, and a placeholder silently accepting INFERRED evidence is precisely
 * the failure that copy would cause.
 *
 * What is NOT reused is `usable(name, …)` — it keys `VARIABLES` by the
 * eight-template vocabulary, and these three names are not in it, so it would
 * index `undefined` and compare against nothing.
 */
function usableValue(name: Placeholder, evidence: Evidenced | null | undefined): boolean {
  if (!evidence) return false
  // "Verified empty string" is how a blank lands in the middle of a sentence.
  if (evidence.value.trim() === '') return false
  return atLeast(evidence.verification, PLACEHOLDER_SPECS[name].minVerification)
}

export function isPlaceholder(value: string): value is Placeholder {
  return (PLACEHOLDERS as readonly string[]).includes(value)
}
