/**
 * Invitation tokens and workspace entitlement resolution.
 *
 * The redemption FUNCTION itself lives in Postgres (migration 0070) because it
 * must be atomic; what is testable without a database is the token handling
 * either side of it, and the pure entitlement rules.
 */
import { describe, expect, it } from 'vitest'

import {
  MODULE_FLAG,
  resolveMemberLimit,
  resolveModules,
} from '@/lib/workspaces/entitlements'
import { MODULES } from '@/lib/workspaces/permissions'
import {
  createInvitationToken,
  hashInvitationToken,
  INVITATION_TTL_SECONDS,
  invitationExpiresAt,
  isInvitationTokenShape,
  normalizeInviteEmail,
  tokenHashesMatch,
} from '@/lib/workspaces/tokens'
import type { PlanLimits } from '@/types/database'

const NO_FLAGS = new Map<string, boolean>()

function limits(over: Partial<PlanLimits> = {}): PlanLimits {
  return {
    credits_per_month: null,
    files_per_extraction: null,
    leads_per_credit: null,
    extractions_per_day: null,
    extractions_per_month: null,
    records_per_extraction: null,
    records_per_month: null,
    storage_bytes: null,
    exports_per_month: null,
    retention_days: null,
    contact_enrichments_per_month: null,
    crm_enabled: false,
    email_enabled: false,
    flows_enabled: false,
    reports_enabled: false,
    integrations_enabled: false,
    hubble_enabled: false,
    workspace_member_limit: 1,
    ...over,
  }
}

describe('invitation tokens', () => {
  it('never returns the same token twice', () => {
    const tokens = new Set(
      Array.from({ length: 200 }, () => createInvitationToken().token),
    )
    expect(tokens.size).toBe(200)
  })

  it('returns a hash that matches the token, and is not the token', () => {
    const { token, tokenHash } = createInvitationToken()
    expect(tokenHash).toBe(hashInvitationToken(token))
    expect(tokenHash).not.toBe(token)
    // sha256 hex.
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces URL-safe tokens of the documented shape', () => {
    for (let i = 0; i < 50; i += 1) {
      const { token } = createInvitationToken()
      expect(isInvitationTokenShape(token)).toBe(true)
      expect(encodeURIComponent(token)).toBe(token)
    }
  })

  it('rejects anything that is not a token before it reaches the database', () => {
    for (const value of [
      '',
      'short',
      'favicon.ico',
      '../../etc/passwd',
      'a'.repeat(42),
      'a'.repeat(44),
      `${'a'.repeat(42)}+`,
      `${'a'.repeat(42)}/`,
    ]) {
      expect(isInvitationTokenShape(value)).toBe(false)
    }
  })

  it('hashes deterministically', () => {
    expect(hashInvitationToken('abc')).toBe(hashInvitationToken('abc'))
    expect(hashInvitationToken('abc')).not.toBe(hashInvitationToken('abd'))
  })

  it('compares hashes without leaking length or content', () => {
    const a = hashInvitationToken('one')
    expect(tokenHashesMatch(a, a)).toBe(true)
    expect(tokenHashesMatch(a, hashInvitationToken('two'))).toBe(false)
    expect(tokenHashesMatch(a, 'short')).toBe(false)
  })

  it('expires seven days out', () => {
    const now = new Date('2026-08-30T12:00:00.000Z')
    expect(invitationExpiresAt(now).toISOString()).toBe('2026-09-06T12:00:00.000Z')
    expect(INVITATION_TTL_SECONDS).toBe(7 * 24 * 60 * 60)
  })
})

describe('invitation email normalization', () => {
  it('lowercases and trims, matching the CHECK constraint in 0070', () => {
    expect(normalizeInviteEmail('  Sam@Example.COM ')).toBe('sam@example.com')
  })

  it('is idempotent', () => {
    const once = normalizeInviteEmail(' A@B.com')
    expect(normalizeInviteEmail(once)).toBe(once)
  })
})

describe('module entitlements', () => {
  it('grants nothing without a plan', () => {
    expect(resolveModules(null, NO_FLAGS).size).toBe(0)
  })

  it('grants exactly what the plan includes', () => {
    const modules = resolveModules(limits({ crm_enabled: true, email_enabled: true }), NO_FLAGS)
    expect([...modules].sort()).toEqual(['crm', 'email'])
  })

  it('lets a feature flag switch an entitled module OFF', () => {
    const flags = new Map([[MODULE_FLAG.crm, false]])
    expect(resolveModules(limits({ crm_enabled: true }), flags).has('crm')).toBe(false)
  })

  it('NEVER lets a feature flag switch an unentitled module ON', () => {
    // The whole point of "a flag can only restrict": a kill switch must not
    // double as a way to hand out an unpaid module.
    const flags = new Map(MODULES.map((m) => [MODULE_FLAG[m], true]))
    expect(resolveModules(limits(), flags).size).toBe(0)
  })

  it('treats an absent flag as "not overridden"', () => {
    expect(resolveModules(limits({ flows_enabled: true }), NO_FLAGS).has('flows')).toBe(true)
  })

  it('gives every module a distinct flag name', () => {
    const names = MODULES.map((m) => MODULE_FLAG[m])
    expect(new Set(names).size).toBe(MODULES.length)
  })
})

describe('seat limits', () => {
  it('falls back to one seat when the plan says nothing', () => {
    expect(resolveMemberLimit(null, null)).toBe(1)
  })

  it('reads the plan when there is no override', () => {
    expect(resolveMemberLimit(limits({ workspace_member_limit: 5 }), null)).toBe(5)
  })

  it('lets a platform override widen a single account', () => {
    expect(resolveMemberLimit(limits({ workspace_member_limit: 5 }), 25)).toBe(25)
  })

  it('lets a platform override narrow one too', () => {
    expect(resolveMemberLimit(limits({ workspace_member_limit: 25 }), 2)).toBe(2)
  })

  it('treats a null plan limit as unlimited', () => {
    expect(resolveMemberLimit(limits({ workspace_member_limit: null }), null)).toBeNull()
  })
})
