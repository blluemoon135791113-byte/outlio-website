/**
 * The actions a customer can put in a campaign workflow — Phase 20.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ EVERY STEP DECLARES TWO HALVES: WHAT OUTLIO PREPARES, AND WHAT THE    ║
 * ║  OPERATOR PERFORMS.                                                       ║
 * ║                                                                           ║
 * ║  Tools that hold a LinkedIn session collapse the two — "Send LinkedIn     ║
 * ║  message" is one thing to them because they do both halves. Outlio never  ║
 * ║  logs in and never sends (rule 1, rule 2), so a step that did not name    ║
 * ║  the split would be a step nobody could tell was manual until they        ║
 * ║  clicked it and nothing happened. That already happened once at the level ║
 * ║  of the whole channel; it is not happening again per step.                ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ OUTLIO DOES NOT WRITE THE MESSAGE. Owner decision, 2026-09-15:
 *
 *   "outlio does not prepare the note text or the message it will be written
 *    manually and will give the option to get it written from ai but for that
 *    the user has to give input into ai on how he wants it written"
 *
 * This is a narrowing of what Phase 9 built, and it makes the product safer
 * rather than weaker. `templates.ts` renders eight Outlio-authored messages from
 * CRM evidence and refuses when the evidence is thin — which meant the common
 * path was a refusal (see `enroll.ts`, where `manual_rewrite` is described as
 * "the COMMON path rather than the exception"). Under this model the operator's
 * own words are the *first* path, not the remedy, and the only machine-filled
 * parts are three placeholders resolved from literally-observed CRM values.
 *
 * The templates are not deleted — they remain available as a starting point an
 * operator can paste and edit. They are simply no longer what a step contains.
 *
 * ⚠️ AND SOME STEPS PREPARE NOTHING AT ALL. Owner, same decision: "outlio does
 * not prepares the comment draft it would just be marked as comments/engagement
 * done". A step whose `prepares` is `'nothing'` is not an unfinished step. It is
 * a step whose entire content is an instruction, and pretending otherwise would
 * have Outlio drafting a comment on a post it has never seen — which is rule 4
 * with extra steps.
 */

import { POSITIVE, type TaskOutcome } from '@/lib/linkedin/outcomes'
import type { Database } from '@/types/database'

/**
 * Every action a workflow step can be.
 *
 * ⚠️ `WAIT` IS IN HERE RATHER THAN BESIDE IT. The builder presents a wait as one
 * more card in the same list (it is, in the reference the owner supplied), and
 * an enrolment advancing through the workflow has to step over it the same way
 * it steps over anything else. Modelling it as a separate table would mean two
 * orderings to keep in agreement, and they would disagree.
 *
 * ⚠️ NO `VOICE_NOTE`. Owner, 2026-09-15: "THE VOICE CLONING AND TEXT TO SPEECH
 * KEEP IT FOR LATER". Deferred deliberately and not stubbed — rule 7. When it
 * lands it is an ElevenLabs render Outlio prepares as a downloadable mp3 and the
 * operator attaches by hand, which is a `prepares: 'asset'` this registry does
 * not yet have.
 */
export const STEP_ACTIONS = [
  'VISIT_PROFILE',
  'CONNECTION_REQUEST',
  'DIRECT_MESSAGE',
  'INMAIL',
  'LIKE_POST',
  'COMMENT_POST',
  'ADD_TAG',
  'WAIT',
] as const

export type StepAction = (typeof STEP_ACTIONS)[number]

/**
 * What Outlio hands the operator on the task card.
 *
 * - `text`    — content the operator authored, with placeholders resolved.
 * - `link`    — a validated read-only URL from the CRM record.
 * - `nothing` — an instruction and no payload. A real, complete answer.
 * - `internal`— nothing leaves Outlio; there is no task at all.
 */
export type Prepares = 'text' | 'link' | 'nothing' | 'internal'

export type StepSpec = {
  /** Shown on the builder card. Plain, and honest about who acts. */
  label: string
  prepares: Prepares
  /**
   * What the operator does in LinkedIn. `null` for steps that never leave
   * Outlio, and the null is what stops a `WAIT` generating a card.
   */
  performs: string | null
  /**
   * Whether this step holds operator-authored copy.
   *
   * ⚠️ `'required'` MEANS THE CAMPAIGN CANNOT BE PUBLISHED WITHOUT IT. A DM step
   * with no message is not a draft to be filled in later — it is a task that
   * will reach an operator saying "send this" with nothing attached.
   */
  body: 'required' | 'optional' | 'none'
  /** Why this step is shaped the way it is. Surfaced in the builder's help. */
  note: string
}

/**
 * The affirmative outcome a step's result form may offer.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ DERIVED FROM `outcomes.ts`, NOT DECLARED HERE. THIS TABLE USED TO     ║
 * ║  CARRY A `positiveOutcome` PER STEP, AND THAT WAS THE BUG.                ║
 * ║                                                                           ║
 * ║  `POSITIVE` in `outcomes.ts` already answers "what does done look like    ║
 * ║  for this task kind". A second copy keyed by step action is one question   ║
 * ║  with two implementations — this repository's most expensive recurring     ║
 * ║  defect — and the two would disagree the first time somebody changed one:  ║
 * ║  a result form offering an outcome the validator rejects, or accepting one ║
 * ║  the form never shows.                                                    ║
 * ║                                                                           ║
 * ║  So the chain is single: action → task kind (`taskKindFor`) → outcome     ║
 * ║  (`POSITIVE`). Each link exists once.                                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ STILL NOT OBSERVATIONS. `outcomes.ts` keeps two vocabularies apart because
 * "'mark request sent' cannot mark acceptance" — acceptance gates the first DM,
 * so collapsing them sends a message into a connection that was never made.
 * Deriving the offered set from the customer's workflow changes WHICH outcomes
 * appear. It does not change what an outcome is.
 *
 * Returns `null` for internal steps, which have no result form.
 */
export function positiveOutcomeFor(action: StepAction): TaskOutcome | null {
  const kind = taskKindFor(action)
  return kind ? POSITIVE[kind] : null
}

/**
 * ⚠️ THIS TABLE IS THE OWNER'S CORRECTIONS TRANSCRIBED, NOT DESIGNED. Each
 * `prepares` value was stated rather than inferred, and where the owner said
 * Outlio prepares nothing, `prepares` is `'nothing'` and `body` is `'none'`.
 */
export const STEPS: Readonly<Record<StepAction, StepSpec>> = {
  VISIT_PROFILE: {
    label: 'Visit LinkedIn profile',
    prepares: 'link',
    performs: 'Open their profile and read it.',
    body: 'none',
    note: 'The cheapest first action against a real account: it reads rather than writes, so it cannot get anybody restricted.',
  },

  CONNECTION_REQUEST: {
    label: 'Send connection request',
    prepares: 'text',
    performs: 'Send the request, with your note if you wrote one.',
    /*
     * ⚠️ OPTIONAL, BECAUSE A NOTELESS REQUEST IS A REAL CHOICE. Plenty of
     * operators deliberately send no note, and forcing one would have them type
     * filler to get past a validator.
     */
    body: 'optional',
    note: 'Your note, capped at LinkedIn’s 300 characters. An overlong note is refused, never truncated — a note clipped mid-sentence is worse than one never sent.',
  },

  DIRECT_MESSAGE: {
    label: 'Send LinkedIn message',
    prepares: 'text',
    performs: 'Paste it into the conversation and send.',
    body: 'required',
    note: 'Your words. Outlio resolves the placeholders and refuses the task if a value is missing rather than sending a gap.',
  },

  INMAIL: {
    label: 'Send InMail',
    prepares: 'text',
    performs: 'Send it as an InMail.',
    body: 'required',
    note: 'InMail has the tightest daily cap of any action — one per day per account, even at stage 2.',
  },

  LIKE_POST: {
    label: 'Like their recent post',
    /*
     * ⚠️ `nothing`, AND THE REASON IS A HARD LIMIT RATHER THAN AN OMISSION.
     * Outlio cannot fetch the post URL: rule 1 forbids any request to
     * linkedin.com, and LinkedIn gates post feeds behind a session, so reaching
     * one would need exactly the credential login and bot-detection evasion that
     * the 2026-09-03 widening explicitly did NOT cover.
     *
     * So the card carries the profile link — which Outlio does hold, validated —
     * and the operator navigates the one hop to recent activity themselves.
     * `see docs/outlio/LINKEDIN_HOW_IT_WORKS.md` records the alternatives
     * considered, including capturing it via the extension later.
     */
    prepares: 'link',
    performs: 'Open their profile → Recent activity, and like the top post.',
    body: 'none',
    note: 'Outlio cannot fetch the post itself — that needs a logged-in session, which Outlio does not have and will not get. It gets you one click away.',
  },

  COMMENT_POST: {
    label: 'Comment on their recent post',
    /*
     * ⚠️ NO DRAFT, BY DECISION. Owner, 2026-09-15: "outlio does not prepares the
     * comment draft it would just be marked as comments/engagement done".
     *
     * Which is the correct answer on the evidence: a comment has to respond to
     * what the post actually says, and Outlio has never seen the post. Drafting
     * one anyway would be inventing a reaction to content we cannot read.
     */
    prepares: 'nothing',
    performs: 'Read their recent post and comment on it in your own words.',
    body: 'none',
    note: 'Outlio drafts nothing here. A comment has to answer what the post actually said, and Outlio has never seen the post.',
  },

  ADD_TAG: {
    label: 'Add a tag',
    /*
     * ⚠️ THE ONE STEP WITH NO HUMAN HALF, and that is what makes the two-halves
     * model a model rather than a special case. It changes a row in Outlio and
     * touches LinkedIn not at all, so it generates no task and completes the
     * moment the enrolment reaches it.
     */
    prepares: 'internal',
    performs: null,
    body: 'none',
    note: 'Runs inside Outlio. Nothing for you to do and nothing reaches LinkedIn.',
  },

  WAIT: {
    label: 'Wait',
    prepares: 'internal',
    performs: null,
    body: 'none',
    note: 'Holds the person here until the wait elapses, then releases the next step.',
  },
}

/** Steps that produce a card for a human. The rest run inside Outlio. */
export function producesTask(action: StepAction): boolean {
  return STEPS[action].performs !== null
}

/**
 * The database task kind a step produces.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ `VISIT_PROFILE` MAPS TO THE EXISTING `REVIEW_PROFILE`, AND THE        ║
 * ║  MISMATCH IS THE POINT.                                                   ║
 * ║                                                                           ║
 * ║  The builder card says "Visit LinkedIn profile" because that is what the   ║
 * ║  owner's reference calls it. The task kind stays `REVIEW_PROFILE` because  ║
 * ║  `enroll.ts` has been writing that value since Phase 10 and every metric   ║
 * ║  counting profile work reads it.                                          ║
 * ║                                                                           ║
 * ║  Adding a `VISIT_PROFILE` kind to make the two names match would be one    ║
 * ║  question with two implementations — the defect class this codebase pays   ║
 * ║  for most often — and it would ship already broken, splitting existing     ║
 * ║  history across two labels for the same act.                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ RETURNS `null` FOR INTERNAL STEPS rather than a placeholder kind. `WAIT`
 * and `ADD_TAG` create no row in `linkedin_tasks` at all, and a kind for them
 * would be a value that exists only to be filtered out again.
 */
export function taskKindFor(action: StepAction): TaskKindValue | null {
  switch (action) {
    case 'VISIT_PROFILE':
      return 'REVIEW_PROFILE'
    case 'CONNECTION_REQUEST':
      return 'CONNECTION_REQUEST'
    case 'DIRECT_MESSAGE':
      return 'DIRECT_MESSAGE'
    case 'INMAIL':
      return 'INMAIL'
    case 'LIKE_POST':
      return 'LIKE_POST'
    case 'COMMENT_POST':
      return 'COMMENT_POST'
    case 'ADD_TAG':
    case 'WAIT':
      return null
  }
}

/**
 * ⚠️ THE GENERATED DATABASE TYPE, NOT A HAND-WRITTEN UNION. `outcomes.ts`
 * declares its own `TaskKind` by hand and 0130 has just widened the real enum;
 * importing the generated type means `taskKindFor` stops compiling if the two
 * ever drift, rather than failing on write.
 */
type TaskKindValue = Database['public']['Enums']['linkedin_task_kind']

/**
 * Steps that count against a sender's daily budget.
 *
 * ⚠️ ENGAGEMENT COUNTS TOO. §4.10 caps profile views as well as invitations, and
 * liking or commenting is at least as visible to LinkedIn's rate limiting as
 * viewing is. A step exempted here is a step that can be repeated without limit
 * from an account somebody actually owns.
 */
export function consumesBudget(action: StepAction): boolean {
  return producesTask(action)
}

/**
 * The outcomes a result form may offer for one step.
 *
 * ⚠️ THE `ALWAYS` THREE ARE NOT NEGOTIABLE AND ARE NOT DERIVED FROM THE
 * WORKFLOW. Skipped, failed and "I cannot say" have to be offerable on every
 * card no matter what the customer built, because they describe what happened to
 * the *operator*, not to the campaign. Removing `OUTCOME_UNKNOWN` from a step
 * would leave somebody who genuinely cannot tell with no honest answer — and
 * §4.17 exists because the dishonest answer they would pick instead is "sent".
 */
export const ALWAYS_OFFERED: readonly TaskOutcome[] = ['SKIPPED', 'FAILED', 'OUTCOME_UNKNOWN']

export function outcomesForStep(action: StepAction): readonly TaskOutcome[] {
  const positive = positiveOutcomeFor(action)
  return positive ? [positive, ...ALWAYS_OFFERED] : [...ALWAYS_OFFERED]
}

/**
 * Every affirmative outcome a campaign's steps can produce.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THIS IS THE OWNER'S REQUIREMENT, AND IT REPLACES A CONSTANT WITH A    ║
 * ║  FUNCTION.                                                                ║
 * ║                                                                           ║
 * ║    "once its save then they have the option on actions they added only    ║
 * ║     not fixed actions like, sent connection, booked a meeting, etc etc"   ║
 * ║                                                                           ║
 * ║  Before this, `allowedOutcomes(kind)` answered from a fixed per-kind map,  ║
 * ║  so a workspace that never sends InMail was still offered InMail-shaped    ║
 * ║  vocabulary somewhere in the product. Now the answer comes from the steps  ║
 * ║  the customer actually built: no InMail step, no "message sent" from       ║
 * ║  InMail, and no engagement outcomes in a campaign that only messages.      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ IT DOES NOT WIDEN WHAT A TASK MAY RECORD. The per-step answer above is
 * still the gate on a result form. This is the campaign-level *union*, for
 * filters, reports and the analysis view — the places that ask "what can happen
 * in this campaign at all" rather than "what happened to this card".
 */
export function campaignOutcomes(
  actions: readonly StepAction[],
): readonly TaskOutcome[] {
  const positive: TaskOutcome[] = []
  for (const action of actions) {
    const outcome = positiveOutcomeFor(action)
    // Deduplicated: INMAIL and DIRECT_MESSAGE share one, by design.
    if (outcome && !positive.includes(outcome)) positive.push(outcome)
  }
  return [...positive, ...ALWAYS_OFFERED]
}

export function isStepAction(value: string): value is StepAction {
  return (STEP_ACTIONS as readonly string[]).includes(value)
}
