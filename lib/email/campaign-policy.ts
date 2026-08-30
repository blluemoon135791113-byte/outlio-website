/**
 * What each campaign type is allowed to do — M6 Phase 15.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  FOUR DIFFERENT PRODUCTS, NOT ONE WITH A LABEL.                          ║
 * ║                                                                           ║
 * ║  The brief requires "distinct behaviors, not one code path", and the      ║
 * ║  differences are not cosmetic:                                            ║
 * ║                                                                           ║
 * ║   - A SALES SEQUENCE must stop when someone replies. Continuing to mail   ║
 * ║     a person who already answered is the single behaviour that makes      ║
 * ║     people hate outbound.                                                 ║
 * ║   - A MARKETING BROADCAST must NOT stop on reply — a reply to a           ║
 * ║     newsletter is a conversation, not an objection — and MUST carry a     ║
 * ║     one-click unsubscribe, which is a legal requirement for bulk mail.    ║
 * ║   - A FLOW-DRIVEN campaign has its steps chosen by the Flow engine, so    ║
 * ║     the sequence scheduler must not advance it on its own.                ║
 * ║   - A MANUAL send is one message a person chose to send to one recipient. ║
 * ║                                                                           ║
 * ║  Collapsing these into one engine with feature flags is how a broadcast   ║
 * ║  silently halts on its first reply, or a sales sequence keeps mailing     ║
 * ║  someone who already said yes.                                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

export type CampaignType =
  | 'sales_sequence'
  | 'marketing_broadcast'
  | 'flow_driven'
  | 'manual'

export type CampaignPolicy = {
  /** More than one step in the sequence. */
  allowsMultipleSteps: boolean
  /** A reply from the recipient ends the enrollment. */
  stopsOnReply: boolean
  /**
   * ⚠️ RFC 8058 one-click unsubscribe. Required for bulk marketing mail by
   * Google and Yahoo since 2024, and by law in most jurisdictions.
   */
  requiresUnsubscribe: boolean
  /** The built-in scheduler advances steps; false means something else does. */
  selfAdvancing: boolean
  /** A contact may be enrolled again after a previous enrollment ended. */
  allowsReEnrollment: boolean
  /**
   * ⚠️ ALWAYS TRUE, ON EVERY TYPE. Listed explicitly rather than assumed, so
   * that anyone adding a fifth type has to look at it and decide — and so
   * that "transactional mail is exempt" can never quietly become an option.
   * A person who asked not to be contacted did not carve out exceptions.
   */
  respectsSuppression: true
}

const POLICIES: Record<CampaignType, CampaignPolicy> = {
  sales_sequence: {
    allowsMultipleSteps: true,
    stopsOnReply: true,
    // A one-to-one sales email is not bulk marketing, so the header is not
    // legally required — but see `shouldIncludeUnsubscribe` below.
    requiresUnsubscribe: false,
    selfAdvancing: true,
    allowsReEnrollment: true,
    respectsSuppression: true,
  },

  marketing_broadcast: {
    // One message to many people. A "multi-step broadcast" is a sequence
    // wearing a disguise, and it would dodge the reply-stop rule.
    allowsMultipleSteps: false,
    /*
     * ⚠️ DOES NOT STOP ON REPLY, and this is the type's defining difference.
     * Someone replying "thanks, great newsletter" has not opted out. Stopping
     * would quietly unsubscribe your most engaged readers.
     */
    stopsOnReply: false,
    requiresUnsubscribe: true,
    selfAdvancing: true,
    allowsReEnrollment: true,
    respectsSuppression: true,
  },

  flow_driven: {
    allowsMultipleSteps: true,
    stopsOnReply: true,
    requiresUnsubscribe: false,
    /*
     * ⚠️ NOT SELF-ADVANCING. The Flow engine (M7) decides what happens after
     * each step — that is the whole point of the type. If the sequence
     * scheduler also advanced it, every contact would receive each step twice,
     * once from each engine.
     */
    selfAdvancing: false,
    allowsReEnrollment: true,
    respectsSuppression: true,
  },

  manual: {
    allowsMultipleSteps: false,
    stopsOnReply: false,
    requiresUnsubscribe: false,
    selfAdvancing: false,
    allowsReEnrollment: true,
    respectsSuppression: true,
  },
}

export function policyFor(type: CampaignType): CampaignPolicy {
  return POLICIES[type]
}

/**
 * Whether a given step should stop the enrollment when a reply arrives.
 *
 * A step may override its campaign's default; `null` inherits.
 */
export function stepStopsOnReply(type: CampaignType, stepOverride: boolean | null): boolean {
  return stepOverride ?? policyFor(type).stopsOnReply
}

/**
 * Whether this message should carry a `List-Unsubscribe` header.
 *
 * ⚠️ RETURNS TRUE FOR SALES SEQUENCES TOO, even though they are not legally
 * bulk mail. The header costs nothing, gives the recipient a one-click exit
 * that is far better for the sender than a spam complaint, and Gmail weighs
 * its presence favourably. The `requiresUnsubscribe` policy flag is about
 * whether a campaign may LAUNCH without one; this is about what we actually
 * send, and the answer is always yes.
 */
export function shouldIncludeUnsubscribe(type: CampaignType): boolean {
  return type !== 'manual'
}

export class CampaignPolicyError extends Error {}

export type LaunchInput = {
  type: CampaignType
  stepCount: number
  hasAccount: boolean
  hasUnsubscribeSupport: boolean
  enrollmentCount: number
}

/**
 * Whether a campaign may be launched.
 *
 * ⚠️ CHECKED SERVER-SIDE BEFORE ANY MESSAGE IS QUEUED. A campaign that starts
 * and then discovers it is misconfigured has already mailed people.
 */
export function assertLaunchable(input: LaunchInput): void {
  const policy = policyFor(input.type)

  if (input.stepCount === 0) {
    throw new CampaignPolicyError('This campaign has no steps, so there is nothing to send.')
  }

  if (!policy.allowsMultipleSteps && input.stepCount > 1) {
    throw new CampaignPolicyError(
      input.type === 'marketing_broadcast'
        ? 'A broadcast sends one message. For a multi-step follow-up, use a sales sequence — it stops when someone replies, which a broadcast does not.'
        : 'This campaign type sends a single message.',
    )
  }

  if (!input.hasAccount) {
    throw new CampaignPolicyError('Choose a mailbox to send this campaign from.')
  }

  if (policy.requiresUnsubscribe && !input.hasUnsubscribeSupport) {
    throw new CampaignPolicyError(
      'A marketing broadcast must include a one-click unsubscribe link. This is required by Gmail and Yahoo for bulk mail, and by law in most countries.',
    )
  }

  if (input.enrollmentCount === 0) {
    throw new CampaignPolicyError('No contacts are enrolled in this campaign yet.')
  }
}
