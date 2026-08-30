import 'server-only'

/**
 * Opportunities and pipelines (M3 Phase 6).
 *
 * ⚠️ A STAGE IS NEVER CHANGED BY AN UPDATE. `moveStage` is the only path, and
 * it goes through `crm_move_opportunity_stage` (0076) so the version check,
 * the stage history and the single activity cannot come apart from the move.
 * A direct `.update({ stage_id })` would skip all three.
 *
 * ⚠️ THE SERVICE ROLE BYPASSES RLS. Every query is scoped by `workspace_id`.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'

export type OpportunityStatus = Database['public']['Enums']['crm_opportunity_status']
export type StageKind = Database['public']['Enums']['crm_stage_kind']

export class StaleOpportunityError extends Error {}

// ---------------------------------------------------------------------------
// Pipelines
// ---------------------------------------------------------------------------

export type StageInput = {
  name: string
  kind?: StageKind
  defaultProbability?: number
  staleAfterDays?: number | null
}

export type Pipeline = {
  id: string
  name: string
  isDefault: boolean
  stages: { id: string; name: string; kind: StageKind; sortOrder: number; defaultProbability: number }[]
}

/**
 * Creates a pipeline and its stages in one call.
 *
 * A pipeline with no stages is unusable — an opportunity cannot exist without
 * one — so there is no path that creates the parent alone and leaves someone
 * to discover the gap.
 */
export async function createPipeline(
  workspaceId: string,
  input: { name: string; stages: StageInput[]; isDefault?: boolean },
  actorUserId: string | null = null,
): Promise<string> {
  if (input.stages.length === 0) {
    throw new Error('createPipeline: a pipeline needs at least one stage')
  }

  const db = createAdminClient()

  const { data: pipeline, error } = await db
    .from('crm_pipelines')
    .insert({
      workspace_id: workspaceId,
      name: input.name.trim(),
      is_default: input.isDefault ?? false,
      created_by: actorUserId,
    })
    .select('id')
    .single()

  if (error) {
    // The partial unique index on (workspace_id) where is_default.
    if (error.code === '23505') {
      throw new Error('createPipeline: this workspace already has a default pipeline')
    }
    throw new Error(`createPipeline failed: ${error.message}`)
  }

  const { error: stageError } = await db.from('crm_pipeline_stages').insert(
    input.stages.map((stage, index) => ({
      workspace_id: workspaceId,
      pipeline_id: pipeline.id,
      name: stage.name.trim(),
      kind: stage.kind ?? 'open',
      // Position comes from ARRAY ORDER, not from a field the caller has to
      // keep consistent with it.
      sort_order: index + 1,
      default_probability: stage.defaultProbability ?? 0,
      stale_after_days: stage.staleAfterDays ?? null,
    })),
  )

  if (stageError) throw new Error(`createPipeline failed: ${stageError.message}`)
  return pipeline.id
}

/** A pipeline with its stages in board order. */
export async function getPipeline(
  workspaceId: string,
  pipelineId: string,
): Promise<Pipeline | null> {
  const db = createAdminClient()

  const { data: pipeline, error } = await db
    .from('crm_pipelines')
    .select('id, name, is_default')
    .eq('workspace_id', workspaceId)
    .eq('id', pipelineId)
    .is('archived_at', null)
    .maybeSingle()

  if (error) throw new Error(`getPipeline failed: ${error.message}`)
  if (!pipeline) return null

  const { data: stages, error: stageError } = await db
    .from('crm_pipeline_stages')
    .select('id, name, kind, sort_order, default_probability')
    .eq('workspace_id', workspaceId)
    .eq('pipeline_id', pipelineId)
    .is('archived_at', null)
    .order('sort_order', { ascending: true })

  if (stageError) throw new Error(`getPipeline failed: ${stageError.message}`)

  return {
    id: pipeline.id,
    name: pipeline.name,
    isDefault: pipeline.is_default,
    stages: (stages ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      sortOrder: s.sort_order,
      defaultProbability: s.default_probability,
    })),
  }
}

// ---------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------

export type CreateOpportunityInput = {
  title: string
  pipelineId: string
  /** Defaults to the pipeline's first stage. */
  stageId?: string
  contactId?: string | null
  companyId?: string | null
  ownerUserId?: string | null
  /** Stored as `numeric(14,2)` — see Ledger D25 and the note on `Opportunity`. */
  valueAmount?: number | null
  currency?: string
  expectedCloseDate?: string | null
}

export type Opportunity = {
  id: string
  title: string
  pipelineId: string
  stageId: string
  status: OpportunityStatus
  /** ⚠️ Pass this back to `moveStage`. It is the optimistic lock. */
  version: number
  /**
   * ⚠️ EXACT IN THE DATABASE, A DOUBLE HERE.
   *
   * The column is `numeric(14,2)`, so what is STORED is exact. PostgREST
   * serialises it as a JSON number, so what arrives in JavaScript is a double
   * — fine for one value (any 2-decimal amount below 2^53/100 round-trips
   * exactly enough that Postgres stores it back unchanged), and NOT fine for a
   * total.
   *
   * ⚠️ NEVER SUM THESE IN JAVASCRIPT. A pipeline total adds thousands of them
   * and the error compounds until the forecast stops reconciling with the
   * deals behind it. Aggregate in SQL — M4's forecasting (Phase 10.5) does,
   * and nothing here computes a total precisely because doing it wrong is
   * worse than not having it yet.
   */
  valueAmount: number | null
  currency: string
  probability: number
  ownerUserId: string | null
  contactId: string | null
  companyId: string | null
  expectedCloseDate: string | null
}

export async function createOpportunity(
  workspaceId: string,
  input: CreateOpportunityInput,
  actorUserId: string | null = null,
): Promise<string> {
  const db = createAdminClient()

  let stageId = input.stageId
  let probability = 0

  if (!stageId) {
    const { data, error } = await db
      .from('crm_pipeline_stages')
      .select('id, default_probability')
      .eq('workspace_id', workspaceId)
      .eq('pipeline_id', input.pipelineId)
      .is('archived_at', null)
      .order('sort_order', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (error) throw new Error(`createOpportunity failed: ${error.message}`)
    if (!data) throw new Error('createOpportunity: that pipeline has no stages')
    stageId = data.id
    probability = data.default_probability
  } else {
    const { data, error } = await db
      .from('crm_pipeline_stages')
      .select('default_probability')
      .eq('workspace_id', workspaceId)
      .eq('id', stageId)
      .maybeSingle()

    if (error) throw new Error(`createOpportunity failed: ${error.message}`)
    if (!data) throw new Error('createOpportunity: no such stage in this workspace')
    probability = data.default_probability
  }

  const { data, error } = await db
    .from('crm_opportunities')
    .insert({
      workspace_id: workspaceId,
      title: input.title.trim(),
      pipeline_id: input.pipelineId,
      stage_id: stageId,
      contact_id: input.contactId ?? null,
      company_id: input.companyId ?? null,
      owner_user_id: input.ownerUserId ?? null,
      value_amount: input.valueAmount ?? null,
      currency: (input.currency ?? 'USD').toUpperCase(),
      probability,
      expected_close_date: input.expectedCloseDate ?? null,
      created_by: actorUserId,
    })
    .select('id')
    .single()

  if (error) throw new Error(`createOpportunity failed: ${error.message}`)
  return data.id
}

export async function getOpportunity(
  workspaceId: string,
  opportunityId: string,
): Promise<Opportunity | null> {
  const { data, error } = await createAdminClient()
    .from('crm_opportunities')
    .select('id, title, pipeline_id, stage_id, status, version, value_amount, currency, probability, owner_user_id, contact_id, company_id, expected_close_date')
    .eq('workspace_id', workspaceId)
    .eq('id', opportunityId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw new Error(`getOpportunity failed: ${error.message}`)
  if (!data) return null

  return {
    id: data.id,
    title: data.title,
    pipelineId: data.pipeline_id,
    stageId: data.stage_id,
    status: data.status,
    version: data.version,
    valueAmount: data.value_amount,
    currency: data.currency,
    probability: data.probability,
    ownerUserId: data.owner_user_id,
    contactId: data.contact_id,
    companyId: data.company_id,
    expectedCloseDate: data.expected_close_date,
  }
}

export type MoveResult = {
  opportunityId: string
  version: number
  status: OpportunityStatus
  stageId: string
  secondsInPreviousStage: number
}

/**
 * Moves a deal to another stage.
 *
 * `expectedVersion` is the version the caller last SAW. If the deal has moved
 * since — because a colleague dragged the same card — this throws
 * `StaleOpportunityError` instead of overwriting their move.
 *
 * ⚠️ Do not "fix" a stale error by re-reading and retrying automatically. The
 * whole point is that a human decides what to do with a card that moved under
 * them; a silent retry is last-write-wins wearing a seatbelt.
 */
export async function moveStage(
  workspaceId: string,
  opportunityId: string,
  toStageId: string,
  expectedVersion: number,
  options: { actorUserId?: string | null; lostReason?: string } = {},
): Promise<MoveResult> {
  const { data, error } = await createAdminClient().rpc('crm_move_opportunity_stage', {
    p_workspace_id: workspaceId,
    p_opportunity_id: opportunityId,
    p_to_stage_id: toStageId,
    p_expected_version: expectedVersion,
    ...(options.actorUserId ? { p_actor_id: options.actorUserId } : {}),
    ...(options.lostReason ? { p_lost_reason: options.lostReason } : {}),
  })

  if (error) {
    if (/changed since you loaded it/i.test(error.message)) {
      throw new StaleOpportunityError(
        'Someone else moved this deal. Refresh the board to see where it is now.',
      )
    }
    throw new Error(`moveStage failed: ${error.message}`)
  }

  const result = data as unknown as {
    opportunity_id: string
    version: number
    status: OpportunityStatus
    stage_id: string
    seconds_in_previous_stage: number
  }

  return {
    opportunityId: result.opportunity_id,
    version: result.version,
    status: result.status,
    stageId: result.stage_id,
    secondsInPreviousStage: result.seconds_in_previous_stage,
  }
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

export type BoardCard = {
  id: string
  title: string
  version: number
  /** See the note on `Opportunity.valueAmount`: never sum these in JS. */
  valueAmount: number | null
  currency: string
  ownerUserId: string | null
  contactId: string | null
  updatedAt: string
  /** True when the deal has sat here longer than the stage allows. */
  isStale: boolean
}

export type BoardColumn = {
  stageId: string
  stageName: string
  kind: StageKind
  cards: BoardCard[]
  /** Total open deals in the stage, which is usually more than `cards`. */
  totalCards: number
}

/**
 * One pipeline's board.
 *
 * ⚠️ PAGINATED PER COLUMN (A6: "never load unbounded lists"). A pipeline with
 * 4,000 open deals must not send 4,000 cards to a browser; each column returns
 * its first page plus a true total, so the UI can show "142" and load more on
 * scroll.
 *
 * ⚠️ `scope` is not optional. A setter sees only their own deals
 * (`dataScope()` in lib/workspaces/permissions.ts), and a board that forgets
 * to narrow shows them the whole workspace.
 */
export async function getBoard(
  workspaceId: string,
  pipelineId: string,
  scope: { ownerUserId?: string | null } = {},
  options: { cardsPerColumn?: number } = {},
): Promise<BoardColumn[]> {
  const perColumn = Math.min(options.cardsPerColumn ?? 25, 100)
  const db = createAdminClient()

  const pipeline = await getPipeline(workspaceId, pipelineId)
  if (!pipeline) return []

  const columns: BoardColumn[] = []

  for (const stage of pipeline.stages) {
    let query = db
      .from('crm_opportunities')
      .select(
        'id, title, version, value_amount, currency, owner_user_id, contact_id, updated_at',
        { count: 'exact' },
      )
      .eq('workspace_id', workspaceId)
      .eq('pipeline_id', pipelineId)
      .eq('stage_id', stage.id)
      .eq('status', 'open')
      .is('deleted_at', null)

    if (scope.ownerUserId) query = query.eq('owner_user_id', scope.ownerUserId)

    const { data, count, error } = await query
      .order('updated_at', { ascending: false })
      .limit(perColumn)

    if (error) throw new Error(`getBoard failed: ${error.message}`)

    const staleBefore = await staleCutoff(workspaceId, stage.id)

    columns.push({
      stageId: stage.id,
      stageName: stage.name,
      kind: stage.kind,
      totalCards: count ?? 0,
      cards: (data ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        version: row.version,
        valueAmount: row.value_amount,
        currency: row.currency,
        ownerUserId: row.owner_user_id,
        contactId: row.contact_id,
        updatedAt: row.updated_at,
        isStale: staleBefore !== null && row.updated_at < staleBefore,
      })),
    })
  }

  return columns
}

/** ISO timestamp before which a card in this stage counts as rotting. */
async function staleCutoff(workspaceId: string, stageId: string): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .from('crm_pipeline_stages')
    .select('stale_after_days')
    .eq('workspace_id', workspaceId)
    .eq('id', stageId)
    .maybeSingle()

  if (error) throw new Error(`staleCutoff failed: ${error.message}`)
  if (!data?.stale_after_days) return null

  return new Date(Date.now() - data.stale_after_days * 86_400_000).toISOString()
}

/** A deal's full stage history, oldest first — the basis of every velocity metric. */
export async function getStageHistory(
  workspaceId: string,
  opportunityId: string,
): Promise<
  {
    fromStageId: string | null
    toStageId: string
    actorUserId: string | null
    ownerUserIdAtEvent: string | null
    secondsInPreviousStage: number | null
    occurredAt: string
  }[]
> {
  const { data, error } = await createAdminClient()
    .from('crm_opportunity_stage_history')
    .select('from_stage_id, to_stage_id, actor_user_id, owner_user_id_at_event, seconds_in_previous_stage, occurred_at')
    .eq('workspace_id', workspaceId)
    .eq('opportunity_id', opportunityId)
    .order('occurred_at', { ascending: true })

  if (error) throw new Error(`getStageHistory failed: ${error.message}`)

  return (data ?? []).map((row) => ({
    fromStageId: row.from_stage_id,
    toStageId: row.to_stage_id,
    actorUserId: row.actor_user_id,
    ownerUserIdAtEvent: row.owner_user_id_at_event,
    secondsInPreviousStage: row.seconds_in_previous_stage,
    occurredAt: row.occurred_at,
  }))
}
