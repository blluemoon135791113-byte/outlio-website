/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  THE ACCOUNT POLICY.                                                     ║
 * ║                                                                          ║
 * ║  Every "may this member do this to an account?" question is answered     ║
 * ║  here, and nowhere else.                                                 ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * PURE, like `lib/workspaces/permissions.ts` and `lib/auth/decide.ts`: no I/O.
 * `lib/crm/account-access.ts` gathers the inputs and calls `decide`.
 *
 * WHY A SECOND POLICY. The workspace policy is a fixed role ranking, which is
 * right for everything it governs and stays untouched. The account workspace
 * was specified differently — per-role defaults an admin can EDIT, plus
 * per-person overrides ("give Sam create without making Sam a manager") — and
 * a ranking cannot express a setter who may create but not assign. So these
 * nine permissions are data (0149), decided here, and the workspace policy's
 * CRM module gate still runs FIRST: a workspace without the CRM module gets
 * nothing from this file whatever its rows say.
 *
 * Three rules, in order:
 *   1. not a member, or the CRM module unavailable → denied;
 *   2. the OWNER → granted, always (0149 refuses owner rows, so nothing an admin
 *      edits can lock the workspace out of its own settings);
 *   3. a per-person override, else the role default, else DENIED. A missing row
 *      is never read as "use a default from code" — the seed writes the full
 *      matrix precisely so nothing is implied.
 */
import { decidePermission, type Module, type WorkspaceRole } from '@/lib/workspaces/permissions'

/**
 * ⚠️ THE SOURCE OF TRUTH FOR THE LIST. The latest migration that defines it
 * (0153) repeats it in two CHECK constraints and the seed; the test asserts
 * all three agree, so adding one here without a migration fails the suite.
 *
 * `accounts.edit_tags` replaced `edit_icp_tags` + `edit_product_tags` in 0153:
 * tag groups are workspace-defined, so a permission per fixed group no longer
 * had a group to belong to.
 */
export const ACCOUNT_PERMISSIONS = [
  'accounts.view_all',
  'accounts.create',
  'accounts.edit',
  'accounts.edit_tags',
  'accounts.assign',
  'accounts.delete',
  'accounts.import',
  'config.manage',
] as const

export type AccountPermission = (typeof ACCOUNT_PERMISSIONS)[number]

export function isAccountPermission(value: string): value is AccountPermission {
  return (ACCOUNT_PERMISSIONS as readonly string[]).includes(value)
}

export type AccountPolicyInput = {
  role: WorkspaceRole | null
  modules: ReadonlySet<Module>
  /** This member's ROLE defaults, from crm_account_role_defaults. */
  roleDefaults: Partial<Record<AccountPermission, boolean>>
  /** This member's personal overrides, from crm_account_permission_overrides. */
  overrides: Partial<Record<AccountPermission, boolean>>
}

export type AccountDenial = 'not_a_member' | 'module_unavailable' | 'not_granted'

export type AccountDecision =
  | { allowed: true; via: 'owner' | 'override' | 'role_default' }
  | { allowed: false; reason: AccountDenial }

export function decideAccountPermission(
  input: AccountPolicyInput,
  permission: AccountPermission,
): AccountDecision {
  // The module gate and membership come from the workspace policy, so the two
  // policies can never disagree about whether CRM is on.
  const gate = decidePermission({ role: input.role, modules: input.modules }, 'crm.company.view')
  if (!gate.allowed) {
    return {
      allowed: false,
      reason: gate.reason === 'module_unavailable' ? 'module_unavailable' : 'not_a_member',
    }
  }

  if (input.role === 'owner') return { allowed: true, via: 'owner' }

  const override = input.overrides[permission]
  if (override !== undefined) {
    return override ? { allowed: true, via: 'override' } : { allowed: false, reason: 'not_granted' }
  }

  return input.roleDefaults[permission] === true
    ? { allowed: true, via: 'role_default' }
    : { allowed: false, reason: 'not_granted' }
}

/** Every account permission this member holds. */
export function grantedAccountPermissions(input: AccountPolicyInput): Set<AccountPermission> {
  return new Set(ACCOUNT_PERMISSIONS.filter((p) => decideAccountPermission(input, p).allowed))
}

/**
 * The defaults agreed on 2026-10-01, and what 0149 seeds. Used ONLY to show
 * "reset to default" in Settings — never as a fallback for a missing row.
 */
export const SEEDED_ROLE_DEFAULTS: Record<
  Exclude<WorkspaceRole, 'owner'>,
  readonly AccountPermission[]
> = {
  admin: ACCOUNT_PERMISSIONS,
  manager: ACCOUNT_PERMISSIONS.filter((p) => p !== 'accounts.delete' && p !== 'config.manage'),
  setter: ['accounts.edit', 'accounts.edit_tags'],
  viewer: [],
}
