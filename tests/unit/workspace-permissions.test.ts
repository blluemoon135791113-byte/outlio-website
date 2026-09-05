/**
 * The workspace policy layer — M1 acceptance criterion 1.
 *
 * "Policy tests cover every role × resource combination (allow AND deny)."
 *
 * The matrix below is EXHAUSTIVE and generated, not sampled: 5 roles × every
 * permission, each asserted in both directions. A permission added to
 * `permissions.ts` without a row here fails the completeness test at the
 * bottom, so the matrix cannot silently fall behind the code.
 */
import { describe, expect, it } from 'vitest'

import {
  ALL_PERMISSIONS,
  assignableRoles,
  can,
  canManageRole,
  dataScope,
  decidePermission,
  moduleFor,
  MODULES,
  WORKSPACE_ROLES,
  type Module,
  type Permission,
  type WorkspaceRole,
} from '@/lib/workspaces/permissions'

/** Every module entitled — isolates ROLE behaviour from ENTITLEMENT behaviour. */
const ALL_MODULES: ReadonlySet<Module> = new Set(MODULES)

const policy = (role: WorkspaceRole | null, modules: ReadonlySet<Module> = ALL_MODULES) => ({
  role,
  modules,
})

/**
 * The expected minimum role for every permission, written out by hand.
 *
 * Deliberately a SECOND, independent statement of the policy: if it merely
 * re-derived the table in `permissions.ts` the test would pass no matter what
 * that table said. A change to either side must be made in both, on purpose.
 */
const EXPECTED_MIN_ROLE: Record<Permission, WorkspaceRole> = {
  'workspace.view': 'viewer',
  'workspace.member.view': 'manager',
  'workspace.member.manage': 'admin',
  'workspace.settings.manage': 'admin',
  'workspace.billing.manage': 'owner',
  'workspace.delete': 'owner',
  'workspace.transfer_ownership': 'owner',

  'crm.contact.view': 'viewer',
  'crm.contact.create': 'setter',
  'crm.contact.edit': 'setter',
  'crm.contact.assign': 'manager',
  'crm.contact.delete': 'manager',
  'crm.contact.merge': 'manager',
  'crm.duplicate.resolve': 'manager',
  'crm.company.view': 'viewer',
  'crm.company.edit': 'setter',
  'crm.list.manage': 'setter',
  'crm.import': 'manager',
  'crm.export': 'manager',
  'crm.opportunity.view': 'viewer',
  'crm.opportunity.create': 'setter',
  'crm.opportunity.edit': 'setter',
  'crm.opportunity.delete': 'manager',
  'crm.pipeline.manage': 'admin',
  'crm.task.view': 'viewer',
  'crm.task.manage': 'setter',

  'email.account.connect': 'setter',
  'email.account.manage': 'admin',
  'email.template.manage': 'manager',
  'email.campaign.view': 'viewer',
  'email.campaign.create': 'manager',
  'email.campaign.launch': 'manager',
  'email.inbox.view': 'setter',
  // A setter sees the inbox, but only the threads assigned to them, and cannot
  // hand a conversation to somebody else.
  'email.inbox.view.all': 'manager',
  'email.inbox.manage': 'manager',
  'email.suppression.manage': 'manager',

  'flow.view': 'manager',
  'flow.manage': 'manager',

  'report.own.view': 'setter',
  'report.team.view': 'manager',
  'report.export': 'manager',

  'integration.view': 'manager',
  'integration.manage': 'admin',

  'hubble.use': 'setter',
}

const RANK: Record<WorkspaceRole, number> = {
  owner: 4,
  admin: 3,
  manager: 2,
  setter: 1,
  viewer: 0,
}

describe('the role × permission matrix is complete', () => {
  it('names every permission exactly once', () => {
    expect(Object.keys(EXPECTED_MIN_ROLE).sort()).toEqual([...ALL_PERMISSIONS].sort())
  })
})

describe('every role × permission, allow and deny', () => {
  for (const permission of ALL_PERMISSIONS) {
    for (const role of WORKSPACE_ROLES) {
      const shouldAllow = RANK[role] >= RANK[EXPECTED_MIN_ROLE[permission]]

      it(`${role} ${shouldAllow ? 'MAY' : 'may NOT'} ${permission}`, () => {
        expect(can(policy(role), permission)).toBe(shouldAllow)
      })
    }
  }
})

describe('non-members', () => {
  it('are denied every permission, with a distinct reason', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(decidePermission(policy(null), permission)).toEqual({
        allowed: false,
        reason: 'not_a_member',
      })
    }
  })
})

describe('the setter boundary (M1 brief)', () => {
  // Named explicitly rather than folded into the generated matrix: these are
  // the denials the brief calls out by name, so a regression should read as
  // "setters can now manage billing", not as one row of 200.
  const DENIED: Permission[] = [
    'workspace.billing.manage',
    'workspace.settings.manage',
    'workspace.member.manage',
    'workspace.member.view',
    'workspace.delete',
    'workspace.transfer_ownership',
    'integration.view',
    'integration.manage',
    'crm.export',
    'report.export',
    'report.team.view',
    'flow.view',
    'flow.manage',
    'crm.import',
    'crm.contact.assign',
    'crm.contact.merge',
    'crm.pipeline.manage',
    'email.campaign.launch',
    'email.account.manage',
  ]

  for (const permission of DENIED) {
    it(`denies a setter ${permission}`, () => {
      expect(can(policy('setter'), permission)).toBe(false)
    })
  }

  const ALLOWED: Permission[] = [
    'crm.contact.view',
    'crm.contact.create',
    'crm.contact.edit',
    'crm.opportunity.create',
    'crm.task.manage',
    'email.inbox.view',
    'email.account.connect',
    'report.own.view',
  ]

  for (const permission of ALLOWED) {
    it(`allows a setter ${permission}`, () => {
      expect(can(policy('setter'), permission)).toBe(true)
    })
  }
})

describe('entitlements gate at the policy layer, not only the UI', () => {
  it('denies an OWNER a module their plan does not include', () => {
    const noCrm = new Set(MODULES.filter((m) => m !== 'crm'))
    expect(decidePermission(policy('owner', noCrm), 'crm.contact.view')).toEqual({
      allowed: false,
      reason: 'module_unavailable',
    })
  })

  it('reports module_unavailable ahead of role_insufficient', () => {
    // A viewer lacks the role AND the module. The module answer must win, or
    // support tells them to upgrade a role when the plan was the problem.
    expect(decidePermission(policy('viewer', new Set()), 'crm.import')).toEqual({
      allowed: false,
      reason: 'module_unavailable',
    })
  })

  it('leaves permissions that belong to no module unaffected', () => {
    for (const permission of ALL_PERMISSIONS) {
      if (moduleFor(permission) !== null) continue
      expect(can(policy('owner', new Set()), permission)).toBe(true)
    }
  })

  it('denies every module-bound permission when nothing is entitled', () => {
    for (const permission of ALL_PERMISSIONS) {
      if (moduleFor(permission) === null) continue
      expect(can(policy('owner', new Set()), permission)).toBe(false)
    }
  })
})

describe('data scope', () => {
  it('narrows setters and viewers to their own assignments', () => {
    expect(dataScope('setter')).toBe('assigned')
    expect(dataScope('viewer')).toBe('assigned')
  })

  it('gives managers and above the whole workspace', () => {
    expect(dataScope('manager')).toBe('all')
    expect(dataScope('admin')).toBe('all')
    expect(dataScope('owner')).toBe('all')
  })

  it('gives a non-member nothing', () => {
    expect(dataScope(null)).toBe('none')
  })
})

describe('role management is strictly downward', () => {
  it('never lets anyone assign ownership', () => {
    for (const role of WORKSPACE_ROLES) {
      expect(canManageRole(role, 'owner')).toBe(false)
    }
  })

  it('never lets a role manage its own level', () => {
    // Two admins who can demote each other can race one another out of a
    // workspace, and one admin can remove the person who would have stopped
    // them.
    for (const role of WORKSPACE_ROLES) {
      expect(canManageRole(role, role)).toBe(false)
    }
  })

  it('lets each role manage strictly beneath it', () => {
    expect(assignableRoles('owner')).toEqual(['admin', 'manager', 'setter', 'viewer'])
    expect(assignableRoles('admin')).toEqual(['manager', 'setter', 'viewer'])
    expect(assignableRoles('manager')).toEqual(['setter', 'viewer'])
    expect(assignableRoles('setter')).toEqual(['viewer'])
    expect(assignableRoles('viewer')).toEqual([])
  })

  it('gives a non-member nothing to assign', () => {
    expect(assignableRoles(null)).toEqual([])
  })
})
