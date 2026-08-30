import 'server-only'

/**
 * What a workspace is allowed to have, as opposed to what a member is allowed
 * to do. Roles are answered by `lib/workspaces/permissions.ts`; this file
 * answers "does this account include CRM at all?".
 *
 * TWO INPUTS, AND THE ORDER MATTERS:
 *
 *   1. the OWNER's plan (`plans.limits`) — what was paid for
 *   2. the workspace's feature flags     — what has been switched off
 *
 * A flag can only ever RESTRICT. `enabled: true` on a module the plan does not
 * include grants nothing. If a flag could grant, then a kill switch — the
 * reason A3 requires flags at all — would double as a way to hand out unpaid
 * modules, and a support engineer disabling a broken module for one customer
 * would be one typo away from giving it to everyone.
 */
import { getPlanById } from '@/lib/limits/plans'
import { createAdminClient } from '@/lib/supabase/admin'
import { MODULES, type Module } from '@/lib/workspaces/permissions'
import type { PlanLimits } from '@/types/database'

/** `plans.limits` key that entitles each module. */
const ENTITLEMENT_KEY: Record<Module, keyof PlanLimits> = {
  crm: 'crm_enabled',
  email: 'email_enabled',
  flows: 'flows_enabled',
  reports: 'reports_enabled',
  integrations: 'integrations_enabled',
  hubble: 'hubble_enabled',
}

/** `workspace_feature_flags.flag` value that can switch each module off. */
export const MODULE_FLAG: Record<Module, string> = {
  crm: 'module.crm',
  email: 'module.email',
  flows: 'module.flows',
  reports: 'module.reports',
  integrations: 'module.integrations',
  hubble: 'module.hubble',
}

export type WorkspaceEntitlements = {
  modules: ReadonlySet<Module>
  /** Seats including the owner. `null` means unlimited. */
  memberLimit: number | null
}

/**
 * The pure half. No I/O, so every combination is unit-testable.
 *
 * `flags` holds only rows that EXIST. An absent flag means "not overridden",
 * which is why the lookup defaults to `true` rather than `false`: a workspace
 * that has never been touched by support must get everything its plan includes.
 */
export function resolveModules(
  limits: PlanLimits | null,
  flags: ReadonlyMap<string, boolean>,
): Set<Module> {
  const modules = new Set<Module>()
  if (!limits) return modules

  // Named `candidate`, not `module`: `module` is a reserved binding in a Next
  // module scope and @next/next/no-assign-module-variable rejects it.
  for (const candidate of MODULES) {
    const entitled = limits[ENTITLEMENT_KEY[candidate]] === true
    if (!entitled) continue
    if (flags.get(MODULE_FLAG[candidate]) === false) continue
    modules.add(candidate)
  }

  return modules
}

/**
 * Effective seat count.
 *
 * The per-workspace override wins when present, so support can widen one
 * account without inventing a plan tier. `null` from either source means
 * unlimited — and an override of `null` is indistinguishable from "no
 * override", which is why the column is nullable and unlimited is expressed by
 * the PLAN, never by an override.
 */
export function resolveMemberLimit(
  limits: PlanLimits | null,
  override: number | null,
): number | null {
  if (override !== null) return override
  // NOT `?? 1`: `??` fires on null, and null is how a plan says UNLIMITED.
  // Only the absence of a plan altogether falls back to a single seat.
  if (!limits) return 1
  return limits.workspace_member_limit
}

/**
 * Resolve entitlements for one workspace.
 *
 * The plan is the OWNER's, not the caller's: a workspace is one billing
 * relationship, and a member on a free personal plan working inside a paid
 * workspace must get the workspace's modules.
 */
export async function getWorkspaceEntitlements(
  workspaceId: string,
): Promise<WorkspaceEntitlements> {
  const db = createAdminClient()

  const { data: workspace, error: workspaceError } = await db
    .from('workspaces')
    .select('owner_user_id, member_limit_override')
    .eq('id', workspaceId)
    .is('deleted_at', null)
    .maybeSingle()

  if (workspaceError) {
    throw new Error(`getWorkspaceEntitlements: ${workspaceError.message}`)
  }
  if (!workspace) return { modules: new Set(), memberLimit: 0 }

  const { data: owner, error: ownerError } = await db
    .from('profiles')
    .select('plan_id')
    .eq('id', workspace.owner_user_id)
    .maybeSingle()

  if (ownerError) {
    throw new Error(`getWorkspaceEntitlements: ${ownerError.message}`)
  }

  const plan = owner?.plan_id ? await getPlanById(owner.plan_id) : null

  const { data: flagRows, error: flagError } = await db
    .from('workspace_feature_flags')
    .select('flag, enabled')
    .eq('workspace_id', workspaceId)

  if (flagError) {
    throw new Error(`getWorkspaceEntitlements: ${flagError.message}`)
  }

  const flags = new Map((flagRows ?? []).map((row) => [row.flag, row.enabled]))

  return {
    modules: resolveModules(plan?.limits ?? null, flags),
    memberLimit: resolveMemberLimit(plan?.limits ?? null, workspace.member_limit_override),
  }
}
