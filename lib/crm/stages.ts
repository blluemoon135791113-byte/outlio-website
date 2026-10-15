import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

/** A rule the person can fix, shown to them as-is (not a database error). */
export class ListRuleError extends Error {}

type ActiveStage = { id: string; name: string; kind: 'open' | 'won' | 'lost'; sort_order: number }

/**
 * The lists (stages) of one Opportunities board — add, rename, reorder,
 * remove. Trello-style editing on top of 0076's stages; no new tables.
 *
 * Every method re-reads the board's active stages scoped by workspace AND
 * pipeline, so a stage id from a form is checked against this board before
 * anything is written (the service role bypasses RLS).
 *
 * Removing ARCHIVES, never deletes: closed deals and stage history still
 * reference the stage, and reports must keep explaining them.
 */
export class PipelineLists {
  private readonly db = createAdminClient()

  constructor(
    private readonly workspaceId: string,
    private readonly pipelineId: string,
  ) {}

  /** New lists go before Won/Lost, so closing columns stay at the end. */
  async add(name: string): Promise<void> {
    const stages = await this.stages()
    const firstClosed = stages.find((s) => s.kind !== 'open')
    const position = firstClosed ? firstClosed.sort_order : (stages.at(-1)?.sort_order ?? 0) + 1

    // Shift the closed columns right, last first, to open a gap.
    for (const stage of stages.filter((s) => s.sort_order >= position).reverse()) {
      await this.setOrder(stage.id, stage.sort_order + 1)
    }

    const { error } = await this.db.from('crm_pipeline_stages').insert({
      workspace_id: this.workspaceId,
      pipeline_id: this.pipelineId,
      name: clean(name),
      kind: 'open',
      sort_order: position,
    })
    if (error) throw new Error(`PipelineLists.add failed: ${error.message}`)
  }

  async rename(stageId: string, name: string): Promise<void> {
    await this.find(stageId)
    const { error } = await this.db
      .from('crm_pipeline_stages')
      .update({ name: clean(name) })
      .eq('workspace_id', this.workspaceId)
      .eq('id', stageId)
    if (error) throw new Error(`PipelineLists.rename failed: ${error.message}`)
  }

  /** Swaps with the neighbouring list. A no-op at either end. */
  async move(stageId: string, direction: -1 | 1): Promise<void> {
    const stages = await this.stages()
    const index = stages.findIndex((s) => s.id === stageId)
    if (index < 0) throw new ListRuleError('That list is not on this board.')
    const neighbour = stages[index + direction]
    if (!neighbour) return

    const [from, to] = [stages[index].sort_order, neighbour.sort_order]
    await this.setOrder(stageId, to)
    await this.setOrder(neighbour.id, from)
  }

  async remove(stageId: string): Promise<void> {
    const stages = await this.stages()
    const stage = stages.find((s) => s.id === stageId)
    if (!stage) throw new ListRuleError('That list is not on this board.')

    if (stage.kind === 'open' && stages.filter((s) => s.kind === 'open').length === 1) {
      throw new ListRuleError('A board needs at least one open list.')
    }

    const { count, error } = await this.db
      .from('crm_opportunities')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', this.workspaceId)
      .eq('stage_id', stageId)
      .eq('status', 'open')
      .is('deleted_at', null)
    if (error) throw new Error(`PipelineLists.remove failed: ${error.message}`)
    if ((count ?? 0) > 0) throw new ListRuleError('Move the cards out of this list first.')

    const { error: archiveError } = await this.db
      .from('crm_pipeline_stages')
      .update({ archived_at: new Date().toISOString() })
      .eq('workspace_id', this.workspaceId)
      .eq('id', stageId)
    if (archiveError) throw new Error(`PipelineLists.remove failed: ${archiveError.message}`)
  }

  private async stages(): Promise<ActiveStage[]> {
    const { data: pipeline, error: pipelineError } = await this.db
      .from('crm_pipelines')
      .select('id')
      .eq('workspace_id', this.workspaceId)
      .eq('id', this.pipelineId)
      .is('archived_at', null)
      .maybeSingle()
    if (pipelineError) throw new Error(`PipelineLists failed: ${pipelineError.message}`)
    if (!pipeline) throw new ListRuleError('That board does not exist.')

    const { data, error } = await this.db
      .from('crm_pipeline_stages')
      .select('id, name, kind, sort_order')
      .eq('workspace_id', this.workspaceId)
      .eq('pipeline_id', this.pipelineId)
      .is('archived_at', null)
      .order('sort_order', { ascending: true })
    if (error) throw new Error(`PipelineLists failed: ${error.message}`)
    return data ?? []
  }

  private async find(stageId: string): Promise<ActiveStage> {
    const stage = (await this.stages()).find((s) => s.id === stageId)
    if (!stage) throw new ListRuleError('That list is not on this board.')
    return stage
  }

  private async setOrder(stageId: string, sortOrder: number): Promise<void> {
    const { error } = await this.db
      .from('crm_pipeline_stages')
      .update({ sort_order: sortOrder })
      .eq('workspace_id', this.workspaceId)
      .eq('id', stageId)
    if (error) throw new Error(`PipelineLists reorder failed: ${error.message}`)
  }
}

function clean(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length < 1 || trimmed.length > 120) {
    throw new ListRuleError('List names are 1–120 characters.')
  }
  return trimmed
}
