/**
 * The check immediately before an action becomes possible — §4.7.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  "PENDING OUTREACH STEPS MUST FAIL THEIR PREFLIGHT ONCE THAT VERSION      ║
 * ║  CHANGES. LOST UI NOTIFICATIONS MUST NOT RESTORE ACTION PERMISSION."      ║
 * ║                                                                           ║
 * ║  This is the durable-cancellation guarantee, and it is a VERSION check     ║
 * ║  rather than a message. A cancellation delivered as a notification can be  ║
 * ║  missed — a dropped websocket, a closed laptop, a stale tab — and if       ║
 * ║  missing it leaves the task clickable, then the guarantee is "usually".    ║
 * ║                                                                           ║
 * ║  Comparing the version the approval was granted at against the contact's   ║
 * ║  version now inverts that: permission has to be RE-EARNED at the moment    ║
 * ║  of use, so anything that failed to arrive fails closed by construction.  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ IT RUNS TWICE, AND NEITHER RUN MAKES THE OTHER REDUNDANT. §4.7 asks for
 * it "immediately before a provider dispatch OR revealing a task as ready to
 * perform". A reply can land in the minutes between a task appearing in the
 * inbox and an operator clicking it.
 */
import type { StopChannel } from '@/lib/crm/contact-stop'

/** Where the check is being made, which changes only the wording. */
export type PreflightStage = 'release' | 'dispatch'

export type SenderCondition =
  | 'ok'
  | 'warning'
  | 'restricted'
  | 'paused'
  | 'limit_reached'
  | 'disconnected'

export type PreflightInput = {
  channel: StopChannel
  stage: PreflightStage
  /** The contact's state version when this content was approved. */
  approvedAtContactVersion: number
  /** The contact's version now. Any change invalidates the approval. */
  currentContactVersion: number
  /** From `contactIsStopped` — already fails closed on a lookup error. */
  contactStopped: boolean
  senderCondition: SenderCondition
  /** When the owner last looked at the real LinkedIn thread. */
  lastThreadCheckAt: Date | null
  /** How old a thread check may be. §4.13 holds tasks lacking one. */
  threadCheckMaxAgeMs: number
  now: Date
}

export type PreflightRefusal =
  | 'CONTACT_STOPPED'
  | 'APPROVAL_STALE'
  | 'SENDER_RESTRICTED'
  | 'SENDER_PAUSED'
  | 'SENDER_LIMIT_REACHED'
  | 'SENDER_DISCONNECTED'
  | 'THREAD_CHECK_STALE'

export type PreflightResult =
  | { ok: true }
  | { ok: false; refusal: PreflightRefusal }

/** A thread check is required and one hour old is already stale enough. */
export const DEFAULT_THREAD_CHECK_MAX_AGE_MS = 60 * 60 * 1000

/**
 * Whether this action may proceed right now.
 *
 * ⚠️ THE ORDER OF THE CHECKS IS THE DESIGN, not an accident of writing. They
 * are ordered by who is harmed, worst first:
 *
 *   1. The contact asked not to be contacted. Irreversible for them.
 *   2. The approval predates something that happened to the contact — most
 *      often a reply. Also about them, also not undoable once sent.
 *   3. The sender is restricted or warned. Harms the customer's own account.
 *   4. The sender is out of budget. Harms nothing yet; it is a wait.
 *   5. Nobody has looked at the thread recently enough. A process gap.
 *
 * A refusal returns the FIRST reason in that order, so the message an operator
 * sees is the most consequential true thing rather than whichever check
 * happened to run first.
 */
export function preflight(input: PreflightInput): PreflightResult {
  if (input.contactStopped) return { ok: false, refusal: 'CONTACT_STOPPED' }

  /*
   * ⚠️ `!==`, NOT `<`. A version that moved is a version that moved; using
   * "greater than" would let a counter that wrapped, reset, or was restored
   * from a backup read as "nothing has changed". The approval was granted
   * against one specific state of this contact and anything else is stale.
   */
  if (input.approvedAtContactVersion !== input.currentContactVersion) {
    return { ok: false, refusal: 'APPROVAL_STALE' }
  }

  switch (input.senderCondition) {
    case 'restricted':
      return { ok: false, refusal: 'SENDER_RESTRICTED' }
    case 'warning':
      /*
       * §4.10: a warning "immediately stops new proactive task release for the
       * affected sender". It is not a caution to be weighed — it is a stop,
       * and resuming needs the owner to have read the actual notice.
       */
      return { ok: false, refusal: 'SENDER_RESTRICTED' }
    case 'disconnected':
      return { ok: false, refusal: 'SENDER_DISCONNECTED' }
    case 'paused':
      return { ok: false, refusal: 'SENDER_PAUSED' }
    case 'limit_reached':
      return { ok: false, refusal: 'SENDER_LIMIT_REACHED' }
    case 'ok':
      break
  }

  /*
   * ⚠️ NO CHECK AT ALL IS STALE, NOT FRESH. `null` means nobody has looked at
   * the thread, and the tempting reading — "no check recorded, so nothing has
   * changed" — is exactly backwards. §4.13: "tasks lacking required review are
   * held."
   */
  if (input.lastThreadCheckAt === null) {
    return { ok: false, refusal: 'THREAD_CHECK_STALE' }
  }

  const age = input.now.getTime() - input.lastThreadCheckAt.getTime()
  /*
   * A check timestamped in the future is clock skew or a bad write, and
   * treating it as maximally fresh would make a wrong clock into permission.
   */
  if (age < 0 || age > input.threadCheckMaxAgeMs) {
    return { ok: false, refusal: 'THREAD_CHECK_STALE' }
  }

  return { ok: true }
}

/**
 * What the operator is told.
 *
 * ⚠️ NONE OF THESE BLAME THE READER OR NAME AN INTERNAL. A held task is
 * routine, and the sentence has to say what happened and what to do — the
 * house rule the product error boundary already follows.
 */
export function refusalMessage(refusal: PreflightRefusal): string {
  switch (refusal) {
    case 'CONTACT_STOPPED':
      return 'This person is on your do-not-contact list. Nothing further will be sent to them.'
    case 'APPROVAL_STALE':
      return 'Something changed for this contact since the draft was approved — most often a reply. Review the conversation before sending.'
    case 'SENDER_RESTRICTED':
      return 'This LinkedIn account has a warning or restriction recorded. Read the notice from LinkedIn, then resume the account to continue.'
    case 'SENDER_DISCONNECTED':
      return 'This LinkedIn account is no longer connected to the workspace.'
    case 'SENDER_PAUSED':
      return 'This LinkedIn account is paused. Resume it to release tasks again.'
    case 'SENDER_LIMIT_REACHED':
      return "This account has used its allowance for now. The task stays queued and becomes available when the allowance refreshes."
    case 'THREAD_CHECK_STALE':
      return 'Open the conversation in LinkedIn and confirm where it stands, then this task becomes available.'
  }
}
