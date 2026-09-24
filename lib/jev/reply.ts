/**
 * Reply intent — the first Jev decision in the product. Pure; the network call
 * is injected so every branch here is testable without a key.
 *
 * ⚠️ THE ORDER IS RULE → MODEL → REVIEW, and each exists for a reason:
 *
 *   1. RULE. An explicit opt-out ("unsubscribe", "remove me", "stop emailing
 *      me") is decided by text matching, never by the model. A request not to
 *      be contacted must not depend on a probability.
 *   2. MODEL. Everything else is a bounded choice between eight labels.
 *   3. REVIEW. A low-confidence label, the model saying a person should read
 *      it, "unclear", or any failure — all come back as `needsReview`. A
 *      failure never becomes a guessed category.
 *
 * ⚠️ THE REVIEW THRESHOLD IS PROVISIONAL. The brief requires thresholds chosen
 * from evaluation against human-reviewed replies. No such set exists yet, so
 * the number below is deliberately conservative (more replies reach a person)
 * and must be replaced from evaluation results, not tuned by feel.
 */
import {
  JevError,
  frameState,
  guarded,
  type ChoiceAnswer,
  type JevErrorCode,
  type JevResult,
  type NoulAnswer,
  type QuestionSet,
} from '@/lib/jev/decision'

export const REPLY_INTENTS = [
  'interested',
  'more_info',
  'meeting_request',
  'referral',
  'not_interested',
  'unsubscribe',
  'out_of_office',
  'unclear',
] as const
export type ReplyIntent = (typeof REPLY_INTENTS)[number]

/** Provisional — see the header. Below this, a person reads the reply. */
export const REPLY_REVIEW_CONFIDENCE = 0.8
/** The model's own "a person should read this" probability, above which one does. */
export const REPLY_REVIEW_NOUL = 0.5

/** The longest body sent. Enough to judge intent; a quoted thread is not needed. */
export const REPLY_MAX_CHARS = 4000

export const REPLY_INTENT_QUESTIONS: QuestionSet = {
  id: 'reply-intent@1',
  questions: {
    intent: {
      type: 'choice',
      instructions: guarded(
        "Which label best describes what the reply's author wants in response to the sales outreach they received?",
      ),
      criteria: {
        interested: 'They express interest in the offer or in continuing the conversation.',
        more_info: 'They ask a question or request more information before deciding.',
        meeting_request: 'They ask for, propose or accept a meeting, call or specific time.',
        referral: 'They point the sender to a different person or team.',
        not_interested: 'They decline, now or in general, without asking to stop all contact.',
        unsubscribe: 'They ask not to be contacted again or to be removed from the list.',
        out_of_office: 'It is an automatic absence or holiday notice.',
        unclear: 'None of the above clearly applies, or the intent is ambiguous.',
      },
    },
    needs_person: {
      type: 'noul',
      instructions: guarded(
        'Should a salesperson read this reply themselves before anything is done with it — for example because it is sensitive, angry, legal, mixed in intent, or asks something specific?',
      ),
    },
  },
}

/**
 * Explicit opt-out phrases. Matched on whole words, case-insensitively.
 *
 * ⚠️ DELIBERATELY BROAD. A false positive stops outreach to someone who did
 * not ask; a false negative keeps mailing someone who did. Only the second is
 * a compliance failure, so the list errs toward the first.
 */
const OPT_OUT_PATTERNS: readonly RegExp[] = [
  /\bunsubscribe\b/i,
  /\bremove me\b/i,
  /\btake me off\b/i,
  /\bopt(?:\s|-)?out\b/i,
  /\bstop (?:emailing|e-mailing|contacting|messaging|sending)\b/i,
  /\bdo not (?:email|contact|e-mail|message)\b/i,
  /\bdon'?t (?:email|contact|e-mail|message) me\b/i,
  /\bno more emails?\b/i,
]

export function detectOptOut(text: string): string | null {
  for (const pattern of OPT_OUT_PATTERNS) {
    const match = text.match(pattern)
    if (match) return match[0].toLowerCase()
  }
  return null
}

/**
 * Keeps only what the author wrote in THIS message, and removes contact details.
 *
 *   · Quoted history (`>` lines, and everything after an "On … wrote:" line) is
 *     our own earlier outreach — sending it would disclose it again and would
 *     let our wording colour the classification of theirs.
 *   · Email addresses and phone numbers become placeholders. A referral stays a
 *     referral ("contact [email]"); the address itself is not needed to see it.
 */
export function minimiseReply(body: string): string {
  const lines = body.replace(/\r\n?/g, '\n').split('\n')
  const kept: string[] = []
  for (const line of lines) {
    if (/^\s*On .{0,200}wrote:\s*$/i.test(line)) break
    if (/^\s*-{2,}\s*Original Message\s*-{2,}/i.test(line)) break
    if (/^\s*>/.test(line)) continue
    kept.push(line)
  }
  return kept
    .join('\n')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\+?\(?\d[\d\s().-]{7,}\d/g, (candidate) => {
      // A date or a time is part of a meeting request, not a contact detail.
      if (/^\d{4}-\d{2}-\d{2}/.test(candidate) || /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(candidate)) {
        return candidate
      }
      const digits = candidate.replace(/\D/g, '').length
      return digits >= 9 && digits <= 15 ? '[phone]' : candidate
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, REPLY_MAX_CHARS)
}

export type ReplyInput = {
  subject: string | null
  body: string
  /** The sync-time classification (`reply`, `auto_reply`, `bounce`), when stored. */
  storedKind?: string | null
}

export type ReplyDecision = {
  intent: ReplyIntent
  needsReview: boolean
  /** Who decided: a text rule, the model, or nobody (a failure). */
  decidedBy: 'rule' | 'model' | 'fallback'
  /** The rule that fired, e.g. `opt-out: "remove me"`. Never message text beyond the match. */
  rule: string | null
  /** The model's confidence in its own label. Null when the model was not the decider. */
  confidence: number | null
  questionVersion: string
  model: string | null
  inputTokens: number
  errorCode: JevErrorCode | null
}

export type JevAsk = (set: QuestionSet, state: unknown) => Promise<JevResult>

function ruleDecision(intent: ReplyIntent, rule: string, needsReview: boolean): ReplyDecision {
  return {
    intent,
    needsReview,
    decidedBy: 'rule',
    rule,
    confidence: null,
    questionVersion: REPLY_INTENT_QUESTIONS.id,
    model: null,
    inputTokens: 0,
    errorCode: null,
  }
}

/** Rules that decide without the model, or `null` when the model is needed. */
export function decideReplyByRule(input: ReplyInput): ReplyDecision | null {
  if (input.storedKind === 'bounce') {
    // Not a reply at all. A person checks why a bounce reached a reply step.
    return ruleDecision('unclear', 'stored kind: bounce', true)
  }
  if (input.storedKind === 'auto_reply') {
    return ruleDecision('out_of_office', 'stored kind: auto_reply', false)
  }

  const optOut = detectOptOut(`${input.subject ?? ''}\n${minimiseReply(input.body)}`)
  if (optOut) {
    // Reviewed as well: suppression is a consequential action a person confirms.
    return ruleDecision('unsubscribe', `opt-out: "${optOut}"`, true)
  }

  if (minimiseReply(input.body).length === 0) {
    return ruleDecision('unclear', 'empty after removing quoted text', true)
  }

  return null
}

export async function classifyReply(input: ReplyInput, ask: JevAsk): Promise<ReplyDecision> {
  const byRule = decideReplyByRule(input)
  if (byRule) return byRule

  const state = frameState('An inbound email reply to sales outreach, to be labelled by intent.', {
    subject: (input.subject ?? '').slice(0, 300),
    body: minimiseReply(input.body),
  })

  let result: JevResult
  try {
    result = await ask(REPLY_INTENT_QUESTIONS, state)
  } catch (error) {
    return {
      intent: 'unclear',
      needsReview: true,
      decidedBy: 'fallback',
      rule: null,
      confidence: null,
      questionVersion: REPLY_INTENT_QUESTIONS.id,
      model: null,
      inputTokens: 0,
      errorCode: error instanceof JevError ? error.code : 'JEV_UNAVAILABLE',
    }
  }

  const intentAnswer = result.answers.intent as ChoiceAnswer
  const personAnswer = result.answers.needs_person as NoulAnswer
  const intent = intentAnswer.choice as ReplyIntent

  /*
   * ⚠️ THE MODEL MAY SAY "unsubscribe" EVEN WHEN NO RULE FIRED — someone wrote
   * "please leave me alone". That is accepted as the label and always
   * reviewed, so a person confirms the suppression rather than the model.
   */
  const needsReview =
    intent === 'unclear' ||
    intent === 'unsubscribe' ||
    intentAnswer.confidence < REPLY_REVIEW_CONFIDENCE ||
    personAnswer.noul >= REPLY_REVIEW_NOUL

  return {
    intent,
    needsReview,
    decidedBy: 'model',
    rule: null,
    confidence: intentAnswer.confidence,
    questionVersion: REPLY_INTENT_QUESTIONS.id,
    model: result.model,
    inputTokens: result.usage.inputTokens,
    errorCode: null,
  }
}
