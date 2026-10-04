import 'server-only'

/**
 * Deals for accounts: "Move to pipeline" from the Accounts list, and the
 * stage choices both it and the account page's "New deal" offer.
 *
 * Two rules decide who may: `crm.opportunity.create` (the deal) AND the
 * account rule (an account the caller cannot see is skipped as if it did not
 * exist). The database function (0155) makes the "already has an open deal in
 * this pipeline" check under each account's row lock.
 */
import { z } from 'zod'

import { visibleAccountIds, type AccountAccess } from '@/lib/crm/account-access'
import { recordAudit } from '@/lib/crm/activities'
import { AppError } from '@/lib/errors/catalog'
import { createAdminClient } from '@/lib/supabase/admin'

export type StageChoice = { stageId: string; pipelineId: string; label: string }

/**
 * Every OPEN stage of every live pipeline, labelled "Pipeline › Stage", in
 * board order. A deal never starts won or lost.
 */
export async function openStageChoices(workspaceId: string): Promise<StageChoice[]> {
  const db = createAdminClient()
  const [pipelines, stages] = await Promise.all([
    db
      .from('crm_pipelines')
      .select('id, name, sort_order')
      .eq('workspace_id', workspaceId)
      .is('archived_at', null)
      .order('sort_order')
      .order('name'),
    db
      .from('crm_pipeline_stages')
      .select('id, pipeline_id, name, sort_order')
      .eq('workspace_id', workspaceId)
      .eq('kind', 'open')
      .is('archived_at', null)
      .order('sort_order'),
  ])
  if (pipelines.error) throw new Error(`openStageChoices failed: ${pipelines.error.message}`)
  if (stages.error) throw new Error(`openStageChoices failed: ${stages.error.message}`)

  const out: StageChoice[] = []
  for (const pipeline of pipelines.data ?? []) {
    for (const stage of (stages.data ?? []).filter((s) => s.pipeline_id === pipeline.id)) {
      out.push({ stageId: stage.id, pipelineId: pipeline.id, label: `${pipeline.name} › ${stage.name}` })
    }
  }
  return out
}

const RESULT = z.object({
  pipeline_id: z.string().uuid(),
  created: z.array(z.object({ company_id: z.string().uuid(), opportunity_id: z.string().uuid() })),
  skipped_open: z.array(z.string().uuid()),
  skipped_unnamed: z.array(z.string().uuid()),
  missing: z.number().int().nonnegative(),
})

export type MoveToPipelineResult = {
  created: number
  /** Already had an open deal in that pipeline. */
  alreadyThere: number
  /** No name and no domain to call the deal — never invented. */
  unnamed: number
  /** Not visible to the caller, deleted, or not an account here. */
  notFound: number
}

/**
 * One deal per account, in `stageId`, owned by the caller. The caller has
 * already checked `crm.opportunity.create`; visibility is checked HERE, per
 * account, before the ids reach the database.
 */
export async function moveAccountsToPipeline(
  access: AccountAccess,
  stageId: string,
  accountIds: string[],
): Promise<MoveToPipelineResult> {
  const ids = [...new Set(accountIds)]
  if (ids.length === 0 || ids.length > 100) throw new AppError('ERR_VALIDATION', 'account count')

  const allowed = await visibleAccountIds(access, ids)
  const visible = ids.filter((id) => allowed.has(id))
  const hidden = ids.length - visible.length
  if (visible.length === 0) return { created: 0, alreadyThere: 0, unnamed: 0, notFound: hidden }

  const { data, error } = await createAdminClient().rpc('crm_create_account_deals', {
    p_workspace_id: access.ctx.workspace.id,
    p_stage_id: stageId,
    p_company_ids: visible,
    p_owner_user_id: access.ctx.userId,
    p_actor_id: access.ctx.userId,
  })
  if (error) {
    if (error.code === '23514' && error.message.startsWith('crm_create_account_deals: ')) {
      throw new AppError('ERR_VALIDATION', error.message)
    }
    throw new Error(`moveAccountsToPipeline failed: ${error.message}`)
  }

  const result = RESULT.parse(data)

  if (result.created.length > 0) {
    /*
     * ⚠️ AFTER THE DEALS COMMITTED, SO IT MUST NOT FAIL THE CALL: an error here
     * would tell the person nothing happened, and a retry would then report
     * every account as "already in that pipeline".
     */
    try {
      await recordAudit(access.ctx.workspace.id, {
        action: 'crm.account.moved_to_pipeline',
        targetType: 'crm_pipeline',
        targetId: result.pipeline_id,
        actorUserId: access.ctx.userId,
        after: { stageId, deals: result.created },
      })
    } catch (error) {
      console.error('[moveAccountsToPipeline] audit', error instanceof Error ? error.message : 'unknown error')
    }
  }

  return {
    created: result.created.length,
    alreadyThere: result.skipped_open.length,
    unnamed: result.skipped_unnamed.length,
    notFound: hidden + result.missing,
  }
}
