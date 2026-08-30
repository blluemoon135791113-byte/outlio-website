/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  THE WORKSPACE POLICY LAYER.                                             ║
 * ║                                                                          ║
 * ║  Every "may this member do this?" question in the platform is answered   ║
 * ║  here. A grep for a workspace-role comparison anywhere else is a bug.    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * PURE. No I/O, no secrets, no request context — the same discipline as
 * `lib/auth/decide.ts`, and for the same reason: security logic that cannot be
 * tested exhaustively tends not to be. `tests/unit/workspace-permissions.test.ts`
 * asserts every role × permission pair, allow AND deny.
 *
 * This is the SECOND role axis. `profiles.role` still answers "may this person
 * use Outlio at all?" (platform access, suspension, admin). This file answers
 * "what may they do inside this workspace?". They are never merged — see
 * Ledger D4.
 */

/** Ordered most to least privileged. Mirrors the `workspace_role` enum in 0070. */
export type WorkspaceRole = 'owner' | 'admin' | 'manager' | 'setter' | 'viewer'

export const WORKSPACE_ROLES: readonly WorkspaceRole[] = [
  'owner',
  'admin',
  'manager',
  'setter',
  'viewer',
]

/**
 * The hierarchy is TOTAL: every role can do everything the role beneath it can.
 * That is what lets a permission be expressed as a single minimum role instead
 * of a hand-maintained list per permission, which is where these tables
 * normally rot.
 */
const RANK: Record<WorkspaceRole, number> = {
  owner: 4,
  admin: 3,
  manager: 2,
  setter: 1,
  viewer: 0,
}

/**
 * Platform modules. Each is independently entitled by the plan and can be
 * switched off per workspace (A3: "ALL NEW MODULES SHIP BEHIND WORKSPACE-LEVEL
 * FEATURE FLAGS").
 */
export type Module = 'crm' | 'email' | 'flows' | 'reports' | 'integrations' | 'hubble'

export const MODULES: readonly Module[] = [
  'crm',
  'email',
  'flows',
  'reports',
  'integrations',
  'hubble',
]

export type Permission =
  // Workspace administration
  | 'workspace.view'
  | 'workspace.settings.manage'
  | 'workspace.billing.manage'
  | 'workspace.member.view'
  | 'workspace.member.manage'
  | 'workspace.delete'
  | 'workspace.transfer_ownership'
  // CRM
  | 'crm.contact.view'
  | 'crm.contact.create'
  | 'crm.contact.edit'
  | 'crm.contact.delete'
  | 'crm.contact.assign'
  | 'crm.contact.merge'
  | 'crm.company.view'
  | 'crm.company.edit'
  | 'crm.list.manage'
  | 'crm.import'
  | 'crm.export'
  | 'crm.duplicate.resolve'
  | 'crm.opportunity.view'
  | 'crm.opportunity.create'
  | 'crm.opportunity.edit'
  | 'crm.opportunity.delete'
  | 'crm.pipeline.manage'
  | 'crm.task.view'
  | 'crm.task.manage'
  // Email
  | 'email.account.connect'
  | 'email.account.manage'
  | 'email.template.manage'
  | 'email.campaign.view'
  | 'email.campaign.create'
  | 'email.campaign.launch'
  | 'email.inbox.view'
  | 'email.suppression.manage'
  // Flows
  | 'flow.view'
  | 'flow.manage'
  // Reporting
  | 'report.own.view'
  | 'report.team.view'
  | 'report.export'
  // Integrations
  | 'integration.view'
  | 'integration.manage'
  // Hubble (AI). Credit-consuming.
  | 'hubble.use'

type PermissionSpec = {
  /** Lowest role that holds this permission. */
  minRole: WorkspaceRole
  /** Module that must be entitled AND enabled. `null` = always available. */
  module: Module | null
}

/**
 * THE POLICY TABLE.
 *
 * Read it as: "a `minRole` — and everyone above them — may do this, provided
 * `module` is entitled."
 *
 * Setter is deliberately narrow (M1 brief): assigned contacts, opportunities,
 * tasks and replies, plus their own reports. Denied billing, settings,
 * integrations, exports, team admin and flow admin — every one of those is
 * asserted as a DENY in the test suite.
 */
const PERMISSIONS: Record<Permission, PermissionSpec> = {
  // Workspace administration ------------------------------------------------
  'workspace.view': { minRole: 'viewer', module: null },
  'workspace.member.view': { minRole: 'manager', module: null },
  'workspace.member.manage': { minRole: 'admin', module: null },
  'workspace.settings.manage': { minRole: 'admin', module: null },
  // Money and destruction are the owner's alone. An admin who could change the
  // card or delete the workspace is an owner by another name.
  'workspace.billing.manage': { minRole: 'owner', module: null },
  'workspace.delete': { minRole: 'owner', module: null },
  'workspace.transfer_ownership': { minRole: 'owner', module: null },

  // CRM ---------------------------------------------------------------------
  // Setters see CRM, but `dataScope` narrows them to their own assignments.
  'crm.contact.view': { minRole: 'viewer', module: 'crm' },
  'crm.contact.create': { minRole: 'setter', module: 'crm' },
  'crm.contact.edit': { minRole: 'setter', module: 'crm' },
  'crm.contact.assign': { minRole: 'manager', module: 'crm' },
  'crm.contact.delete': { minRole: 'manager', module: 'crm' },
  // Merging is irreversible and rewrites attribution. Not a setter action.
  'crm.contact.merge': { minRole: 'manager', module: 'crm' },
  'crm.duplicate.resolve': { minRole: 'manager', module: 'crm' },
  'crm.company.view': { minRole: 'viewer', module: 'crm' },
  'crm.company.edit': { minRole: 'setter', module: 'crm' },
  'crm.list.manage': { minRole: 'setter', module: 'crm' },
  'crm.import': { minRole: 'manager', module: 'crm' },
  // Export is bulk data exfiltration. Managers and above only.
  'crm.export': { minRole: 'manager', module: 'crm' },
  'crm.opportunity.view': { minRole: 'viewer', module: 'crm' },
  'crm.opportunity.create': { minRole: 'setter', module: 'crm' },
  'crm.opportunity.edit': { minRole: 'setter', module: 'crm' },
  'crm.opportunity.delete': { minRole: 'manager', module: 'crm' },
  'crm.pipeline.manage': { minRole: 'admin', module: 'crm' },
  'crm.task.view': { minRole: 'viewer', module: 'crm' },
  'crm.task.manage': { minRole: 'setter', module: 'crm' },

  // Email -------------------------------------------------------------------
  // A setter connects their OWN mailbox; managing shared workspace accounts is
  // an admin action because it controls what the whole team sends from.
  'email.account.connect': { minRole: 'setter', module: 'email' },
  'email.account.manage': { minRole: 'admin', module: 'email' },
  'email.template.manage': { minRole: 'manager', module: 'email' },
  'email.campaign.view': { minRole: 'viewer', module: 'email' },
  'email.campaign.create': { minRole: 'manager', module: 'email' },
  // Launching mail is the highest-consequence action in the product: it is
  // irreversible, it spends domain reputation, and it is the one governed by
  // Gmail/Yahoo bulk-sender rules (A5).
  'email.campaign.launch': { minRole: 'manager', module: 'email' },
  'email.inbox.view': { minRole: 'setter', module: 'email' },
  'email.suppression.manage': { minRole: 'manager', module: 'email' },

  // Flows -------------------------------------------------------------------
  'flow.view': { minRole: 'manager', module: 'flows' },
  'flow.manage': { minRole: 'manager', module: 'flows' },

  // Reporting ---------------------------------------------------------------
  'report.own.view': { minRole: 'setter', module: 'reports' },
  'report.team.view': { minRole: 'manager', module: 'reports' },
  'report.export': { minRole: 'manager', module: 'reports' },

  // Integrations ------------------------------------------------------------
  'integration.view': { minRole: 'manager', module: 'integrations' },
  'integration.manage': { minRole: 'admin', module: 'integrations' },

  // Hubble ------------------------------------------------------------------
  'hubble.use': { minRole: 'setter', module: 'hubble' },
}

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[]

/** Which module a permission belongs to, or `null` if it is always available. */
export function moduleFor(permission: Permission): Module | null {
  return PERMISSIONS[permission].module
}

export type PolicyInput = {
  role: WorkspaceRole | null
  /**
   * Modules currently available to this workspace: plan entitlement AND
   * feature flag, already resolved. A module absent from this set is denied
   * regardless of role — that is what makes an entitlement toggle bite at the
   * API level rather than only hiding a button.
   */
  modules: ReadonlySet<Module>
}

export type PolicyDenial =
  | 'not_a_member'
  | 'role_insufficient'
  | 'module_unavailable'

export type PolicyDecision =
  | { allowed: true }
  | { allowed: false; reason: PolicyDenial }

/**
 * The decision, with a reason.
 *
 * The reason matters: "your plan does not include CRM" and "your role does not
 * permit this" need different UI and different support answers, and collapsing
 * them into a bare `false` is how users get told to upgrade a plan that was
 * never the problem.
 */
export function decidePermission(
  input: PolicyInput,
  permission: Permission,
): PolicyDecision {
  const { role, modules } = input

  if (!role) return { allowed: false, reason: 'not_a_member' }

  const spec = PERMISSIONS[permission]

  // Module availability is checked BEFORE role so an owner of a workspace
  // without the CRM module gets "module_unavailable", not a misleading allow.
  if (spec.module && !modules.has(spec.module)) {
    return { allowed: false, reason: 'module_unavailable' }
  }

  if (RANK[role] < RANK[spec.minRole]) {
    return { allowed: false, reason: 'role_insufficient' }
  }

  return { allowed: true }
}

/** Boolean shorthand. Use `decidePermission` when the reason is needed. */
export function can(input: PolicyInput, permission: Permission): boolean {
  return decidePermission(input, permission).allowed
}

/**
 * How much of the workspace's data this role may see.
 *
 * `assigned` means the query MUST be filtered to records owned by or assigned
 * to the caller. This function decides the rule; the caller applies it — there
 * is no way for a policy layer to enforce a WHERE clause on someone else's
 * query.
 */
export function dataScope(role: WorkspaceRole | null): 'all' | 'assigned' | 'none' {
  if (!role) return 'none'
  return RANK[role] >= RANK.manager ? 'all' : 'assigned'
}

/**
 * Whether `actor` may grant, change or revoke `target`'s role.
 *
 * STRICTLY BELOW, not "at or below". An admin who can demote another admin can
 * demote the one person who would have stopped them, and two admins can race
 * each other out of a workspace. Ownership moves only through an explicit
 * transfer (`workspace.transfer_ownership`), never by assignment.
 */
export function canManageRole(
  actor: WorkspaceRole | null,
  target: WorkspaceRole,
): boolean {
  if (!actor) return false
  if (target === 'owner') return false
  return RANK[actor] > RANK[target]
}

/** Roles `actor` is allowed to hand out in an invitation or a role change. */
export function assignableRoles(actor: WorkspaceRole | null): WorkspaceRole[] {
  return WORKSPACE_ROLES.filter((role) => canManageRole(actor, role))
}
