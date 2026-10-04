import 'server-only'

/**
 * Account writes: create, edit, status, tags, assignment, delete.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  EVERY FUNCTION CHECKS ITS OWN PERMISSION AND VISIBILITY.                ║
 * ║                                                                          ║
 * ║  Server actions call these, and a server action is a public HTTP         ║
 * ║  endpoint. So the check lives HERE, next to the write, not in a caller   ║
 * ║  that a second caller might skip (CLAUDE.md rule 8). An employee with    ║
 * ║  only `accounts.edit_tags` can change tags and is refused field edits by ║
 * ║  ICPs by the same code path the UI uses.                                 ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Expected outcomes a person can act on — "this account already exists",
 * "possible duplicate", a field that does not parse — are RETURNED as a typed
 * result for the form to render. Only refusals and faults THROW (AppError).
 *
 * Multi-statement changes (tags, status, assignment) run as single SQL
 * functions (0147, 0150), so each change and its history commit together.
 */
import { z } from 'zod'

import {
  assertCanSeeAccount,
  canSeeAccount,
  requirePermissionFor,
  type AccountAccess,
} from '@/lib/crm/account-access'
import { ACCOUNT_PRIORITIES } from '@/lib/crm/account-filters'
import { addNote, recordAudit } from '@/lib/crm/activities'
import {
  findCrmCompanyMatches,
  resolveCrmCompanyIdentity,
  type CompanyInput,
  type CompanyMatch,
} from '@/lib/crm/repository'
import { AppError } from '@/lib/errors/catalog'
import { normalizeCompanyLinkedInUrl, normalizeDomain } from '@/lib/companies/normalize'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database, Json } from '@/types/database'

const UNIQUE_VIOLATION = '23505'
/** `raise ... using errcode = 'check_violation'` in 0147/0150: the caller's mistake. */
const CHECK_VIOLATION = '23514'
/** `using errcode = 'no_data_found'`: no such account in this workspace. */
const NO_DATA_FOUND = 'P0002'

const requirePermission = requirePermissionFor

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()

const uuid = z.string().uuid()

/** Fields a person edits. `undefined` = leave alone; `null` = clear. */
export const accountFieldsSchema = z.object({
  name: z.string().trim().min(1, 'Company name is required').max(200).optional(),
  websiteUrl: optionalText(500),
  linkedInUrl: optionalText(500),
  salesNavigatorUrl: optionalText(500),
  location: optionalText(200),
  employeeCount: z.number().int().min(0).max(10_000_000).nullable().optional(),
  employeeCountRange: optionalText(40),
  summary: optionalText(5000),
  priority: z.enum(ACCOUNT_PRIORITIES).nullable().optional(),
})

export type AccountFields = z.infer<typeof accountFieldsSchema>

/** One tag group's values for an account: replace semantics. */
export const groupTagsSchema = z.object({
  groupId: uuid,
  primaryId: uuid.nullable().optional(),
  tagIds: z.array(uuid).max(50),
})

export type GroupTags = z.infer<typeof groupTagsSchema>

export const createAccountSchema = accountFieldsSchema.extend({
  name: z.string().trim().min(1, 'Company name is required').max(200),
  statusId: uuid.optional(),
  /** One entry per tag group the form touched: its values, and its primary if the group has one. */
  tags: z.array(groupTagsSchema).max(30).default([]),
  assigneeUserId: uuid.optional(),
  /** Set after the person saw the possible-duplicate list and chose to continue. */
  confirmPossibleDuplicate: z.boolean().default(false),
})

export type CreateAccountInput = z.input<typeof createAccountSchema>

export type FieldErrors = Partial<
  Record<keyof AccountFields | 'tags' | 'statusId' | 'assigneeUserId', string>
>

/**
 * URLs a person typed must PARSE, or the save is refused with a message. A
 * value that silently fails to normalize would be stored for display and
 * never matched on — the half-identity `fillCompanyGaps` warns about.
 */
function urlErrors(fields: AccountFields): FieldErrors {
  const errors: FieldErrors = {}
  if (fields.websiteUrl && !normalizeDomain(fields.websiteUrl)) {
    errors.websiteUrl = 'Enter a company website, like example.com'
  }
  if (fields.linkedInUrl) {
    const n = normalizeCompanyLinkedInUrl(fields.linkedInUrl)
    if (!n || n.includes('/sales/')) {
      errors.linkedInUrl = 'Enter a LinkedIn company page, like linkedin.com/company/acme'
    }
  }
  if (fields.salesNavigatorUrl) {
    const n = normalizeCompanyLinkedInUrl(fields.salesNavigatorUrl)
    if (!n || !n.includes('/sales/company/')) {
      errors.salesNavigatorUrl = 'Enter a Sales Navigator company URL, like linkedin.com/sales/company/1234'
    }
  }
  return errors
}

function zodErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {}
  for (const issue of error.issues) {
    const key = issue.path[0]
    if (typeof key === 'string' && !(key in out)) out[key as keyof FieldErrors] = issue.message
  }
  return out
}

// ---------------------------------------------------------------------------
// Duplicate outcomes
// ---------------------------------------------------------------------------

/**
 * An existing account, described only as far as this member may see it.
 *
 * ⚠️ AN EMPLOYEE WITH `accounts.create` BUT NOT `view_all` must not learn the
 * name of an account assigned to someone else by trying to create it. They are
 * told it exists — they need to know that — but get no id and no name.
 */
export type ExistingAccount = { id: string; name: string | null } | { hidden: true }

async function describe(access: AccountAccess, match: CompanyMatch): Promise<ExistingAccount> {
  return (await canSeeAccount(access, match.id))
    ? { id: match.id, name: match.name }
    : { hidden: true }
}

export type AccountWriteResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'invalid'; fieldErrors: FieldErrors }
  | { ok: false; reason: 'duplicate'; existing: ExistingAccount; matchedBy: CompanyMatch['matchedBy'] }
  | { ok: false; reason: 'conflict'; existing: ExistingAccount[] }
  | {
      ok: false
      reason: 'possible_duplicate'
      candidates: ExistingAccount[]
      /** The database will refuse this one; confirming cannot help. */
      blocking: boolean
    }

function identityInput(fields: AccountFields, name: string | null): CompanyInput {
  return {
    name,
    websiteUrl: fields.websiteUrl ?? null,
    linkedInUrl: fields.linkedInUrl ?? null,
    salesNavigatorUrl: fields.salesNavigatorUrl ?? null,
  }
}

async function duplicateCheck(
  access: AccountAccess,
  input: CompanyInput,
  options: { exclude?: string; confirmPossible: boolean },
): Promise<Exclude<AccountWriteResult, { ok: true } | { reason: 'invalid' }> | null> {
  const report = await findCrmCompanyMatches(access.ctx.workspace.id, input)
  const exact = report.exact.filter((m) => m.id !== options.exclude)
  const possible = report.possible.filter((m) => m.id !== options.exclude)

  if (exact.length > 1) {
    return { ok: false, reason: 'conflict', existing: await Promise.all(exact.map((m) => describe(access, m))) }
  }
  if (exact.length === 1) {
    return {
      ok: false,
      reason: 'duplicate',
      existing: await describe(access, exact[0]!),
      matchedBy: exact[0]!.matchedBy,
    }
  }

  if (possible.length > 0) {
    const identity = resolveCrmCompanyIdentity(input)
    const inputIsNameOnly =
      !identity.normalizedDomain && !identity.normalizedLinkedInUrl && !identity.normalizedSalesNavigatorUrl
    const blocking = inputIsNameOnly && possible.some((m) => !m.hasStrongIdentity)
    if (blocking || !options.confirmPossible) {
      return {
        ok: false,
        reason: 'possible_duplicate',
        candidates: await Promise.all(possible.map((m) => describe(access, m))),
        blocking,
      }
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

type CompanyRow = Database['public']['Tables']['crm_companies']['Insert']

/** Only the columns `fields` mentions; `undefined` leaves a column untouched. */
function columnsFor(fields: AccountFields): Partial<CompanyRow> {
  const identity = resolveCrmCompanyIdentity(identityInput(fields, fields.name ?? null))
  const out: Partial<CompanyRow> = {}
  if (fields.name !== undefined) {
    out.name = identity.name
    out.normalized_name = identity.normalizedName
  }
  if (fields.websiteUrl !== undefined) {
    out.domain = identity.domain
    out.normalized_domain = identity.normalizedDomain
  }
  if (fields.linkedInUrl !== undefined) {
    out.linkedin_url = identity.linkedInUrl
    out.normalized_linkedin_url = identity.normalizedLinkedInUrl
  }
  if (fields.salesNavigatorUrl !== undefined) {
    out.sales_navigator_url = identity.salesNavigatorUrl
    out.normalized_sales_navigator_url = identity.normalizedSalesNavigatorUrl
  }
  if (fields.location !== undefined) out.headquarters = fields.location
  if (fields.employeeCount !== undefined) out.employee_count = fields.employeeCount
  if (fields.employeeCountRange !== undefined) out.employee_count_range = fields.employeeCountRange
  if (fields.summary !== undefined) out.summary = fields.summary
  if (fields.priority !== undefined) out.priority = fields.priority
  return out
}

export async function createAccount(access: AccountAccess, raw: unknown): Promise<AccountWriteResult> {
  requirePermission(access, 'accounts.create')

  const parsed = createAccountSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, reason: 'invalid', fieldErrors: zodErrors(parsed.error) }
  const input = parsed.data

  if (input.assigneeUserId && input.assigneeUserId !== access.ctx.userId) {
    requirePermission(access, 'accounts.assign')
  }

  const errors = urlErrors(input)
  /*
   * ⚠️ EVERYTHING THE LATER STEPS WILL CHECK IS CHECKED HERE, BEFORE THE ROW
   * EXISTS. Create is several calls (row, tags, source, assignment), and a
   * refusal from step three used to leave the row behind — unassigned, so a
   * creator without view_all could neither see it nor retry it: the retry was
   * told "this already exists" about an account they could never open.
   */
  const workspaceId = access.ctx.workspace.id
  const [statusOk, tagsProblem, assigneeOk] = await Promise.all([
    input.statusId ? isActiveStatus(workspaceId, input.statusId) : true,
    tagProblem(workspaceId, input.tags),
    input.assigneeUserId ? isMember(workspaceId, input.assigneeUserId) : true,
  ])
  if (!statusOk) errors.statusId = 'Choose an available status'
  if (tagsProblem) errors.tags = tagsProblem
  if (!assigneeOk) errors.assigneeUserId = 'That person is not in this workspace'
  if (Object.keys(errors).length > 0) return { ok: false, reason: 'invalid', fieldErrors: errors }

  const duplicate = await duplicateCheck(access, identityInput(input, input.name), {
    confirmPossible: input.confirmPossibleDuplicate,
  })
  if (duplicate) return duplicate

  const db = createAdminClient()

  const { data, error } = await db
    .from('crm_companies')
    .insert({
      ...columnsFor(input),
      workspace_id: workspaceId,
      source: 'manual',
      created_by: access.ctx.userId,
      ...(input.statusId ? { status_id: input.statusId } : {}),
    } as CompanyRow)
    .select('id')
    .single()

  if (error) {
    // Two people saving the same company at once: the index is the arbiter.
    if (error.code === UNIQUE_VIOLATION) {
      const again = await duplicateCheck(access, identityInput(input, input.name), { confirmPossible: false })
      if (again) return again
    }
    throw new Error(`createAccount failed: ${error.message}`)
  }

  const id = data.id

  try {
    /*
     * ⚠️ WHO CAN SEE WHAT THEY JUST CREATED, AND IT GOES FIRST. An employee
     * granted `create` but not `view_all` sees only assigned accounts, so an
     * unassigned new account would vanish from their list on save. Assigning
     * before anything else can fail means that, whatever happens next, the
     * creator can still open what they made.
     */
    const assignee = input.assigneeUserId ?? (access.viewAll ? null : access.ctx.userId)
    if (assignee) await assignUnchecked(access, id, assignee, 'replace')

    for (const group of input.tags) {
      if (group.tagIds.length === 0 && !group.primaryId) continue
      await setGroupTagsUnchecked(access, id, group, { merge: false, source: 'manual' })
    }

    await recordSource(access, id, 'manual', null, {
      entered: {
        name: input.name,
        websiteUrl: input.websiteUrl ?? null,
        linkedInUrl: input.linkedInUrl ?? null,
        salesNavigatorUrl: input.salesNavigatorUrl ?? null,
        location: input.location ?? null,
      },
    })
  } catch (failure) {
    /*
     * A half-made account is worse than none: it blocks the retry as a
     * "duplicate". Soft-deleted, so the person can simply save again — and
     * the row, with whatever history it gathered, stays for support.
     */
    await db
      .from('crm_companies')
      .update({ deleted_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
    throw failure
  }

  await recordAudit(workspaceId, {
    action: 'crm.account.created',
    targetType: 'crm_company',
    targetId: id,
    actorUserId: access.ctx.userId,
    after: { name: input.name },
  })

  return { ok: true, id }
}

// ---------------------------------------------------------------------------
// Edit fields
// ---------------------------------------------------------------------------

export async function updateAccount(
  access: AccountAccess,
  companyId: string,
  raw: unknown,
): Promise<AccountWriteResult> {
  requirePermission(access, 'accounts.edit')
  await assertCanSeeAccount(access, companyId)

  const parsed = accountFieldsSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, reason: 'invalid', fieldErrors: zodErrors(parsed.error) }
  const fields = parsed.data

  const errors = urlErrors(fields)
  if (Object.keys(errors).length > 0) return { ok: false, reason: 'invalid', fieldErrors: errors }

  const workspaceId = access.ctx.workspace.id
  const db = createAdminClient()

  const { data: current, error: readError } = await db
    .from('crm_companies')
    .select('name, domain, linkedin_url, sales_navigator_url, headquarters, employee_count, employee_count_range, summary, priority')
    .eq('workspace_id', workspaceId)
    .eq('id', companyId)
    .single()
  if (readError) throw new Error(`updateAccount failed: ${readError.message}`)

  const identityChanged =
    fields.name !== undefined || fields.websiteUrl !== undefined
    || fields.linkedInUrl !== undefined || fields.salesNavigatorUrl !== undefined

  // The identity AFTER the edit: changed fields from the input, the rest as stored.
  const after = identityInput(
    {
      websiteUrl: fields.websiteUrl !== undefined ? fields.websiteUrl : current.domain,
      linkedInUrl: fields.linkedInUrl !== undefined ? fields.linkedInUrl : current.linkedin_url,
      salesNavigatorUrl:
        fields.salesNavigatorUrl !== undefined ? fields.salesNavigatorUrl : current.sales_navigator_url,
    },
    fields.name ?? current.name,
  )

  if (identityChanged) {
    const duplicate = await duplicateCheck(
      access,
      after,
      // Renaming an account is not "creating a possible duplicate"; only a
      // certain match or the database's own refusal stops an edit.
      { exclude: companyId, confirmPossible: true },
    )
    if (duplicate) return duplicate
  }

  const patch = columnsFor(fields)
  if (Object.keys(patch).length === 0) return { ok: true, id: companyId }

  const { error } = await db
    .from('crm_companies')
    .update(patch)
    .eq('workspace_id', workspaceId)
    .eq('id', companyId)

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      const again = await duplicateCheck(access, after, { exclude: companyId, confirmPossible: false })
      if (again) return again
    }
    throw new Error(`updateAccount failed: ${error.message}`)
  }

  const before: Record<string, unknown> = {}
  const changed: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (key.startsWith('normalized_')) continue
    before[key] = (current as Record<string, unknown>)[key] ?? null
    changed[key] = value
  }

  await recordAudit(workspaceId, {
    action: 'crm.account.updated',
    targetType: 'crm_company',
    targetId: companyId,
    actorUserId: access.ctx.userId,
    before,
    after: changed,
  })

  return { ok: true, id: companyId }
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export async function setAccountStatus(
  access: AccountAccess,
  companyId: string,
  statusId: string,
): Promise<{ changed: boolean }> {
  requirePermission(access, 'accounts.edit')
  if (!uuid.safeParse(statusId).success) throw new AppError('ERR_VALIDATION', 'status id')
  await assertCanSeeAccount(access, companyId)

  const { data, error } = await createAdminClient().rpc('crm_set_company_status', {
    p_workspace_id: access.ctx.workspace.id,
    p_company_id: companyId,
    p_status_id: statusId,
    p_actor_id: access.ctx.userId,
  })
  if (error) throw rpcError('setAccountStatus', error)
  return { changed: Boolean((data as { changed?: boolean } | null)?.changed) }
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/**
 * One group's values on an account — replace semantics, in one transaction
 * with its activity (0153 `crm_set_company_tags`). Requires `accounts.edit_tags`.
 */
export async function setAccountTags(
  access: AccountAccess,
  companyId: string,
  raw: unknown,
): Promise<{ changed: boolean }> {
  requirePermission(access, 'accounts.edit_tags')
  const parsed = groupTagsSchema.safeParse(raw)
  if (!parsed.success) throw new AppError('ERR_VALIDATION', 'tags')
  await assertCanSeeAccount(access, companyId)
  const problem = await tagProblem(access.ctx.workspace.id, [parsed.data], { allowInactive: true })
  if (problem) throw new AppError('ERR_VALIDATION', problem)
  return setGroupTagsUnchecked(access, companyId, parsed.data, { merge: false, source: 'manual' })
}

/**
 * Adds ONE value without touching the others — the bulk "Add tag" action.
 * Merge mode: in a group with a primary it becomes primary only when the
 * account had no value in that group.
 */
export async function addAccountTag(
  access: AccountAccess,
  companyId: string,
  tagId: string,
): Promise<{ changed: boolean }> {
  requirePermission(access, 'accounts.edit_tags')
  if (!uuid.safeParse(tagId).success) throw new AppError('ERR_VALIDATION', 'tag id')
  await assertCanSeeAccount(access, companyId)

  const { data: tag, error } = await createAdminClient()
    .from('crm_tags')
    .select('group_id')
    .eq('workspace_id', access.ctx.workspace.id)
    .eq('id', tagId)
    .eq('entity', 'company')
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(`addAccountTag failed: ${error.message}`)
  if (!tag?.group_id) throw new AppError('ERR_VALIDATION', 'tag id')
  const problem = await tagProblem(access.ctx.workspace.id, [{ groupId: tag.group_id, primaryId: tagId, tagIds: [] }])
  if (problem) throw new AppError('ERR_VALIDATION', problem)

  return setGroupTagsUnchecked(
    access,
    companyId,
    { groupId: tag.group_id, primaryId: tagId, tagIds: [] },
    { merge: true, source: 'manual' },
  )
}

/*
 * The `Unchecked` writer skips the permission and visibility checks and is NOT
 * exported: it exists for this module's create path and for the import (build
 * step 5), whose callers check `accounts.import` themselves.
 */
async function setGroupTagsUnchecked(
  access: AccountAccess,
  companyId: string,
  group: GroupTags,
  options: { merge: boolean; source: 'manual' | 'import' },
): Promise<{ changed: boolean }> {
  const { data, error } = await createAdminClient().rpc('crm_set_company_tags', {
    p_workspace_id: access.ctx.workspace.id,
    p_company_id: companyId,
    p_group_id: group.groupId,
    p_primary: (group.primaryId ?? null) as string,
    p_tag_ids: group.tagIds,
    p_actor_id: access.ctx.userId,
    p_merge: options.merge,
    p_source: options.source,
  })
  if (error) throw rpcError('setAccountTags', error)
  return { changed: Boolean((data as { changed?: boolean } | null)?.changed) }
}

/**
 * Why these group values cannot be saved, or null. Checked BEFORE a write, so
 * a person gets a sentence instead of a half-made account:
 *   - the group is an enabled account group of this workspace;
 *   - every value belongs to THAT group, and is enabled (an edit may keep a
 *     disabled value already on the account — the SQL refuses only ADDING one);
 *   - in a group with a primary, a set with values names a primary from it.
 */
async function tagProblem(
  workspaceId: string,
  groups: GroupTags[],
  options: { allowInactive?: boolean } = {},
): Promise<string | null> {
  const touched = groups.filter((g) => g.tagIds.length > 0 || g.primaryId)
  if (touched.length === 0) return null
  if (new Set(touched.map((g) => g.groupId)).size !== touched.length) return 'A tag group appears twice.'

  const db = createAdminClient()
  const ids = [...new Set(touched.flatMap((g) => [...g.tagIds, ...(g.primaryId ? [g.primaryId] : [])]))]
  const [groupRows, tagRows] = await Promise.all([
    db
      .from('crm_tag_groups')
      .select('id, name, has_primary, is_active')
      .eq('workspace_id', workspaceId)
      .eq('entity', 'company')
      .in('id', touched.map((g) => g.groupId)),
    db
      .from('crm_tags')
      .select('id, group_id, is_active')
      .eq('workspace_id', workspaceId)
      .eq('entity', 'company')
      .is('deleted_at', null)
      .in('id', ids),
  ])
  if (groupRows.error) throw new Error(`tagProblem failed: ${groupRows.error.message}`)
  if (tagRows.error) throw new Error(`tagProblem failed: ${tagRows.error.message}`)

  const groupById = new Map((groupRows.data ?? []).map((g) => [g.id, g]))
  const tagById = new Map((tagRows.data ?? []).map((t) => [t.id, t]))

  for (const g of touched) {
    const group = groupById.get(g.groupId)
    if (!group) return 'One of the tag groups no longer exists. Refresh and try again.'
    // A disabled group is read-only everywhere: its chips are hidden, so a
    // value added now would filter lists for a reason nobody can see.
    if (!group.is_active) return `${group.name} is disabled. Enable it in Settings → Tags first.`
    const values = [...g.tagIds, ...(g.primaryId ? [g.primaryId] : [])]
    for (const id of values) {
      const tag = tagById.get(id)
      if (!tag || tag.group_id !== g.groupId) return `A value in ${group.name} no longer exists. Refresh and try again.`
      if (!tag.is_active && !options.allowInactive) return `A value in ${group.name} is disabled.`
    }
    if (group.has_primary && values.length > 0 && !g.primaryId) return `Choose which ${group.name} value is primary.`
  }
  return null
}

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

/**
 * `replace` makes `userId` the only assignee; `add` joins them when the
 * workspace allows several (crm_account_settings.allow_multiple_assignees).
 */
export async function assignAccount(
  access: AccountAccess,
  companyId: string,
  userId: string,
  mode: 'replace' | 'add' = 'replace',
): Promise<{ changed: boolean }> {
  requirePermission(access, 'accounts.assign')
  if (!uuid.safeParse(userId).success) throw new AppError('ERR_VALIDATION', 'assignee id')
  await assertCanSeeAccount(access, companyId)
  return assignUnchecked(access, companyId, userId, mode)
}

async function assignUnchecked(
  access: AccountAccess,
  companyId: string,
  userId: string,
  mode: 'replace' | 'add',
): Promise<{ changed: boolean }> {
  const { data, error } = await createAdminClient().rpc('crm_assign_company', {
    p_workspace_id: access.ctx.workspace.id,
    p_company_id: companyId,
    p_user_id: userId,
    p_actor_id: access.ctx.userId,
    p_mode: mode,
  })
  if (error) throw rpcError('assignAccount', error)
  return { changed: Boolean((data as { changed?: boolean } | null)?.changed) }
}

/** `userId` omitted removes every assignee. */
export async function unassignAccount(
  access: AccountAccess,
  companyId: string,
  userId?: string,
): Promise<{ changed: boolean }> {
  requirePermission(access, 'accounts.assign')
  if (userId !== undefined && !uuid.safeParse(userId).success) {
    throw new AppError('ERR_VALIDATION', 'assignee id')
  }
  await assertCanSeeAccount(access, companyId)

  const { data, error } = await createAdminClient().rpc('crm_unassign_company', {
    p_workspace_id: access.ctx.workspace.id,
    p_company_id: companyId,
    p_user_id: userId as string,
    p_actor_id: access.ctx.userId,
  })
  if (error) throw rpcError('unassignAccount', error)
  return { changed: Boolean((data as { changed?: boolean } | null)?.changed) }
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

/**
 * A research note on the account. Uses the CRM's one notes table and its
 * NOTE_ADDED activity (0075) — there is no second notes system for accounts.
 */
export async function addAccountNote(
  access: AccountAccess,
  companyId: string,
  body: unknown,
): Promise<string> {
  requirePermission(access, 'accounts.edit')
  const parsed = z.string().trim().min(1).max(5000).safeParse(body)
  if (!parsed.success) throw new AppError('ERR_VALIDATION', 'note body')
  await assertCanSeeAccount(access, companyId)
  return addNote(access.ctx.workspace.id, { companyId, body: parsed.data }, access.ctx.userId)
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * SOFT delete, as everywhere in the CRM (0071): hard delete is reserved for
 * GDPR erasure. The leads stay, still linked; they are simply not shown under
 * an account nobody can open.
 */
export async function deleteAccount(access: AccountAccess, companyId: string): Promise<void> {
  requirePermission(access, 'accounts.delete')
  await assertCanSeeAccount(access, companyId)

  const workspaceId = access.ctx.workspace.id
  const { data, error } = await createAdminClient()
    .from('crm_companies')
    .update({ deleted_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('id', companyId)
    .is('deleted_at', null)
    .select('name')
    .maybeSingle()
  if (error) throw new Error(`deleteAccount failed: ${error.message}`)
  if (!data) return

  await recordAudit(workspaceId, {
    action: 'crm.account.deleted',
    targetType: 'crm_company',
    targetId: companyId,
    actorUserId: access.ctx.userId,
    before: { name: data.name },
  })
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function recordSource(
  access: AccountAccess,
  companyId: string,
  sourceType: 'manual' | 'url' | 'spreadsheet_row' | 'html_upload' | 'extension',
  url: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await createAdminClient().from('crm_company_sources').insert({
    workspace_id: access.ctx.workspace.id,
    company_id: companyId,
    source_type: sourceType,
    url,
    raw_payload: payload as Json,
    imported_by: access.ctx.userId,
  })
  if (error) throw new Error(`recordSource failed: ${error.message}`)
}

/**
 * A refusal the SQL raised on purpose (an unknown or disabled value, a second
 * assignee while that is off, a non-member) is the CALLER's mistake and maps
 * to ERR_VALIDATION; anything else is a fault. Neither message reaches the user.
 */
/**
 * ⚠️ ONLY OUR OWN REFUSALS. 23514 is also what any table CHECK raises, and a
 * genuine constraint failure inside a function is a fault, not the caller's
 * mistake. The functions in 0147/0150 prefix their messages with their own
 * name; the 0147 assignment guard says "already has an active assignee".
 */
function isOwnRefusal(message: string): boolean {
  return /^crm_[a-z_]+: /.test(message) || message.includes('already has an active assignee')
}

function rpcError(where: string, error: { code?: string; message: string }): Error {
  if (error.code === CHECK_VIOLATION && isOwnRefusal(error.message)) {
    return new AppError('ERR_VALIDATION', `${where}: ${error.message}`)
  }
  if (error.code === NO_DATA_FOUND) return new AppError('ERR_NOT_FOUND', `${where}: ${error.message}`)
  return new Error(`${where} failed: ${error.message}`)
}

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from('workspace_memberships')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(`isMember failed: ${error.message}`)
  return Boolean(data)
}

async function isActiveStatus(workspaceId: string, statusId: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from('crm_account_statuses')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('id', statusId)
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw new Error(`isActiveStatus failed: ${error.message}`)
  return Boolean(data)
}
