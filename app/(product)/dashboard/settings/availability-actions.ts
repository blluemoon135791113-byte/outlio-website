'use server'

/**
 * A member marking THEMSELVES away from routed leads.
 *
 * ⚠️ THE PERSON CHANGED IS ALWAYS THE CALLER. No user id is read from the form:
 * a server action is a public endpoint, and one that took a `userId` would let
 * any member take a colleague out of routing — which the admin control on Lead
 * routing settings exists to gate behind `crm.routing.manage`.
 *
 * `workspace.view` is the gate because every member may say when they are
 * away; what it changes is only their own row.
 */
import { revalidatePath } from 'next/cache'

import { parseAwayDate } from '@/lib/crm/away-date'
import { setAwayUntil } from '@/lib/crm/routing-rules'
import { assertWorkspacePermission } from '@/lib/workspaces/context'

export type AvailabilityActionState = { ok: true; message: string } | { ok: false; error: string } | null

export async function setMyAwayAction(
  _previous: AvailabilityActionState,
  formData: FormData,
): Promise<AvailabilityActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('workspace.view')
  } catch {
    return { ok: false, error: 'Sign in to a workspace to change your availability.' }
  }

  const parsed = parseAwayDate(String(formData.get('awayUntil') ?? ''), new Date())
  if ('error' in parsed) return { ok: false, error: parsed.error }

  try {
    await setAwayUntil(ctx.workspace.id, ctx.userId, ctx.userId, parsed.awayUntil)
    revalidatePath('/dashboard/settings')
    revalidatePath('/dashboard/settings/routing')
    return {
      ok: true,
      message: parsed.awayUntil
        ? 'You are marked away. You receive no routed leads until then.'
        : 'You are available for routed leads again.',
    }
  } catch {
    return { ok: false, error: 'Could not change your availability.' }
  }
}
