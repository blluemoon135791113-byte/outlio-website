/**
 * Exhaustive tests for the access decision — spec §8.5.
 *
 * Covers: every role, expiry, suspension, unverified email, and each plan limit
 * independently. Suspended and expired must produce DISTINCT reasons.
 */
import { describe, expect, it } from 'vitest'

import { decideAccess, decideLimits, withinLimit, type DecisionInput } from '@/lib/auth/decide'
import type { PlanLimits, UserRole } from '@/types/database'

const LIMITS: PlanLimits = {
  credits_per_month: 100,
  files_per_extraction: 25,
  leads_per_credit: 10,
  extractions_per_day: 10,
  extractions_per_month: 30,
  records_per_extraction: 5000,
  records_per_month: 10000,
  storage_bytes: 1073741824,
  exports_per_month: 50,
  retention_days: 90,
  contact_enrichments_per_month: 250,
  // Platform module entitlements (migration 0070). Irrelevant to the scraper
  // access decision, but part of the shape `planLimitsSchema` produces.
  crm_enabled: false,
  email_enabled: false,
  flows_enabled: false,
  reports_enabled: false,
  integrations_enabled: true,
  hubble_enabled: true,
  workspace_member_limit: 1,
}

const USAGE = { extractionsToday: 0, extractionsThisMonth: 0, recordsThisMonth: 0 }

function input(over: Partial<DecisionInput> = {}): DecisionInput {
  return {
    profile: {
      role: 'approved_user',
      access_expires_at: null,
      suspended_at: null,
      deleted_at: null,
    },
    emailVerified: true,
    limits: LIMITS,
    usage: USAGE,
    ...over,
  }
}

describe('decideAccess — roles', () => {
  const allowed: UserRole[] = ['approved_user', 'subscriber', 'admin']
  const denied: UserRole[] = ['registered_user', 'pending_user', 'suspended_user']

  for (const role of allowed) {
    it(`allows ${role}`, () => {
      const d = decideAccess(input({ profile: { role, access_expires_at: null, suspended_at: null, deleted_at: null } }))
      expect(d).toEqual({ canUseScraper: true, reason: 'ok' })
    })
  }

  for (const role of denied) {
    it(`denies ${role}`, () => {
      const d = decideAccess(input({ profile: { role, access_expires_at: null, suspended_at: null, deleted_at: null } }))
      expect(d.canUseScraper).toBe(false)
    })
  }

  it('gives registered_user reason=no_request', () => {
    const d = decideAccess(input({ profile: { role: 'registered_user', access_expires_at: null, suspended_at: null, deleted_at: null } }))
    expect(d.reason).toBe('no_request')
  })

  it('gives pending_user reason=pending — distinct from no_request', () => {
    const d = decideAccess(input({ profile: { role: 'pending_user', access_expires_at: null, suspended_at: null, deleted_at: null } }))
    expect(d.reason).toBe('pending')
  })
})

describe('decideAccess — suspension and expiry are DISTINCT', () => {
  it('suspended_user role → suspended', () => {
    const d = decideAccess(input({ profile: { role: 'suspended_user', access_expires_at: null, suspended_at: null, deleted_at: null } }))
    expect(d.reason).toBe('suspended')
  })

  it('suspended_at timestamp → suspended, even with a good role', () => {
    const d = decideAccess(input({
      profile: { role: 'subscriber', access_expires_at: null, suspended_at: '2020-01-01T00:00:00Z', deleted_at: null },
    }))
    expect(d.reason).toBe('suspended')
  })

  it('past access_expires_at → expired', () => {
    const d = decideAccess(input({
      profile: { role: 'approved_user', access_expires_at: '2020-01-01T00:00:00Z', suspended_at: null, deleted_at: null },
    }))
    expect(d.reason).toBe('expired')
  })

  it('future access_expires_at → ok', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString()
    const d = decideAccess(input({
      profile: { role: 'approved_user', access_expires_at: future, suspended_at: null, deleted_at: null },
    }))
    expect(d).toEqual({ canUseScraper: true, reason: 'ok' })
  })

  it('suspension outranks expiry', () => {
    const d = decideAccess(input({
      profile: { role: 'approved_user', access_expires_at: '2020-01-01T00:00:00Z', suspended_at: '2020-01-01T00:00:00Z', deleted_at: null },
    }))
    expect(d.reason).toBe('suspended')
  })

  it('suspension outranks admin', () => {
    const d = decideAccess(input({
      profile: { role: 'admin', access_expires_at: null, suspended_at: '2020-01-01T00:00:00Z', deleted_at: null },
    }))
    expect(d.reason).toBe('suspended')
  })
})

describe('decideAccess — email verification', () => {
  it('denies unverified email with a distinct reason', () => {
    const d = decideAccess(input({ emailVerified: false }))
    expect(d).toEqual({ canUseScraper: false, reason: 'email_unverified' })
  })

  it('suspension outranks unverified email', () => {
    const d = decideAccess(input({
      emailVerified: false,
      profile: { role: 'suspended_user', access_expires_at: null, suspended_at: null, deleted_at: null },
    }))
    expect(d.reason).toBe('suspended')
  })
})

describe('decideAccess — missing profile', () => {
  it('denies a null profile', () => {
    expect(decideAccess(input({ profile: null })).reason).toBe('unauthenticated')
  })

  it('denies a soft-deleted profile', () => {
    const d = decideAccess(input({
      profile: { role: 'admin', access_expires_at: null, suspended_at: null, deleted_at: '2024-01-01T00:00:00Z' },
    }))
    expect(d.reason).toBe('unauthenticated')
  })
})

describe('decideAccess — plan limits', () => {
  it('denies with payment_required when no plan is assigned', () => {
    expect(decideAccess(input({ limits: null })).reason).toBe('payment_required')
  })

  it('denies when the DAILY extraction limit is reached', () => {
    const d = decideAccess(input({ usage: { ...USAGE, extractionsToday: 10 } }))
    expect(d.reason).toBe('limit_reached')
  })

  it('denies when the MONTHLY extraction limit is reached', () => {
    const d = decideAccess(input({ usage: { ...USAGE, extractionsThisMonth: 30 } }))
    expect(d.reason).toBe('limit_reached')
  })

  it('denies when the MONTHLY record limit is reached', () => {
    const d = decideAccess(input({ usage: { ...USAGE, recordsThisMonth: 10000 } }))
    expect(d.reason).toBe('limit_reached')
  })

  it('allows at exactly one below the limit', () => {
    const d = decideAccess(input({ usage: { ...USAGE, extractionsToday: 9 } }))
    expect(d.canUseScraper).toBe(true)
  })

  it('admins bypass plan limits entirely', () => {
    const d = decideAccess(input({
      profile: { role: 'admin', access_expires_at: null, suspended_at: null, deleted_at: null },
      limits: null,
      usage: { extractionsToday: 9999, extractionsThisMonth: 9999, recordsThisMonth: 9999 },
    }))
    expect(d).toEqual({ canUseScraper: true, reason: 'ok' })
  })

  it('treats a null limit as unlimited', () => {
    const d = decideAccess(input({
      limits: { ...LIMITS, extractions_per_day: null },
      usage: { ...USAGE, extractionsToday: 100_000 },
    }))
    expect(d.canUseScraper).toBe(true)
  })
})

describe('withinLimit', () => {
  it('null means unlimited', () => {
    expect(withinLimit(null, Number.MAX_SAFE_INTEGER)).toBe(true)
  })
  it('is exclusive at the boundary', () => {
    expect(withinLimit(5, 4)).toBe(true)
    expect(withinLimit(5, 5)).toBe(false)
    expect(withinLimit(5, 6)).toBe(false)
  })
  it('handles a zero limit', () => {
    expect(withinLimit(0, 0)).toBe(false)
  })
})

/**
 * The half-decision must never be used as the decision.
 *
 * `decideLimits` answers "is this account within its plan's limits" and denies
 * with `payment_required` whenever limits are null. It is only meaningful after
 * `precheckAccess` returns `NEEDS_LIMITS`.
 *
 * An ADMIN never reaches that point: `getAccessContext` short-circuits on the
 * pre-check and never fetches a plan, so `ctx.plan` and `ctx.usage` are both
 * null. `app/(product)/extension/connect/page.tsx` called `decideLimits`
 * directly and AND-ed it with the real decision, which denied every admin —
 * the pairing screen told them they needed a subscription while the server
 * action behind it would have issued them a code.
 */
describe('an admin is not subject to the plan half of the decision', () => {
  const admin = {
    role: 'admin' as const,
    access_expires_at: null,
    suspended_at: null,
    deleted_at: null,
  }

  it('allows an admin who has no plan and no usage at all', () => {
    const d = decideAccess(input({ profile: admin, limits: null, usage: null }))
    expect(d).toEqual({ canUseScraper: true, reason: 'ok' })
  })

  it('allows an admin who is past every limit', () => {
    const d = decideAccess(
      input({
        profile: admin,
        usage: { extractionsToday: 1e6, extractionsThisMonth: 1e6, recordsThisMonth: 1e6 },
      }),
    )
    expect(d.canUseScraper).toBe(true)
  })

  it('DENIES the same admin via the plan half alone — which is why it must not be called', () => {
    // The trap, asserted directly: this is what the connect page was doing.
    expect(decideLimits(null, null)).toEqual({
      canUseScraper: false,
      reason: 'payment_required',
    })
  })

  it('still suspends an admin, and still expires one', () => {
    // Admin bypasses limits. It has never bypassed suspension or expiry.
    expect(
      decideAccess(input({ profile: { ...admin, suspended_at: '2020-01-01T00:00:00Z' } })).reason,
    ).toBe('suspended')

    expect(
      decideAccess(input({ profile: { ...admin, access_expires_at: '2020-01-01T00:00:00Z' } }))
        .reason,
    ).toBe('expired')
  })
})

describe('nothing outside lib/auth decides access', () => {
  // CLAUDE.md: "All access decisions go through lib/auth/access.ts. Nothing
  // else decides access." A surface that recomputes it will drift from it.
  it('no page or component imports the raw decision functions', async () => {
    const { execSync } = await import('node:child_process')

    // The import is the violation, not the word — this file's own explanation
    // of the bug names those functions in prose, and so may a comment there.
    const hits = execSync(
      `grep -rln "from '@/lib/auth/decide'" app components || true`,
      { encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)

    expect(
      hits,
      'Read ctx.canUseScraper from lib/auth/access.ts instead of recomputing it',
    ).toEqual([])
  })
})
