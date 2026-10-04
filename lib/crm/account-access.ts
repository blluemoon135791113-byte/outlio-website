import 'server-only'

/**
 * Gathers the inputs to the account policy and applies it.
 *
 * Shaped like `lib/workspaces/context.ts`: this file READS, and
 * `lib/crm/account-permissions.ts` DECIDES. Pages call `accountAccessIfPermitted`
 * (null → the CRM layout already explains why). Actions and route handlers
 * call `assertAccountPermission`, which throws a typed `AppError` — hiding a
 * button is not access control (CLAUDE.md rule 8).
 *
 * ⚠️ VISIBILITY IS A QUERY FILTER, NOT A POLICY ROW. RLS gives every member the
 * whole workspace (0071). "Sees only assigned accounts unless view_all" is
 * applied by `canSeeAccount` and by the `p_view_all` argument every account
 * read passes — a caller that forgets it shows a setter the entire book.
 */
import { cache } from 'react'

import { AppError } from '@/lib/errors/catalog'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  decideAccountPermission,
  grantedAccountPermissions,
  isAccountPermission,
  type AccountPermission,
  type AccountPolicyInput,
} from '@/lib/crm/account-permissions'
import {
  assertWorkspacePermission,
  getWorkspaceContext,
  type WorkspaceContext,
} from '@/lib/workspaces/context'
import { decidePermission } from '@/lib/workspaces/permissions'

export type AccountAccess = {
  ctx: WorkspaceContext
  granted: ReadonlySet<AccountPermission>
  can: (permission: AccountPermission) => boolean
  /** Whether this member sees every account, or only those assigned to them. */
  viewAll: boolean
}

async function loadPolicyInput(ctx: WorkspaceContext): Promise<AccountPolicyInput> {
  const db = createAdminClient()

  // The owner has no rows by design; skip two round trips that return nothing.
  if (ctx.role === 'owner') {
    return { role: ctx.role, modules: ctx.modules, roleDefaults: {}, overrides: {} }
  }

  const [defaults, overrides] = await Promise.all([
    db
      .from('crm_account_role_defaults')
      .select('permission, granted')
      .eq('workspace_id', ctx.workspace.id)
      .eq('role', ctx.role),
    db
      .from('crm_account_permission_overrides')
      .select('permission, granted')
      .eq('workspace_id', ctx.workspace.id)
      .eq('user_id', ctx.userId),
  ])

  // FAIL CLOSED: a read error is an error, never "no rows, so deny quietly"
  // dressed up as a permission answer someone could debug for a day.
  if (defaults.error) throw new Error(`account access: ${defaults.error.message}`)
  if (overrides.error) throw new Error(`account access: ${overrides.error.message}`)

  const toRecord = (rows: { permission: string; granted: boolean }[] | null) => {
    const out: Partial<Record<AccountPermission, boolean>> = {}
    for (const row of rows ?? []) {
      if (isAccountPermission(row.permission)) out[row.permission] = row.granted
    }
    return out
  }

  return {
    role: ctx.role,
    modules: ctx.modules,
    roleDefaults: toRecord(defaults.data),
    overrides: toRecord(overrides.data),
  }
}

function toAccess(ctx: WorkspaceContext, input: AccountPolicyInput): AccountAccess {
  const granted = grantedAccountPermissions(input)
  return {
    ctx,
    granted,
    can: (permission) => granted.has(permission),
    viewAll: granted.has('accounts.view_all'),
  }
}

/** Page guard. `null` when the member cannot see accounts at all. */
export const accountAccessIfPermitted = cache(async function accountAccessIfPermitted(): Promise<
  AccountAccess | null
> {
  const ctx = await getWorkspaceContext()
  if (!ctx) return null
  if (!decidePermission({ role: ctx.role, modules: ctx.modules }, 'crm.company.view').allowed) {
    return null
  }
  return toAccess(ctx, await loadPolicyInput(ctx))
})

/**
 * Action / route-handler guard. Throws ERR_FORBIDDEN without saying which rule
 * refused — the reason goes to the log, as in `assertWorkspacePermission`.
 */
export async function assertAccountPermission(
  permission: AccountPermission | null,
): Promise<AccountAccess> {
  const ctx = await assertWorkspacePermission('crm.company.view')
  const input = await loadPolicyInput(ctx)

  if (permission) {
    const decision = decideAccountPermission(input, permission)
    if (!decision.allowed) {
      throw new AppError(
        'ERR_FORBIDDEN',
        `account permission=${permission} reason=${decision.reason} workspace=${ctx.workspace.id}`,
      )
    }
  }

  return toAccess(ctx, input)
}

/**
 * Throws ERR_FORBIDDEN unless this member holds `permission`. For services that
 * already have an `AccountAccess` — the reason goes to the log, never the user.
 */
export function requirePermissionFor(access: AccountAccess, permission: AccountPermission): void {
  if (!access.can(permission)) {
    throw new AppError(
      'ERR_FORBIDDEN',
      `account permission=${permission} user=${access.ctx.userId} workspace=${access.ctx.workspace.id}`,
    )
  }
}

/**
 * Whether this member may see one account. ⚠️ Use on EVERY read or write by
 * id: an employee who types another account's id into a URL or a payload must
 * get "not found", never the record.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function canSeeAccount(access: AccountAccess, companyId: string): Promise<boolean> {
  // A malformed id in a URL is "not found", not a Postgres cast error and a 500.
  if (!UUID.test(companyId)) return false
  const db = createAdminClient()

  const { data: company, error } = await db
    .from('crm_companies')
    .select('id')
    .eq('workspace_id', access.ctx.workspace.id)
    .eq('id', companyId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(`canSeeAccount: ${error.message}`)
  if (!company) return false
  if (access.viewAll) return true

  const { data: assignment, error: assignmentError } = await db
    .from('crm_company_assignments')
    .select('id')
    .eq('workspace_id', access.ctx.workspace.id)
    .eq('company_id', companyId)
    .eq('user_id', access.ctx.userId)
    .is('unassigned_at', null)
    .maybeSingle()
  if (assignmentError) throw new Error(`canSeeAccount: ${assignmentError.message}`)
  return Boolean(assignment)
}

/**
 * `canSeeAccount` for many ids in two queries instead of two per id — the same
 * rule, exactly: a live account of this workspace, and (without `view_all`)
 * an open assignment to this member. Malformed ids are simply not visible.
 */
export async function visibleAccountIds(access: AccountAccess, companyIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(companyIds.filter((id) => UUID.test(id)))]
  const out = new Set<string>()
  if (ids.length === 0) return out
  const db = createAdminClient()

  const { data: companies, error } = await db
    .from('crm_companies')
    .select('id')
    .eq('workspace_id', access.ctx.workspace.id)
    .in('id', ids)
    .is('deleted_at', null)
  if (error) throw new Error(`visibleAccountIds: ${error.message}`)
  const live = (companies ?? []).map((c) => c.id)
  if (live.length === 0) return out
  if (access.viewAll) {
    for (const id of live) out.add(id)
    return out
  }

  const { data: assignments, error: assignmentError } = await db
    .from('crm_company_assignments')
    .select('company_id')
    .eq('workspace_id', access.ctx.workspace.id)
    .eq('user_id', access.ctx.userId)
    .in('company_id', live)
    .is('unassigned_at', null)
  if (assignmentError) throw new Error(`visibleAccountIds: ${assignmentError.message}`)
  for (const a of assignments ?? []) out.add(a.company_id)
  return out
}

/** `canSeeAccount`, throwing ERR_NOT_FOUND — never ERR_FORBIDDEN, which would confirm the id exists. */
export async function assertCanSeeAccount(access: AccountAccess, companyId: string): Promise<void> {
  if (!(await canSeeAccount(access, companyId))) {
    throw new AppError('ERR_NOT_FOUND', `account ${companyId} not visible to ${access.ctx.userId}`)
  }
}
