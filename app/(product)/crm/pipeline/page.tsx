import type { Metadata } from 'next'

import { PipelineBoard } from '@/components/crm/PipelineBoard'
import { NewOpportunityButton } from '@/components/crm/NewOpportunity'
import { NewPipelineButton, PipelineSetup } from '@/components/crm/PipelineSetup'
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

  const canManage = can({ role: ctx.role, modules: ctx.modules }, 'crm.pipeline.manage')

  if (!pipelineId) {
    /*
     * ⚠️ THIS EMPTY STATE USED TO BE A DEAD END. It said "once one exists, your
     * board appears here" and offered no way to make one — `createPipeline`
     * had no caller anywhere in the product. The onboarding checklist sent
     * people straight to it.
     */
    return canManage ? (
      <PipelineSetup isFirstPipeline />
    ) : (
      <section className="clay p-10 text-center">
        <h2 className="text-base font-semibold text-ink">No pipeline yet</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
          A pipeline defines the stages a deal moves through. Ask a manager to set one
          up and your board appears here.
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">
              {pipeline.name}
            </h2>
            {scopedToSelf ? (
              <p className="text-xs text-muted">Showing deals assigned to you</p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/*
              ⚠️ THE PRIMARY ACTION ON THIS SCREEN. A board you cannot add a
              deal to is a report, not a pipeline — and until R4 there was no
              way to create one anywhere in the product.
            */}
            {can({ role: ctx.role, modules: ctx.modules }, 'crm.opportunity.create') ? (
              <NewOpportunityButton
                pipelineId={pipelineId}
                stages={pipeline.stages.map((s) => ({
                  id: s.id,
                  name: s.name,
                  kind: s.kind,
                }))}
                contacts={await pickableContacts(ctx.workspace.id, scopedToSelf ? ctx.userId : null)}
              />
            ) : null}

            {/*
              ⚠️ SECONDARY STYLING, BECAUSE THESE DO VERY DIFFERENT THINGS.
              "New deal" adds a record to THIS pipeline; "New pipeline" creates
              a whole new board. Rendered identically side by side — same
              colour, weight and size — they invited exactly the misclick that
              leaves someone with an accidental second pipeline.
            */}
            {canManage ? <NewPipelineButton /> : null}
          </div>
        </div>
      </div>

      <PipelineBoard
        columns={columns}
        canMove={can({ role: ctx.role, modules: ctx.modules }, 'crm.opportunity.edit')}
        workspaceId={ctx.workspace.id}
        pipelineId={pipelineId}
      />
    </div>
  )
}

/**
 * Contacts offered in the deal form.
 *
 * ⚠️ BOUNDED AND SCOPED. Loading every contact would put a 100,000-row select
 * in a page render, and a setter must only see their own — the same
 * `dataScope` rule the rest of the CRM follows.
 */
async function pickableContacts(
  workspaceId: string,
  ownerUserId: string | null,
): Promise<{ id: string; name: string }[]> {
  const db = createAdminClient()

  let query = db
    .from('crm_contacts')
    .select('id, full_name')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(100)

  if (ownerUserId) query = query.eq('owner_user_id', ownerUserId)

  const { data } = await query
  return (data ?? []).map((c) => ({ id: c.id, name: c.full_name ?? 'Unnamed contact' }))
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
