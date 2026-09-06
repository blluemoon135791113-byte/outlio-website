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

/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS GUARD WAS LIVE AND ENTIRELY UNTESTED.                              ║
 * ║                                                                           ║
 * ║  Every existing case above passes a VALID `senderPostalAddress`, so the   ║
 * ║  branch that refuses a missing one was never taken. Deleting the whole    ║
 * ║  §7704(a)(5) check left all 20 tests passing — measured, not assumed.     ║
 * ║                                                                           ║
 * ║  A legal requirement enforced only by code nobody exercises is one        ║
 * ║  careless refactor away from not being enforced at all.                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
describe('a campaign that carries an unsubscribe footer needs a postal address', () => {
  const base = {
    type: 'sales_sequence' as const,
    stepCount: 2,
    hasAccount: true,
    hasUnsubscribeSupport: true,
    enrollmentCount: 5,
  }

  it('refuses when the address is null', () => {
    expect(() =>
      assertLaunchable({ ...base, senderPostalAddress: null }),
    ).toThrow(/postal address/i)
  })

  it('refuses whitespace and a too-short address', () => {
    // The column's own CHECK requires 10-500 characters. A blank string is the
    // realistic case: a text input submitted empty arrives as '', not null.
    expect(() => assertLaunchable({ ...base, senderPostalAddress: '' })).toThrow(
      CampaignPolicyError,
    )
    expect(() =>
      assertLaunchable({ ...base, senderPostalAddress: '          ' }),
    ).toThrow(CampaignPolicyError)
    expect(() => assertLaunchable({ ...base, senderPostalAddress: 'Box 1' })).toThrow(
      CampaignPolicyError,
    )
  })

  it('applies to every type that sends a footer, not only marketing_broadcast', () => {
    /*
     * The trap this exists to catch: tying the check to `requiresUnsubscribe`
     * (broadcast-only) instead of `shouldIncludeUnsubscribe` (everything except
     * manual) would leave every sales sequence sending a footer with no postal
     * address, while looking correct.
     */
    for (const type of ['sales_sequence', 'marketing_broadcast', 'flow_driven'] as const) {
      expect(() =>
        assertLaunchable({
          ...base,
          type,
          stepCount: type === 'marketing_broadcast' ? 1 : 2,
          senderPostalAddress: null,
        }),
      ).toThrow(/postal address/i)
    }
  })

  it('exempts manual sends, which carry no footer', () => {
    // A one-to-one reply with an unsubscribe link is both wrong and insulting.
    expect(() =>
      assertLaunchable({
        ...base,
        type: 'manual',
        stepCount: 1,
        senderPostalAddress: null,
      }),
    ).not.toThrow()
  })

  it('accepts a real address', () => {
    expect(() =>
      assertLaunchable({
        ...base,
        senderPostalAddress: '9 Example Street, Springfield, IL 62704',
      }),
    ).not.toThrow()
  })
})
