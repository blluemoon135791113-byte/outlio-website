/**
 * The account policy — build step 2.
 *
 * The matrix is written out BY HAND as an independent statement of the agreed
 * defaults (2026-10-01). Re-deriving it from `SEEDED_ROLE_DEFAULTS` would pass
 * whatever that constant said; this fails when either drifts from the other.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ACCOUNT_PERMISSIONS,
  SEEDED_ROLE_DEFAULTS,
  decideAccountPermission,
  grantedAccountPermissions,
  type AccountPermission,
  type AccountPolicyInput,
} from '@/lib/crm/account-permissions'
import { MODULES, type Module, type WorkspaceRole } from '@/lib/workspaces/permissions'

const ALL_MODULES: ReadonlySet<Module> = new Set(MODULES)

/** The role defaults as 0149 seeds them, expressed as the policy's input. */
function seeded(role: Exclude<WorkspaceRole, 'owner'>): Partial<Record<AccountPermission, boolean>> {
  return Object.fromEntries(
    ACCOUNT_PERMISSIONS.map((p) => [p, SEEDED_ROLE_DEFAULTS[role].includes(p)]),
  )
}

function input(
  role: WorkspaceRole | null,
  overrides: Partial<Record<AccountPermission, boolean>> = {},
  modules: ReadonlySet<Module> = ALL_MODULES,
): AccountPolicyInput {
  return {
    role,
    modules,
    roleDefaults: role && role !== 'owner' ? seeded(role) : {},
    overrides,
  }
}

const EXPECTED: Record<WorkspaceRole, readonly AccountPermission[]> = {
  owner: [
    'accounts.view_all', 'accounts.create', 'accounts.edit', 'accounts.edit_tags',
    'accounts.assign', 'accounts.delete', 'accounts.import', 'config.manage',
  ],
  admin: [
    'accounts.view_all', 'accounts.create', 'accounts.edit', 'accounts.edit_tags',
    'accounts.assign', 'accounts.delete', 'accounts.import', 'config.manage',
  ],
  // Approved: admin defaults minus delete and config.manage.
  manager: [
    'accounts.view_all', 'accounts.create', 'accounts.edit', 'accounts.edit_tags',
    'accounts.assign', 'accounts.import',
  ],
  // The spec's "Employee": edit fields and tags, assigned accounts only.
  setter: ['accounts.edit', 'accounts.edit_tags'],
  // Approved: read-only on assigned accounts.
  viewer: [],
}

describe('the default matrix, every role × permission, allow AND deny', () => {
  for (const role of Object.keys(EXPECTED) as WorkspaceRole[]) {
    for (const permission of ACCOUNT_PERMISSIONS) {
      const allowed = EXPECTED[role].includes(permission)
      it(`${role} ${allowed ? 'may' : 'may NOT'} ${permission}`, () => {
        expect(decideAccountPermission(input(role), permission).allowed).toBe(allowed)
      })
    }
  }
})

describe('per-person overrides', () => {
  it('grant create to one setter without changing the role', () => {
    const decision = decideAccountPermission(input('setter', { 'accounts.create': true }), 'accounts.create')
    expect(decision).toEqual({ allowed: true, via: 'override' })
  })

  it('grant view_all to one setter', () => {
    expect(grantedAccountPermissions(input('setter', { 'accounts.view_all': true })).has('accounts.view_all')).toBe(true)
  })

  it('deny something the role would allow', () => {
    expect(decideAccountPermission(input('manager', { 'accounts.assign': false }), 'accounts.assign').allowed).toBe(false)
  })

  it('a tags-only employee can change tags and nothing else', () => {
    const only: AccountPolicyInput = {
      role: 'setter',
      modules: ALL_MODULES,
      roleDefaults: {},
      overrides: { 'accounts.edit_tags': true },
    }
    expect(decideAccountPermission(only, 'accounts.edit_tags').allowed).toBe(true)
    expect(decideAccountPermission(only, 'accounts.edit').allowed).toBe(false)
  })
})

describe('the owner cannot be locked out', () => {
  it('holds everything even with every override set to false', () => {
    const denied = Object.fromEntries(ACCOUNT_PERMISSIONS.map((p) => [p, false]))
    for (const p of ACCOUNT_PERMISSIONS) {
      expect(decideAccountPermission(input('owner', denied), p).allowed).toBe(true)
    }
  })
})

describe('fail closed', () => {
  it('a missing row is denied, never defaulted from code', () => {
    const empty: AccountPolicyInput = { role: 'admin', modules: ALL_MODULES, roleDefaults: {}, overrides: {} }
    for (const p of ACCOUNT_PERMISSIONS) {
      expect(decideAccountPermission(empty, p)).toEqual({ allowed: false, reason: 'not_granted' })
    }
  })

  it('no CRM module means nothing, whatever the rows say', () => {
    const noCrm = new Set(MODULES.filter((m) => m !== 'crm'))
    expect(decideAccountPermission(input('owner', {}, noCrm), 'accounts.view_all')).toEqual({
      allowed: false,
      reason: 'module_unavailable',
    })
    expect(decideAccountPermission(input('admin', { 'accounts.create': true }, noCrm), 'accounts.create').allowed).toBe(false)
  })

  it('a non-member gets nothing', () => {
    expect(decideAccountPermission(input(null), 'accounts.edit')).toEqual({
      allowed: false,
      reason: 'not_a_member',
    })
  })
})

describe('the TypeScript list and the latest migration (0153) agree', () => {
  const sql = readFileSync(join(__dirname, '..', '..', 'supabase/migrations/0153_crm_tag_groups.sql'), 'utf8')

  it('both CHECK constraints name exactly ACCOUNT_PERMISSIONS', () => {
    const checks = [...sql.matchAll(/_permission_valid check \(permission in \(([^)]*)\)\)/g)]
    expect(checks).toHaveLength(2)
    for (const check of checks) {
      const listed = [...check[1]!.matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]).sort()
      expect(listed).toEqual([...ACCOUNT_PERMISSIONS].sort())
    }
  })

  it('the seed names exactly ACCOUNT_PERMISSIONS', () => {
    const seed = sql.slice(sql.indexOf('cross join (values'), sql.indexOf(') as p(permission)'))
    const listed = [...seed.matchAll(/\('([a-z_.]+)'\)/g)].map((m) => m[1]).sort()
    expect(listed).toEqual([...ACCOUNT_PERMISSIONS].sort())
  })
})
