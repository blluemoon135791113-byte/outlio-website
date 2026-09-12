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
 *
 * THE ONE BYPASS is a workspace owned by Outlio staff (`profiles.role =
 * 'admin'`), which gets every module and unlimited seats. That is not a
 * special case invented here: `decideAccess` already exempts admins from plan
 * limits and `hasHubbleEntitlement` already exempts them from the Hubble
 * gate. Flags still bite, so a kill switch works for staff too.
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
  options: { platformAdmin?: boolean } = {},
): Set<Module> {
  const modules = new Set<Module>()

  /*
   * ⚠️ PLATFORM ADMIN BYPASSES THE PLAN, NOT THE FEATURE FLAGS.
   *
   * `profiles.role = 'admin'` is Outlio staff, not a workspace role. The same
   * bypass already exists for scraper limits (`decideAccess` in
   * lib/auth/decide.ts) and for Hubble (`hasHubbleEntitlement`), so extending
   * it to modules keeps one rule rather than three.
   *
   * A workspace flag set to FALSE still wins below: an admin must be able to
   * switch a broken module off for themselves, and a kill switch that the one
   * person most likely to need it cannot use is not a kill switch.
   */
  if (options.platformAdmin) {
    for (const candidate of MODULES) modules.add(candidate)
  } else if (!limits) {
    return modules
  }

  // Named `candidate`, not `module`: `module` is a reserved binding in a Next
  // module scope and @next/next/no-assign-module-variable rejects it.
  for (const candidate of MODULES) {
    if (flags.get(MODULE_FLAG[candidate]) === false) {
      modules.delete(candidate)
      continue
    }
    if (modules.has(candidate)) continue
    if (limits?.[ENTITLEMENT_KEY[candidate]] === true) modules.add(candidate)
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
/**
 * How many LinkedIn senders a workspace may link.
 *
 * ⚠️ AN ABSENT CAP FALLS BACK TO THE SEAT COUNT, NOT TO UNLIMITED — and that
 * is the whole point of the default. §4.10 defines a sender as one real person
 * who performs their own actions in LinkedIn's interface, and warns that "one
 * person using multiple borrowed, purchased, or shared accounts is not the
 * supported way to scale". A workspace with more senders than seats is one
 * where somebody is operating an account that is not theirs.
 *
 * ⚠️ `null` FROM THE PLAN IS "NOT SET", WHILE `null` FROM THE SEAT COUNT IS
 * "UNLIMITED". They read identically and mean opposite things. An absent plan
 * key and an explicit null are indistinguishable after Zod's default, so both
 * mean "not set" and the seat count answers — including when the seat count is
 * itself unlimited, which passes straight through.
 *
 * ⚠️ AND `||` WOULD BE WRONG HERE, THOUGH `??` WOULD NOT. A plan that grants
 * the module but zero senders is coherent, and `||` turns that 0 into the seat
 * count — silently handing out senders a pricing decision withheld. The
 * explicit comparison says which case is which rather than relying on the
 * reader knowing that difference.
 */
export function resolveSenderLimit(
  limits: PlanLimits | null,
  memberLimit: number | null,
): number | null {
  const configured = limits?.linkedin_senders_max ?? null
  return configured === null ? memberLimit : configured
}

export function resolveMemberLimit(
  limits: PlanLimits | null,
  override: number | null,
  options: { platformAdmin?: boolean } = {},
): number | null {
  // The override still wins, so support can pin a specific number even on an
  // admin's own workspace.
  if (override !== null) return override
  // Platform staff are not seat-limited, for the same reason they are not
  // extraction-limited.
  if (options.platformAdmin) return null
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
    .select('plan_id, role')
    .eq('id', workspace.owner_user_id)
    .maybeSingle()

  if (ownerError) {
    throw new Error(`getWorkspaceEntitlements: ${ownerError.message}`)
  }

  const plan = owner?.plan_id ? await getPlanById(owner.plan_id) : null
  const platformAdmin = owner?.role === 'admin'

  const { data: flagRows, error: flagError } = await db
    .from('workspace_feature_flags')
    .select('flag, enabled')
    .eq('workspace_id', workspaceId)

  if (flagError) {
    throw new Error(`getWorkspaceEntitlements: ${flagError.message}`)
  }

  const flags = new Map((flagRows ?? []).map((row) => [row.flag, row.enabled]))

  return {
    modules: resolveModules(plan?.limits ?? null, flags, { platformAdmin }),
    memberLimit: resolveMemberLimit(plan?.limits ?? null, workspace.member_limit_override, {
      platformAdmin,
    }),
  }
}
