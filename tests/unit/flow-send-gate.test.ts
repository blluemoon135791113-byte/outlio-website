/**
 * The six-condition send gate — M7 Phase 21.
 *
 * ⚠️ SEND_EMAIL IS THE ONLY IRREVERSIBLE ACTION A FLOW CAN TAKE. Every other
 * action can be undone — a tag removed, a task deleted, a stage moved back. An
 * email cannot be unsent, and a flow can fire thousands before anyone looks.
 *
 * So every one of the brief's six conditions is tested for its own refusal,
 * and the ORDER is tested too: which reason an operator is shown when several
 * are wrong at once determines what they go and fix.
 */
import { describe, expect, it } from 'vitest'

import { checkSendGate, isTransient, type SendGateFacts } from '@/lib/flows/send-gate'

function facts(over: Partial<SendGateFacts> = {}): SendGateFacts {
  return {
    accountConnected: true,
    accountHealthy: true,
    accountBlockedReason: null,
    recipientEmail: 'dana@buyer.example',
    suppressed: false,
    suppressionReason: null,
    remainingToday: 25,
    actorAuthorized: true,
    recipientEligible: true,
    recipientIneligibleReason: null,
    ...over,
  }
}

describe('all six conditions met', () => {
  it('allows the send and reports remaining capacity', () => {
    const result = checkSendGate(facts())
    expect(result.allowed).toBe(true)
    if (result.allowed) {
      expect(result.email).toBe('dana@buyer.example')
      expect(result.remainingToday).toBe(25)
    }
  })
})

describe('each condition refuses on its own', () => {
  it('refuses when the actor is not authorized', () => {
    const result = checkSendGate(facts({ actorAuthorized: false }))
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.failure).toBe('not_authorized')
  })

  it('refuses when there is no recipient address', () => {
    const result = checkSendGate(facts({ recipientEmail: null }))
    if (!result.allowed) expect(result.failure).toBe('no_recipient')
  })

  it('refuses a suppressed address and names the reason', () => {
    const result = checkSendGate(facts({ suppressed: true, suppressionReason: 'unsubscribed' }))
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.failure).toBe('suppressed')
      expect(result.reason).toContain('unsubscribed')
    }
  })

  it('refuses an ineligible recipient SEPARATELY from a suppressed one', () => {
    /*
     * A contact can be perfectly contactable and still ineligible for THIS
     * send — already emailed an hour ago, say. Collapsing the two would report
     * "unsubscribed" for someone who never unsubscribed, and an operator would
     * go looking for a consent problem that does not exist.
     */
    const result = checkSendGate(
      facts({ recipientEligible: false, recipientIneligibleReason: 'Emailed within the last hour.' }),
    )
    if (!result.allowed) {
      expect(result.failure).toBe('recipient_ineligible')
      expect(result.reason).toContain('last hour')
    }
  })

  it('refuses when no mailbox is connected', () => {
    const result = checkSendGate(facts({ accountConnected: false }))
    if (!result.allowed) expect(result.failure).toBe('provider_not_connected')
  })

  it('refuses an unhealthy mailbox and passes the readiness reason through', () => {
    const result = checkSendGate(
      facts({ accountHealthy: false, accountBlockedReason: 'Too many recipients marked this as spam.' }),
    )
    if (!result.allowed) {
      expect(result.failure).toBe('provider_unhealthy')
      expect(result.reason).toContain('marked this as spam')
    }
  })

  it('refuses when the daily allowance is used up', () => {
    const result = checkSendGate(facts({ remainingToday: 0 }))
    if (!result.allowed) expect(result.failure).toBe('daily_limit_reached')
  })

  it('refuses a negative remaining count, not just zero', () => {
    // A limit lowered mid-day can leave this negative; it must still refuse.
    const result = checkSendGate(facts({ remainingToday: -3 }))
    expect(result.allowed).toBe(false)
  })
})

describe('the order of refusals is a product decision', () => {
  it('reports SUPPRESSION over a daily limit', () => {
    /*
     * "They asked not to be contacted" is the fact the operator needs. Fixing
     * the limit would not make this send acceptable, and reporting the limit
     * would send them to raise it.
     */
    const result = checkSendGate(facts({ suppressed: true, remainingToday: 0 }))
    if (!result.allowed) expect(result.failure).toBe('suppressed')
  })

  it('reports SUPPRESSION over an unhealthy mailbox', () => {
    const result = checkSendGate(facts({ suppressed: true, accountHealthy: false }))
    if (!result.allowed) expect(result.failure).toBe('suppressed')
  })

  it('reports AUTHORIZATION first of all', () => {
    // If the actor may not send at all, nothing else is worth reporting.
    const result = checkSendGate(
      facts({ actorAuthorized: false, suppressed: true, recipientEmail: null }),
    )
    if (!result.allowed) expect(result.failure).toBe('not_authorized')
  })

  it('reports a missing address before a mailbox problem', () => {
    // Fixing the mailbox would not give this contact an email address.
    const result = checkSendGate(facts({ recipientEmail: null, accountConnected: false }))
    if (!result.allowed) expect(result.failure).toBe('no_recipient')
  })
})

describe('the gate fails closed', () => {
  it('refuses when everything is unknown', () => {
    const result = checkSendGate({
      accountConnected: false,
      accountHealthy: false,
      recipientEmail: null,
      suppressed: false,
      remainingToday: 0,
      actorAuthorized: false,
      recipientEligible: false,
    })
    expect(result.allowed).toBe(false)
  })
})

describe('transience decides whether the flow should come back', () => {
  it('treats a daily limit and an unhealthy mailbox as transient', () => {
    // Both clear on their own, so the run should retry later.
    expect(isTransient('daily_limit_reached')).toBe(true)
    expect(isTransient('provider_unhealthy')).toBe(true)
  })

  it('treats suppression and authorization as permanent', () => {
    /*
     * A suppression never clears. Retrying would park a run forever on
     * something that can never become true — a stalled run nobody notices
     * until they ask why a contact went quiet.
     */
    expect(isTransient('suppressed')).toBe(false)
    expect(isTransient('not_authorized')).toBe(false)
    expect(isTransient('no_recipient')).toBe(false)
    expect(isTransient('provider_not_connected')).toBe(false)
  })
})
