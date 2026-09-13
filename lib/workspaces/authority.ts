import 'server-only'

/**
 * What a member may do RIGHT NOW — for work that runs with nobody present.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ SEPARATE FROM `context.ts` BECAUSE A WORKER HAS NO REQUEST.           ║
 * ║                                                                           ║
 * ║  `assertWorkspacePermission` re-reads membership on every call, so an      ║
 * ║  interactive caller who was removed is refused on their very next request. ║
 * ║  Unattended work had no equivalent: a published flow carried a boolean     ║
 * ║  stamped at publish time and kept sending as the person who published it,  ║
 * ║  months after they left.                                                   ║
 * ║                                                                           ║
 * ║  `context.ts` cannot serve that path — it imports `next/headers` and reads ║
 * ║  the active-workspace cookie, neither of which exists inside a tick. Hence ║
 * ║  a module with the same authority and none of the request machinery.       ║
 * ║                                                                           ║
 * ║  ⚠️ THIS IS STILL THE ONE AUTHORITY LAYER. `context.ts` says nothing else  ║
 * ║  may read `workspace_memberships` to make a decision, and that stands:     ║
 * ║  this file is part of the same layer, not an exception to it. A worker     ║
 * ║  must call here rather than querying memberships itself.                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { getWorkspaceEntitlements } from '@/lib/workspaces/entitlements'
import { decidePermission, type Permission } from '@/lib/workspaces/permissions'

/**
 * Whether `userId` holds `permission` in `workspaceId` as of this moment.
 *
 * ⚠️ FAILS CLOSED, AND ABSENCE IS THE COMMON CASE. No membership row means
 * removed — the hard `DELETE` in `removeMemberAction` leaves nothing behind —
 * and a removed member may do nothing, so `false` is the answer rather than an
 * error. A null `userId` is the same answer: a version whose publisher was
 * deleted from `auth.users` has `created_by` set to null by the FK, and a flow
 * with nobody accountable for it must not act.
 */
export async function memberMayNow(
  workspaceId: string,
  userId: string | null,
  permission: Permission,
): Promise<boolean> {
  if (!userId) return false

  const { data: membership, error } = await createAdminClient()
    .from('workspace_memberships')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()

  /*
   * ⚠️ A FAILED READ IS NOT A DENIAL, IT IS AN UNKNOWN. Returning false here
   * would turn a database blip into "this flow is not allowed to send", which
   * a caller records as a permanent authorization failure rather than a
   * retryable one. Throwing lets the run fail and come back.
   */
  if (error) throw new Error(`memberMayNow failed: ${error.message}`)
  if (!membership) return false

  const entitlements = await getWorkspaceEntitlements(workspaceId)

  return decidePermission(
    { role: membership.role, modules: entitlements.modules },
    permission,
  ).allowed
}
