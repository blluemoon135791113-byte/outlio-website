'use server'

/**
 * Server actions for the pipeline board.
 *
 * Every one asserts permission BEFORE touching data. Dragging a card is a
 * mutation like any other; that it began as a mouse gesture changes nothing
 * about who is allowed to do it.
 */
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { isAppError } from '@/lib/errors/catalog'
import { moveStage, StaleOpportunityError } from '@/lib/crm/opportunities'
import { assertWorkspacePermission } from '@/lib/workspaces/context'
import { dataScope } from '@/lib/workspaces/permissions'
import { createAdminClient } from '@/lib/supabase/admin'

export type MoveCardState =
  | { status: 'idle' }
  | { status: 'error'; message: string; /** Set when the board is out of date. */ stale?: boolean }
  | { status: 'success'; opportunityId: string; version: number }

const uuid = z.string().uuid()

/**
 * Moves a card between columns.
 *
 * `expectedVersion` is the version the BROWSER last saw. If a colleague moved
 * the same deal in the meantime the move is refused and `stale` comes back
 * true, so the UI can put the card back and tell the user rather than
 * silently overwriting someone else's work.
 */
export async function moveCardAction(
  _prev: MoveCardState,
  formData: FormData,
): Promise<MoveCardState> {
  try {
    const ctx = await assertWorkspacePermission('crm.opportunity.edit')

    const opportunityId = uuid.safeParse(formData.get('opportunity_id'))
    const toStageId = uuid.safeParse(formData.get('to_stage_id'))
    const version = z.coerce.number().int().positive().safeParse(formData.get('version'))

    if (!opportunityId.success || !toStageId.success || !version.success) {
      return { status: 'error', message: 'That move could not be read. Refresh and try again.' }
    }

    const lostReason = String(formData.get('lost_reason') ?? '').trim()

    // ⚠️ A SETTER MAY ONLY MOVE THEIR OWN DEALS. RLS grants a member the whole
    // workspace, so `dataScope` is what narrows them — applied here because a
    // policy cannot express "rows assigned to you".
    if (dataScope(ctx.role) === 'assigned') {
      const { data, error } = await createAdminClient()
        .from('crm_opportunities')
        .select('owner_user_id')
        .eq('workspace_id', ctx.workspace.id)
        .eq('id', opportunityId.data)
        .maybeSingle()

      if (error) throw new Error(error.message)
      if (!data || data.owner_user_id !== ctx.userId) {
        return { status: 'error', message: 'That deal is not assigned to you.' }
      }
    }

    const result = await moveStage(
      ctx.workspace.id,
      opportunityId.data,
      toStageId.data,
      version.data,
      { actorUserId: ctx.userId, ...(lostReason ? { lostReason } : {}) },
    )

    revalidatePath('/crm/pipeline')
    return { status: 'success', opportunityId: result.opportunityId, version: result.version }
  } catch (error) {
    if (error instanceof StaleOpportunityError) {
      return { status: 'error', message: error.message, stale: true }
    }
    if (isAppError(error)) return { status: 'error', message: error.userMessage }
    if (error instanceof Error && /needs a reason/i.test(error.message)) {
      return { status: 'error', message: 'Tell us why this deal was lost before closing it.' }
    }
    if (error instanceof Error && /already in that stage/i.test(error.message)) {
      // Dropping a card back where it started is a no-op, not a failure.
      return { status: 'idle' }
    }
    return { status: 'error', message: 'That move did not go through. Refresh and try again.' }
  }
}
