import 'server-only'

/**
 * Deterministic CRM actions — M7 Phase 20/21.
 *
 * ⚠️ EVERY ACTION HERE COSTS ZERO CREDITS AND SAYS SO. None of them calls a
 * model, and the engine throws if one of them ever reports credits used.
 *
 * ⚠️ EACH ONE IS SCOPED BY `workspace_id` IN CODE. These run under the service
 * role, which bypasses RLS, so a flow with a mis-supplied id would otherwise
 * reach across tenants (CLAUDE.md).
 */
import { recordActivity } from '@/lib/crm/activities'
import { createOpportunity, moveStage } from '@/lib/crm/opportunities'
import { registerAction, type ActionHandler, type ActionResult } from '@/lib/flows/engine'
import { createAdminClient } from '@/lib/supabase/admin'

const ok = (output: Record<string, string | number | boolean | null> = {}): ActionResult => ({
  ok: true,
  output,
})

const fail = (code: string, message: string, retryable = false): ActionResult => ({
  ok: false,
  code,
  message,
  retryable,
})

/** Postgres unique-violation. Adding someone already on a list is not an error. */
const UNIQUE_VIOLATION = '23505'

/** Reads a required string from a step's config. */
function str(config: Record<string, unknown>, key: string): string | null {
  const value = config[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const assignOwner: ActionHandler = async (ctx, config) => {
  if (!ctx.contactId) return fail('NO_CONTACT', 'This step needs a contact to assign.')

  const userId = str(config, 'userId')
  if (!userId) return fail('NO_USER', 'This step has no person configured to assign to.')

  const db = createAdminClient()
  const { error } = await db
    .from('crm_contacts')
    .update({ owner_user_id: userId })
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', ctx.contactId)

  if (error) return fail('ASSIGN_FAILED', 'Could not assign this contact.', true)

  /*
   * ⚠️ THE ACTIVITY IS RECORDED THROUGH `recordActivity`, which freezes
   * `owner_user_id_at_event`. A flow reassigning a contact is exactly the case
   * M4 criterion 2 exists for: work done before the reassignment must stay
   * credited to whoever did it.
   */
  await recordActivity(ctx.workspaceId, {
    contactId: ctx.contactId,
    activityType: 'OWNER_ASSIGNED',
    channel: 'system',
    actorUserId: null,
    metadata: { assigned_to: userId, by: 'flow', run_id: ctx.runId },
  })

  return ok({ assignedTo: userId })
}

/**
 * Round robin across a configured list of people.
 *
 * ⚠️ ASSIGNS TO WHOEVER HAS THE FEWEST OPEN CONTACTS, not to the next name in
 * a rotating pointer. A stored pointer drifts the moment someone is added,
 * removed or on holiday, and the team notices only as an unfair split weeks
 * later. Least-loaded is self-correcting and needs no state.
 */
const roundRobin: ActionHandler = async (ctx, config) => {
  if (!ctx.contactId) return fail('NO_CONTACT', 'This step needs a contact to assign.')

  const pool = Array.isArray(config.userIds)
    ? config.userIds.filter((v): v is string => typeof v === 'string')
    : []
  if (pool.length === 0) return fail('NO_POOL', 'This step has nobody configured to assign to.')

  const db = createAdminClient()
  const counts = await Promise.all(
    pool.map(async (userId) => {
      const { count } = await db
        .from('crm_contacts')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', ctx.workspaceId)
        .eq('owner_user_id', userId)
        .is('deleted_at', null)
      return { userId, count: count ?? 0 }
    }),
  )

  // Ties break on the pool's own order, so the result is deterministic rather
  // than dependent on how the database happened to answer.
  const chosen = counts.reduce((best, row) => (row.count < best.count ? row : best), counts[0]!)

  const { error } = await db
    .from('crm_contacts')
    .update({ owner_user_id: chosen.userId })
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', ctx.contactId)

  if (error) return fail('ASSIGN_FAILED', 'Could not assign this contact.', true)

  await recordActivity(ctx.workspaceId, {
    contactId: ctx.contactId,
    activityType: 'OWNER_ASSIGNED',
    channel: 'system',
    actorUserId: null,
    metadata: { assigned_to: chosen.userId, by: 'flow_round_robin', run_id: ctx.runId },
  })

  return ok({ assignedTo: chosen.userId, openContacts: chosen.count })
}

const createTask: ActionHandler = async (ctx, config) => {
  const title = str(config, 'title')
  if (!title) return fail('NO_TITLE', 'This task step has no title.')

  const dueInHours = Number(config.dueInHours ?? 24)
  const db = createAdminClient()

  const { data, error } = await db
    .from('crm_tasks')
    .insert({
      workspace_id: ctx.workspaceId,
      contact_id: ctx.contactId,
      title,
      assigned_to_user_id: str(config, 'assignTo'),
      due_at: new Date(Date.now() + dueInHours * 3_600_000).toISOString(),
      status: 'open',
    })
    .select('id')
    .single()

  if (error) return fail('TASK_FAILED', 'Could not create the task.', true)
  return ok({ taskId: data.id })
}

const addTag: ActionHandler = async (ctx, config) => {
  if (!ctx.contactId) return fail('NO_CONTACT', 'This step needs a contact to tag.')

  const name = str(config, 'tag')
  if (!name) return fail('NO_TAG', 'This step has no tag configured.')

  const db = createAdminClient()
  // Tags are normalised so "Hot Lead" and "hot lead" cannot become two tags
  // that render identically (the rule 0071 already encodes).
  const normalized = name.toLowerCase().replace(/\s+/g, ' ').trim()

  /*
   * ⚠️ SELECT-THEN-INSERT, NOT UPSERT. `crm_tags_name_uniq` is a PARTIAL unique
   * index (`where deleted_at is null`), and `ON CONFLICT (workspace_id,
   * normalized_name)` cannot use a partial index unless the statement repeats
   * its predicate — Postgres answers "no unique or exclusion constraint
   * matching the ON CONFLICT specification" and the whole action fails.
   *
   * The insert can still lose a race with another flow tagging the same
   * contact, so a unique violation falls back to reading the winner's row
   * rather than failing.
   */
  const existing = await db
    .from('crm_tags')
    .select('id')
    .eq('workspace_id', ctx.workspaceId)
    .eq('normalized_name', normalized)
    .is('deleted_at', null)
    .maybeSingle()

  let tag = existing.data

  if (!tag) {
    const created = await db
      .from('crm_tags')
      .insert({ workspace_id: ctx.workspaceId, name, normalized_name: normalized })
      .select('id')
      .single()

    if (created.error) {
      if (created.error.code !== '23505') {
        return fail('TAG_FAILED', 'Could not create the tag.', true)
      }
      // Someone else created it between the read and the write.
      const raced = await db
        .from('crm_tags')
        .select('id')
        .eq('workspace_id', ctx.workspaceId)
        .eq('normalized_name', normalized)
        .is('deleted_at', null)
        .maybeSingle()
      if (!raced.data) return fail('TAG_FAILED', 'Could not create the tag.', true)
      tag = raced.data
    } else {
      tag = created.data
    }
  }

  const { error: linkError } = await db
    .from('crm_contact_tags')
    .upsert(
      { workspace_id: ctx.workspaceId, contact_id: ctx.contactId, tag_id: tag.id },
      // Already tagged is success, not an error — the desired state holds.
      { onConflict: 'contact_id,tag_id', ignoreDuplicates: true },
    )

  if (linkError) return fail('TAG_FAILED', 'Could not tag this contact.', true)
  return ok({ tagId: tag.id, tag: name })
}

const removeTag: ActionHandler = async (ctx, config) => {
  if (!ctx.contactId) return fail('NO_CONTACT', 'This step needs a contact.')

  const name = str(config, 'tag')
  if (!name) return fail('NO_TAG', 'This step has no tag configured.')

  const db = createAdminClient()
  const { data: tag } = await db
    .from('crm_tags')
    .select('id')
    .eq('workspace_id', ctx.workspaceId)
    .eq('normalized_name', name.toLowerCase().replace(/\s+/g, ' ').trim())
    .maybeSingle()

  // A tag that was never there is the desired end state, not a failure.
  if (!tag) return ok({ removed: false })

  await db
    .from('crm_contact_tags')
    .delete()
    .eq('workspace_id', ctx.workspaceId)
    .eq('contact_id', ctx.contactId)
    .eq('tag_id', tag.id)

  return ok({ removed: true, tag: name })
}

/**
 * ⚠️ AN ALLOWLIST, NOT AN ARBITRARY COLUMN WRITE. A flow that could set any
 * column could set `workspace_id` and move a contact into another tenant, or
 * clear `deleted_at` on an erased record.
 *
 * Written as an explicit union rather than a string set so the compiler
 * enforces it too — a dynamic `{ [field]: value }` would typecheck against
 * anything and put the whole guarantee in one runtime check.
 */
const UPDATABLE_FIELDS = ['job_title', 'headline', 'location', 'full_name'] as const
type UpdatableField = (typeof UPDATABLE_FIELDS)[number]

function isUpdatable(field: string | null): field is UpdatableField {
  return field !== null && (UPDATABLE_FIELDS as readonly string[]).includes(field)
}

const updateField: ActionHandler = async (ctx, config) => {
  if (!ctx.contactId) return fail('NO_CONTACT', 'This step needs a contact.')

  const field = str(config, 'field')
  if (!isUpdatable(field)) {
    return fail(
      'FIELD_NOT_ALLOWED',
      `"${field ?? 'that field'}" cannot be set by a flow. Allowed: ${UPDATABLE_FIELDS.join(', ')}.`,
    )
  }

  const value = config.value
  if (value !== null && typeof value !== 'string') {
    return fail('BAD_VALUE', 'That field can only be set to text, or cleared.')
  }

  // Built explicitly per field so the update object is typed, not indexed.
  const patch =
    field === 'job_title' ? { job_title: value }
    : field === 'headline' ? { headline: value }
    : field === 'location' ? { location: value }
    : { full_name: value }

  const { error } = await createAdminClient()
    .from('crm_contacts')
    .update(patch)
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', ctx.contactId)

  if (error) return fail('UPDATE_FAILED', 'Could not update this contact.', true)
  return ok({ field, updated: true })
}

const createActivityAction: ActionHandler = async (ctx, config) => {
  if (!ctx.contactId) return fail('NO_CONTACT', 'This step needs a contact.')

  const note = str(config, 'note') ?? 'Recorded by a flow.'
  await recordActivity(ctx.workspaceId, {
    contactId: ctx.contactId,
    activityType: 'ENGAGEMENT',
    channel: 'system',
    actorUserId: null,
    metadata: { note, run_id: ctx.runId },
  })

  return ok({ recorded: true })
}

/**
 * Flags a possible duplicate without merging.
 *
 * ⚠️ NEVER MERGES AUTOMATICALLY. A merge is destructive and irreversible, and
 * an automated merge on a similarity score will eventually fuse two different
 * people who share a name. The flow surfaces the candidate; a human decides.
 */
const dedupeCheck: ActionHandler = async (ctx) => {
  if (!ctx.contactId) return fail('NO_CONTACT', 'This step needs a contact.')

  const { data } = await createAdminClient()
    .from('crm_duplicate_candidates')
    .select('id, score')
    .eq('workspace_id', ctx.workspaceId)
    .or(`record_a_id.eq.${ctx.contactId},record_b_id.eq.${ctx.contactId}`)
    .order('score', { ascending: false })
    .limit(1)
    .maybeSingle()

  return ok({
    duplicateFound: Boolean(data),
    topScore: data?.score ?? 0,
  })
}


// ---------------------------------------------------------------------------
// Lists — R-follow-up
// ---------------------------------------------------------------------------

/**
 * ⚠️ THESE FOUR ACTIONS WERE OFFERED AND UNBACKED. `ADD_TO_LIST`,
 * `REMOVE_FROM_LIST`, `MOVE_STAGE` and `CREATE_OPPORTUNITY` sat in
 * `ACTION_TYPES`, appeared in the step picker and published cleanly with no
 * runner registered — so a flow using one died on its first contact with "the
 * X action is not available yet".
 */
const addToList: ActionHandler = async (ctx, config) => {
  if (!ctx.contactId) return fail('NO_CONTACT', 'This step needs a contact to add.')

  const listId = str(config, 'listId')
  if (!listId) return fail('NO_LIST', 'This step has no list configured.')

  const db = createAdminClient()

  /*
   * ⚠️ THE LIST IS VERIFIED TO BE IN THIS WORKSPACE. The id comes from a stored
   * definition, which is a claim — and the service role bypasses RLS, so
   * without this a hand-edited flow could write a member row into another
   * tenant's list.
   */
  const { data: list } = await db
    .from('crm_lists')
    .select('id')
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', listId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!list) return fail('NO_LIST', 'That list is not in this workspace.')

  const { error } = await db.from('crm_list_members').insert({
    workspace_id: ctx.workspaceId,
    list_id: listId,
    contact_id: ctx.contactId,
  })

  /*
   * ⚠️ ALREADY A MEMBER IS SUCCESS, NOT FAILURE. The primary key is
   * (list_id, contact_id), so a re-run — or a contact who genuinely qualifies
   * twice — hits a unique violation. The step's intent is "be on this list",
   * and they are.
   */
  if (error && error.code !== UNIQUE_VIOLATION) {
    return fail('ADD_FAILED', 'Could not add this contact to the list.', true)
  }

  return ok({ listId, added: error ? false : true })
}

const removeFromList: ActionHandler = async (ctx, config) => {
  if (!ctx.contactId) return fail('NO_CONTACT', 'This step needs a contact to remove.')

  const listId = str(config, 'listId')
  if (!listId) return fail('NO_LIST', 'This step has no list configured.')

  /*
   * Scoped by workspace as well as by list, for the same reason as above. A
   * delete that matches nothing is not an error: "not on this list" is the
   * state the step asks for.
   */
  const { error } = await createAdminClient()
    .from('crm_list_members')
    .delete()
    .eq('workspace_id', ctx.workspaceId)
    .eq('list_id', listId)
    .eq('contact_id', ctx.contactId)

  if (error) return fail('REMOVE_FAILED', 'Could not remove this contact from the list.', true)
  return ok({ listId, removed: true })
}

// ---------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------

const createOpportunityAction: ActionHandler = async (ctx, config) => {
  if (!ctx.contactId) return fail('NO_CONTACT', 'This step needs a contact.')

  const pipelineId = str(config, 'pipelineId')
  if (!pipelineId) return fail('NO_PIPELINE', 'This step has no pipeline configured.')

  const title = str(config, 'title')
  if (!title) return fail('NO_TITLE', 'This deal step has no name.')

  const db = createAdminClient()

  const { data: pipeline } = await db
    .from('crm_pipelines')
    .select('id')
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', pipelineId)
    .maybeSingle()

  if (!pipeline) return fail('NO_PIPELINE', 'That pipeline is not in this workspace.')

  /*
   * ⚠️ THE VALUE IS PARSED, NOT TRUSTED, AND BLANK MEANS UNKNOWN. A deal worth
   * nothing and a deal nobody has valued are different, and every forecast that
   * sums them would under-report if they were the same (CLAUDE.md rule 4).
   */
  const rawValue = config.valueAmount
  const valueAmount =
    rawValue === undefined || rawValue === null || rawValue === '' ? null : Number(rawValue)

  if (valueAmount !== null && (!Number.isFinite(valueAmount) || valueAmount < 0)) {
    return fail('BAD_VALUE', 'The deal value must be a number, or left blank.')
  }

  // The contact carries its company across, so the deal is credited to both.
  const { data: contact } = await db
    .from('crm_contacts')
    .select('primary_company_id')
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', ctx.contactId)
    .maybeSingle()

  try {
    const opportunityId = await createOpportunity(ctx.workspaceId, {
      title,
      pipelineId,
      stageId: str(config, 'stageId') ?? undefined,
      contactId: ctx.contactId,
      companyId: contact?.primary_company_id ?? null,
      /*
       * ⚠️ NO OWNER. A flow runs unattended, so there is no "current user" to
       * inherit from — and defaulting to the flow's publisher would quietly
       * hand them every deal the automation creates.
       */
      ownerUserId: null,
      valueAmount,
    })

    return ok({ opportunityId, title })
  } catch {
    return fail('CREATE_FAILED', 'Could not create that deal.', true)
  }
}

const moveStageAction: ActionHandler = async (ctx, config) => {
  if (!ctx.contactId) return fail('NO_CONTACT', 'This step needs a contact.')

  const stageId = str(config, 'stageId')
  if (!stageId) return fail('NO_STAGE', 'This step has no stage configured.')

  const db = createAdminClient()

  const { data: stage } = await db
    .from('crm_pipeline_stages')
    .select('id, pipeline_id')
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', stageId)
    .is('archived_at', null)
    .maybeSingle()

  if (!stage) return fail('NO_STAGE', 'That stage is not in this workspace.')

  /*
   * ⚠️ THE OPEN DEAL IN THAT STAGE'S OWN PIPELINE, NEWEST FIRST.
   *
   * A contact can have several deals. Moving "their deal" has to mean exactly
   * one, and moving a CLOSED deal back into an open stage would rewrite
   * history and the revenue reports that read from it. So: open only, and only
   * in the pipeline the target stage belongs to — moving a deal into a stage
   * from a different board is not a move, it is corruption.
   */
  const { data: opportunity } = await db
    .from('crm_opportunities')
    .select('id, version')
    .eq('workspace_id', ctx.workspaceId)
    .eq('contact_id', ctx.contactId)
    .eq('pipeline_id', stage.pipeline_id)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!opportunity) {
    return fail('NO_OPPORTUNITY', 'This contact has no open deal in that pipeline.')
  }

  try {
    /*
     * `moveStage` takes the version it expects and refuses a stale write, so a
     * person dragging the card at the same moment cannot be silently
     * overwritten. Retryable: the next tick re-reads the version.
     */
    await moveStage(ctx.workspaceId, opportunity.id, stageId, opportunity.version)
    return ok({ opportunityId: opportunity.id, stageId })
  } catch {
    return fail('MOVE_FAILED', 'Could not move that deal. It may have just been moved.', true)
  }
}

export function registerCrmActions(): void {
  registerAction('ASSIGN_OWNER', assignOwner)
  registerAction('ROUND_ROBIN', roundRobin)
  registerAction('CREATE_TASK', createTask)
  registerAction('ADD_TAG', addTag)
  registerAction('REMOVE_TAG', removeTag)
  registerAction('UPDATE_FIELD', updateField)
  registerAction('CREATE_ACTIVITY', createActivityAction)
  registerAction('DEDUPE_CHECK', dedupeCheck)
  registerAction('ADD_TO_LIST', addToList)
  registerAction('REMOVE_FROM_LIST', removeFromList)
  registerAction('CREATE_OPPORTUNITY', createOpportunityAction)
  registerAction('MOVE_STAGE', moveStageAction)
}
