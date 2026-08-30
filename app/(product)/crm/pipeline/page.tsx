import type { Metadata } from 'next'

import { PipelineBoard } from '@/components/crm/PipelineBoard'
import { getBoard, getPipeline } from '@/lib/crm/opportunities'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireWorkspace } from '@/lib/workspaces/context'
import { can, dataScope } from '@/lib/workspaces/permissions'

export const metadata: Metadata = {
  title: 'Pipeline | Outlio',
  robots: { index: false, follow: false },
}

/**
 * The pipeline board.
 *
 * ⚠️ SCOPE IS APPLIED HERE, NOT IN THE COMPONENT. RLS grants a member the
 * whole workspace; `dataScope` is what narrows a setter to their own deals,
 * and it has to be applied to the QUERY. A board that forgets shows a setter
 * the entire company's pipeline.
 */
export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ pipeline?: string; owner?: string }>
}) {
  const ctx = await requireWorkspace()
  const params = await searchParams

  const pipelineId = params.pipeline ?? (await defaultPipelineId(ctx.workspace.id))

  if (!pipelineId) {
    return (
      <section className="clay p-10 text-center">
        <h2 className="text-base font-semibold text-ink">No pipeline yet</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
          A pipeline defines the stages a deal moves through. Once one exists, your
          board appears here.
        </p>
      </section>
    )
  }

  const pipeline = await getPipeline(ctx.workspace.id, pipelineId)
  if (!pipeline) {
    return (
      <section className="clay p-10 text-center">
        <h2 className="text-base font-semibold text-ink">That pipeline does not exist</h2>
        <p className="mt-2 text-sm text-muted">It may have been archived.</p>
      </section>
    )
  }

  // A setter sees only their own deals. A manager may narrow to one person via
  // ?owner=, but can never widen beyond their own scope.
  const scopedToSelf = dataScope(ctx.role) === 'assigned'
  const ownerUserId = scopedToSelf ? ctx.userId : (params.owner ?? null)

  const columns = await getBoard(ctx.workspace.id, pipelineId, { ownerUserId })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">{pipeline.name}</h2>
        {scopedToSelf ? (
          <p className="text-xs text-muted">Showing deals assigned to you</p>
        ) : null}
      </div>

      <PipelineBoard
        columns={columns}
        canMove={can({ role: ctx.role, modules: ctx.modules }, 'crm.opportunity.edit')}
      />
    </div>
  )
}

async function defaultPipelineId(workspaceId: string): Promise<string | null> {
  const db = createAdminClient()

  const { data: preferred } = await db
    .from('crm_pipelines')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('is_default', true)
    .is('archived_at', null)
    .maybeSingle()

  if (preferred) return preferred.id

  // No default set is ordinary, not an error — fall back to the first.
  const { data } = await db
    .from('crm_pipelines')
    .select('id')
    .eq('workspace_id', workspaceId)
    .is('archived_at', null)
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle()

  return data?.id ?? null
}
