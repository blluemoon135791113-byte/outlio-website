/**
 * Campaign type behaviours — M6 Phase 15.
 *
 * The brief requires "distinct behaviors, not one code path". The two failures
 * this file exists to prevent are opposites, and both are silent:
 *
 *   - A SALES SEQUENCE that keeps mailing someone who already replied. This is
 *     the single behaviour that makes people hate outbound.
 *   - A MARKETING BROADCAST that stops when someone replies, quietly
 *     unsubscribing your most engaged readers for saying "thanks".
 */
import { describe, expect, it } from 'vitest'

import {
  assertLaunchable,
  CampaignPolicyError,
  policyFor,
  shouldIncludeUnsubscribe,
  stepStopsOnReply,
  type CampaignType,
} from '@/lib/email/campaign-policy'

const ALL: CampaignType[] = ['sales_sequence', 'marketing_broadcast', 'flow_driven', 'manual']

describe('reply handling is the defining difference', () => {
  it('stops a sales sequence on reply', () => {
    expect(policyFor('sales_sequence').stopsOnReply).toBe(true)
  })

  it('does NOT stop a marketing broadcast on reply', () => {
    // "Thanks, great newsletter" is not an opt-out.
    expect(policyFor('marketing_broadcast').stopsOnReply).toBe(false)
  })

  it('lets a step override its campaign default', () => {
    expect(stepStopsOnReply('marketing_broadcast', true)).toBe(true)
    expect(stepStopsOnReply('sales_sequence', false)).toBe(false)
  })

  it('inherits the campaign default when the step does not say', () => {
    expect(stepStopsOnReply('sales_sequence', null)).toBe(true)
    expect(stepStopsOnReply('marketing_broadcast', null)).toBe(false)
  })
})

describe('suppression is honoured by every type, with no exceptions', () => {
  it.each(ALL)('%s respects suppression', (type) => {
    /*
     * Listed explicitly rather than assumed, so that anyone adding a fifth
     * type has to look at it — and so "transactional mail is exempt" can never
     * quietly become an option. A person who asked not to be contacted did not
     * carve out exceptions.
     */
    expect(policyFor(type).respectsSuppression).toBe(true)
  })
})

describe('a broadcast is a single message', () => {
  it('does not allow multiple steps', () => {
    expect(policyFor('marketing_broadcast').allowsMultipleSteps).toBe(false)
  })

  it('refuses to launch with more than one step, and says what to use instead', () => {
    // A "multi-step broadcast" is a sequence in disguise, and it would dodge
    // the reply-stop rule entirely.
    expect(() =>
      assertLaunchable({
        type: 'marketing_broadcast',
        stepCount: 3,
        hasAccount: true,
        hasUnsubscribeSupport: true,
        enrollmentCount: 10,
      senderPostalAddress: '9 Example Street, Springfield, IL 62704',
      }),
    ).toThrow(/sales sequence/)
  })
})

describe('flow-driven campaigns do not advance themselves', () => {
  it('is not self-advancing', () => {
    /*
     * The Flow engine decides what happens after each step. If the sequence
     * scheduler also advanced it, every contact would get each step twice —
     * once from each engine.
     */
    expect(policyFor('flow_driven').selfAdvancing).toBe(false)
  })

  it('unlike a sales sequence, which is', () => {
    expect(policyFor('sales_sequence').selfAdvancing).toBe(true)
  })
})

describe('unsubscribe', () => {
  it('is required to launch a marketing broadcast', () => {
    expect(() =>
      assertLaunchable({
        type: 'marketing_broadcast',
        stepCount: 1,
        hasAccount: true,
        hasUnsubscribeSupport: false,
        enrollmentCount: 10,
      senderPostalAddress: '9 Example Street, Springfield, IL 62704',
      }),
    ).toThrow(/one-click unsubscribe/)
  })

  it('is not required to launch a sales sequence', () => {
    expect(() =>
      assertLaunchable({
        type: 'sales_sequence',
        stepCount: 2,
        hasAccount: true,
        hasUnsubscribeSupport: false,
        enrollmentCount: 10,
      senderPostalAddress: '9 Example Street, Springfield, IL 62704',
      }),
    ).not.toThrow()
  })

  it('is still SENT on a sales sequence, even though it is not required', () => {
    /*
     * The header costs nothing, gives the recipient a one-click exit that is
     * far better for the sender than a spam complaint, and Gmail weighs its
     * presence favourably. "Not legally required" is not a reason to omit it.
     */
    expect(shouldIncludeUnsubscribe('sales_sequence')).toBe(true)
    expect(shouldIncludeUnsubscribe('marketing_broadcast')).toBe(true)
  })

  it('is omitted only from a one-off manual send', () => {
    // A single email a person typed to one recipient is correspondence, not a
    // mailing, and an unsubscribe footer on it would be strange.
    expect(shouldIncludeUnsubscribe('manual')).toBe(false)
  })
})

describe('launch validation catches misconfiguration before anyone is mailed', () => {
  const valid = {
    type: 'sales_sequence' as CampaignType,
    stepCount: 3,
    hasAccount: true,
    hasUnsubscribeSupport: true,
    enrollmentCount: 25,
      senderPostalAddress: '9 Example Street, Springfield, IL 62704',
  }

  it('accepts a well-formed campaign', () => {
    expect(() => assertLaunchable(valid)).not.toThrow()
  })

  it('refuses a campaign with no steps', () => {
    expect(() => assertLaunchable({ ...valid, stepCount: 0 })).toThrow(CampaignPolicyError)
  })

  it('refuses a campaign with no mailbox', () => {
    expect(() => assertLaunchable({ ...valid, hasAccount: false })).toThrow(/Choose a mailbox/)
  })

  it('refuses a campaign with nobody enrolled', () => {
    // Launching into an empty audience looks like success and does nothing,
    // which is worse than an error.
    expect(() => assertLaunchable({ ...valid, enrollmentCount: 0 })).toThrow(/No contacts/)
  })
})
