import 'server-only'

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  THE WORKSPACE GUARD LAYER.                                              ║
 * ║                                                                          ║
 * ║  Pages call requireWorkspace / requireWorkspacePermission.               ║
 * ║  Actions and route handlers call assertWorkspacePermission.              ║
 * ║                                                                          ║
 * ║  Nothing else reads workspace_memberships to make a decision.            ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Deliberately shaped like `lib/auth/access.ts`: this file GATHERS inputs, and
 * `lib/workspaces/permissions.ts` DECIDES. Page guards redirect so the user
 * lands somewhere useful; action guards throw a typed `AppError` because
 * redirecting out of a mutation is wrong.
 */
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'

import { requireUser, assertUser } from '@/lib/auth/access'
import type { TenantScope } from '@/lib/auth/scope'
import { AppError } from '@/lib/errors/catalog'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  getWorkspaceEntitlements,
  type WorkspaceEntitlements,
} from '@/lib/workspaces/entitlements'
import {
  decidePermission,
  type Module,
  type Permission,
  type WorkspaceRole,
} from '@/lib/workspaces/permissions'

/**
 * Remembers which workspace the user last looked at. A PREFERENCE, never a
 * credential: membership is re-verified from the database on every request, so
 * a forged cookie selects nothing.
 */
export const ACTIVE_WORKSPACE_COOKIE = 'outlio_workspace'

export type WorkspaceSummary = {
  id: string
  name: string
  role: WorkspaceRole
  isOwner: boolean
}

export type WorkspaceContext = {
  userId: string
  email: string | null
  workspace: WorkspaceSummary
  /** Every workspace this user belongs to, for the switcher. */
  memberships: WorkspaceSummary[]
  role: WorkspaceRole
  modules: ReadonlySet<Module>
  /** Seats including the owner. `null` means unlimited. */
  memberLimit: number | null
  memberCount: number
  /**
   * The tenant scope for this request.
   *
   * ⚠️ CARRIED ON THE CONTEXT SO A CALL SITE CANNOT ASSEMBLE ITS OWN. Pass it
   * to `scopedFrom` and the tenant filter is applied for you, with the right
   * column — this codebase has two tenancy models live at once, and
   * `.eq('workspace_id', …)` against a user-scoped table matches nothing and
   * renders as an empty state rather than an error.
   */
  scope: TenantScope
}

/** Every workspace the user belongs to, most recently joined last. */
export async function listMemberships(userId: string): Promise<WorkspaceSummary[]> {
  const db = createAdminClient()

  const { data, error } = await db
    .from('workspace_memberships')
    .select('workspace_id, role, created_at, workspaces!inner(id, name, owner_user_id, deleted_at)')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`listMemberships failed: ${error.message}`)

  return (data ?? [])
    .filter((row) => row.workspaces && !row.workspaces.deleted_at)
    .map((row) => ({
      id: row.workspace_id,
      name: row.workspaces.name,
      role: row.role,
      isOwner: row.workspaces.owner_user_id === userId,
    }))
}

async function countMembers(workspaceId: string): Promise<number> {
  const { count, error } = await createAdminClient()
    .from('workspace_memberships')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)

  if (error) throw new Error(`countMembers failed: ${error.message}`)
  return count ?? 0
}

/**
 * Pick the active workspace.
 *
 * The cookie is only ever used to SELECT among workspaces the user provably
 * belongs to. An unknown id falls through to the default rather than erroring,
 * because a stale cookie — from leaving a workspace, or from another account on
 * a shared browser — is ordinary, not an attack.
 */
function pickActive(
  memberships: WorkspaceSummary[],
  preferredId: string | undefined,
): WorkspaceSummary | null {
  if (memberships.length === 0) return null
  if (preferredId) {
    const match = memberships.find((m) => m.id === preferredId)
    if (match) return match
  }
  return memberships.find((m) => m.isOwner) ?? memberships[0]
}

async function resolve(userId: string, email: string | null): Promise<WorkspaceContext | null> {
  const memberships = await listMemberships(userId)
  const jar = await cookies()
  const active = pickActive(memberships, jar.get(ACTIVE_WORKSPACE_COOKIE)?.value)

  if (!active) return null

  const [entitlements, memberCount]: [WorkspaceEntitlements, number] = await Promise.all([
    getWorkspaceEntitlements(active.id),
    countMembers(active.id),
  ])

  return {
    userId,
    email,
    workspace: active,
    memberships,
    role: active.role,
    modules: entitlements.modules,
    memberLimit: entitlements.memberLimit,
    memberCount,
    scope: { workspaceId: active.id, userId },
  }
}

/**
 * The caller's workspace context, or `null` when they belong to none.
 *
 * `null` should be unreachable in practice — migration 0070 backfills every
 * existing profile and `handle_new_user()` creates one for every signup — but
 * it is returned rather than thrown so a caller can render an honest empty
 * state instead of an error page if that invariant is ever broken.
 */
export const getWorkspaceContext = cache(async function getWorkspaceContext(): Promise<
  WorkspaceContext | null
> {
  const auth = await requireUser()
  if (!auth.userId) return null
  return resolve(auth.userId, auth.email)
})

/** Page guard: an authenticated member of some workspace. */
export async function requireWorkspace(): Promise<WorkspaceContext> {
  const ctx = await getWorkspaceContext()
  if (!ctx) redirect('/dashboard/access?reason=no_request')
  return ctx
}

/** Page guard for one permission. Sends the user somewhere they can act. */
export async function requireWorkspacePermission(
  permission: Permission,
): Promise<WorkspaceContext> {
  const ctx = await requireWorkspace()
  const decision = decidePermission(
    { role: ctx.role, modules: ctx.modules },
    permission,
  )
  if (!decision.allowed) redirect('/dashboard')
  return ctx
}

/**
 * Action / route-handler guard.
 *
 * THIS IS THE API-LEVEL ENFORCEMENT. Hiding a nav item is not access control
 * (CLAUDE.md rule 8), and neither is an entitlement that only dims a button:
 * a workspace whose module is switched off is refused here, before any query
 * runs, whatever the caller's role.
 */
export async function assertWorkspacePermission(
  permission: Permission,
): Promise<WorkspaceContext> {
  const auth = await assertUser()
  if (!auth.userId) throw new AppError('ERR_UNAUTHENTICATED')

  const ctx = await resolve(auth.userId, auth.email)
  if (!ctx) throw new AppError('ERR_FORBIDDEN', 'User belongs to no workspace')

  const decision = decidePermission(
    { role: ctx.role, modules: ctx.modules },
    permission,
  )

  if (!decision.allowed) {
    // The reason reaches the log, never the user: "your plan does not include
    // this" and "your role does not permit this" are different support calls,
    // but neither should tell a prober which one applies.
    throw new AppError(
      'ERR_FORBIDDEN',
      `permission=${permission} reason=${decision.reason} workspace=${ctx.workspace.id}`,
    )
  }

  return ctx
}

/**
 * Assert membership of a SPECIFIC workspace.
 *
 * For actions that carry a workspace id in their payload rather than relying on
 * the active-workspace cookie. Without this a member of workspace A could pass
 * workspace B's id and have the service-role client happily execute it — the
 * exact cross-tenant hole the admin-client banner warns about.
 */
export async function assertWorkspaceMembership(
  workspaceId: string,
  permission: Permission,
): Promise<WorkspaceContext> {
  const ctx = await assertWorkspacePermission(permission)
  if (ctx.workspace.id !== workspaceId) {
    throw new AppError(
      'ERR_FORBIDDEN',
      `workspace mismatch: active=${ctx.workspace.id} requested=${workspaceId}`,
    )
  }
  return ctx
}
