/**
 * Readiness scoring and state transitions — M5 Phase 13.
 *
 * M5 ACCEPTANCE CRITERION 5 (state transitions half; the domain rollup half is
 * proven in `supabase/smoke/0087_email_readiness.sql`).
 *
 * ⚠️ THE MOST IMPORTANT TEST IN THIS FILE IS THE ONE ASSERTING WHAT THE SCORE
 * IS NOT. Everything else is arithmetic; the claim that this number is not an
 * inbox-placement figure is the honesty commitment.
 */
import { describe, expect, it } from 'vitest'

import type { DomainAuthResult } from '@/lib/email/dns'
import {
  assessReadiness,
  canSendFrom,
  rateOf,
  SCORE_CAVEAT,
  THRESHOLDS,
  type ReadinessInput,
} from '@/lib/email/readiness'

const perfectDomain: DomainAuthResult = {
  domain: 'acme.example',
  spf: { status: 'pass', detail: 'ok' },
  dkim: { status: 'pass', detail: 'ok' },
  dmarc: { status: 'pass', detail: 'ok', policy: 'reject' },
}

function input(over: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    accountStatus: 'connected',
    connectionOk: true,
    domain: perfectDomain,
    fromDomainAligned: true,
    listUnsubscribeCapable: true,
    sent24h: 40,
    sent7d: 300,
    bounced: 0,
    complained: 0,
    rampInProgress: false,
    ...over,
  }
}

describe('the score never claims inbox placement', () => {
  it('says so in the caveat that ships with it', () => {
    // Nobody outside the mailbox providers can measure inbox placement.
    // Claiming it would be inventing data.
    expect(SCORE_CAVEAT).toContain('not an inbox-placement figure')
  })

  it('is built only from configuration and observed outcomes', () => {
    const ids = assessReadiness(input()).checks.map((c) => c.id).sort()
    expect(ids).toEqual([
      'alignment', 'bounce_rate', 'complaint_rate', 'connection', 'dkim',
      'dmarc', 'list_unsubscribe', 'spf', 'volume',
    ])
  })

  it('always ships an explanation alongside the number', () => {
    // "Your score is 62" is a support ticket, not an answer.
    const result = assessReadiness(input({ domain: { ...perfectDomain, spf: { status: 'fail', detail: 'No SPF record.' } } }))
    expect(result.checks.every((c) => c.detail.length > 0)).toBe(true)
    expect(result.checks.find((c) => c.id === 'spf')!.detail).toBe('No SPF record.')
  })
})

describe('a healthy mailbox', () => {
  it('scores 100 and is ready', () => {
    const result = assessReadiness(input())
    expect(result.score).toBe(100)
    expect(result.state).toBe('ready')
    expect(canSendFrom(result)).toBe(true)
  })

  it('is RAMPING rather than READY while the ramp is climbing', () => {
    const result = assessReadiness(input({ rampInProgress: true }))
    expect(result.state).toBe('ramping')
    // Ramping is healthy: it must NOT block sending, or the ramp could never
    // progress in the first place.
    expect(canSendFrom(result)).toBe(true)
  })
})

describe('unknown is not the same as failed', () => {
  it('scores an unverifiable DKIM at half, not zero', () => {
    /*
     * A domain using a custom selector is correctly configured and we simply
     * cannot see it. Scoring zero would panic a working customer; scoring full
     * would tell someone with no DKIM at all that they are fine.
     */
    const unknownDkim = assessReadiness(
      input({ domain: { ...perfectDomain, dkim: { status: 'unknown', detail: 'not found' } } }),
    )
    const failedDkim = assessReadiness(
      input({ domain: { ...perfectDomain, dkim: { status: 'fail', detail: 'revoked' } } }),
    )

    expect(unknownDkim.score).toBeGreaterThan(failedDkim.score)
    expect(unknownDkim.score).toBeLessThan(100)
  })

  it('does not block sending merely because a check could not be verified', () => {
    const result = assessReadiness(
      input({ domain: { ...perfectDomain, dkim: { status: 'unknown', detail: 'not found' } } }),
    )
    expect(canSendFrom(result)).toBe(true)
  })
})

describe('rates need enough volume to mean anything', () => {
  it('returns null rather than a misleading percentage on a tiny sample', () => {
    // One bounce out of three sends is not a 33% bounce rate; it is 3 sends.
    // Reporting 33% would pause a brand-new mailbox on its first afternoon.
    expect(rateOf(1, 3)).toBeNull()
    expect(rateOf(1, THRESHOLDS.minimumVolumeForRates - 1)).toBeNull()
  })

  it('computes the rate once the sample is large enough', () => {
    expect(rateOf(1, 20)).toBeCloseTo(0.05)
  })

  it('does not block a new mailbox whose only two sends both bounced', () => {
    const result = assessReadiness(input({ sent7d: 2, sent24h: 2, bounced: 2 }))
    expect(result.bounceRate).toBeNull()
    expect(canSendFrom(result)).toBe(true)
    expect(result.checks.find((c) => c.id === 'bounce_rate')!.status).toBe('unknown')
  })
})

describe('the complaint gate', () => {
  it('blocks at 0.3%, the brief’s ceiling', () => {
    // 3 complaints in 1000 = 0.3% exactly.
    const result = assessReadiness(input({ sent7d: 1000, complained: 3 }))
    expect(result.state).toBe('warning')
    expect(canSendFrom(result)).toBe(false)
    expect(result.blockedReason).toContain('marked this mail as spam')
  })

  it('warns but keeps sending below the gate', () => {
    // 0.15%: above the warning line, below the ceiling.
    const result = assessReadiness(input({ sent7d: 2000, complained: 3 }))
    expect(result.state).toBe('warning')
    expect(canSendFrom(result)).toBe(true)
  })

  it('stays ready well below the warning line', () => {
    const result = assessReadiness(input({ sent7d: 10_000, complained: 1 }))
    expect(result.state).toBe('ready')
  })
})

describe('the bounce gate', () => {
  it('blocks at 10%', () => {
    const result = assessReadiness(input({ sent7d: 100, bounced: 10 }))
    expect(canSendFrom(result)).toBe(false)
    expect(result.blockedReason).toContain('Clean the list')
  })

  it('warns at 5% without blocking', () => {
    const result = assessReadiness(input({ sent7d: 100, bounced: 5 }))
    expect(result.state).toBe('warning')
    expect(canSendFrom(result)).toBe(true)
  })
})

describe('state precedence is most-severe-first', () => {
  it('reports DISCONNECTED over a bad bounce rate', () => {
    /*
     * Telling someone to clean their list when the real problem is that we
     * cannot sign in sends them to fix the wrong thing.
     */
    const result = assessReadiness(
      input({ accountStatus: 'disconnected', sent7d: 100, bounced: 50 }),
    )
    expect(result.state).toBe('disconnected')
  })

  it('reports AUTHENTICATION_REQUIRED when sign-in specifically failed', () => {
    const result = assessReadiness(
      input({ connectionOk: false, authenticationFailed: true }),
    )
    expect(result.state).toBe('authentication_required')
    expect(result.blockedReason).toContain('Reconnect')
  })

  it('reports ERROR when the mailbox is unreachable for another reason', () => {
    const result = assessReadiness(input({ connectionOk: false, authenticationFailed: false }))
    expect(result.state).toBe('error')
  })

  it('reports PAUSED over RAMPING', () => {
    const result = assessReadiness(input({ accountStatus: 'paused', rampInProgress: true }))
    expect(result.state).toBe('paused')
    expect(canSendFrom(result)).toBe(false)
  })

  it('reports THROTTLED over a warning-level bounce rate', () => {
    const result = assessReadiness(input({ throttled: true, sent7d: 100, bounced: 6 }))
    expect(result.state).toBe('throttled')
  })

  it('reports NOT_CONFIGURED for a mailbox that never connected', () => {
    const result = assessReadiness(input({ accountStatus: 'not_configured' }))
    expect(result.state).toBe('not_configured')
    expect(canSendFrom(result)).toBe(false)
  })
})

describe('misalignment is flagged without blocking', () => {
  it('warns when the From domain does not match the authenticated one', () => {
    const result = assessReadiness(input({ fromDomainAligned: false }))
    expect(result.checks.find((c) => c.id === 'alignment')!.status).toBe('warn')
    expect(result.score).toBeLessThan(100)
    // It hurts deliverability but does not make sending unsafe.
    expect(canSendFrom(result)).toBe(true)
  })
})
