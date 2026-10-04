import 'server-only'

/**
 * Account reads: the vocabulary, the list, its chip counts, and one account.
 *
 * ⚠️ EVERY READ TAKES AN `AccountAccess`, NOT A WORKSPACE ID. Visibility
 * ("only my accounts unless view_all") travels with it into the SQL
 * (`crm_list_accounts` / `crm_account_facets`, 0150) and into
 * `assertCanSeeAccount`, so there is no read here a caller can make without
 * the rule applied.
 *
 * Labels (tag names, status, assignee names) are resolved here
 * from small per-workspace lists rather than joined in SQL, so a rename is
 * visible on the next render and the list query stays narrow.
 */
import { assertCanSeeAccount, type AccountAccess } from '@/lib/crm/account-access'
import {
  ACCOUNT_PAGE_SIZE,
  toAccountRpcFilters,
  type AccountQuery,
} from '@/lib/crm/account-filters'
import { listAssignableMembers } from '@/lib/crm/contacts-list'
import { listTagGroups, type TagGroup } from '@/lib/crm/tag-groups'
import { AppError } from '@/lib/errors/catalog'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/types/database'

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export type AccountStatus = {
  id: string
  name: string
  slug: string
  systemKey: 'new' | 'assigned' | null
  isActive: boolean
}

export type AccountVocabulary = {
  /**
   * The workspace's ACCOUNT tag groups (0153), each with every value — active
   * or not, because a disabled value still on an account needs its label.
   */
  groups: TagGroup[]
  statuses: AccountStatus[]
}

export async function loadAccountVocabulary(workspaceId: string): Promise<AccountVocabulary> {
  const [groups, statuses] = await Promise.all([
    listTagGroups(workspaceId, 'company'),
    createAdminClient()
      .from('crm_account_statuses')
      .select('id, name, slug, system_key, is_active')
      .eq('workspace_id', workspaceId)
      .order('sort_order')
      .order('name'),
  ])
  if (statuses.error) throw new Error(`loadAccountVocabulary failed: ${statuses.error.message}`)

  return {
    groups,
    statuses: (statuses.data ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      systemKey: r.system_key === 'new' || r.system_key === 'assigned' ? r.system_key : null,
      isActive: r.is_active,
    })),
  }
}

/** Groups that render a chip row and a column: active ones, in order. */
export function activeGroups(vocab: AccountVocabulary): TagGroup[] {
  return vocab.groups.filter((g) => g.isActive)
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

export type AccountTag = {
  id: string
  groupId: string
  label: string
  /** The value's description when it has one (e.g. a product's full name). */
  title: string
  primary: boolean
  isActive: boolean
  /** Who put it there: a person, an import, or (Phase D) a rule or the AI. */
  source: 'manual' | 'import' | 'rule' | 'ai'
}
export type Person = { userId: string; name: string }

export type AccountListRow = {
  id: string
  name: string | null
  /** Every tag, primary first within its group. Group by `groupId` to render. */
  tags: AccountTag[]
  assignees: Person[]
  status: { id: string; name: string } | null
  priority: string | null
  leadCount: number
  location: string | null
  employeeCount: number | null
  employeeCountRange: string | null
  lastActivityAt: string | null
  source: string
  domain: string | null
  linkedInUrl: string | null
  salesNavigatorUrl: string | null
}

export type AccountListPage = {
  rows: AccountListRow[]
  total: number
  page: number
  pageSize: number
}

type ListRow = {
  id: string
  name: string | null
  domain: string | null
  linkedin_url: string | null
  sales_navigator_url: string | null
  headquarters: string | null
  employee_count: number | null
  employee_count_range: string | null
  priority: string | null
  status_id: string | null
  source: string
  last_activity_at: string | null
  lead_count: number
  tags: Json
  assignee_ids: string[] | null
  total_count: number
}

function rpcArgs(access: AccountAccess, query: AccountQuery, vocab: AccountVocabulary) {
  const groups = new Map(
    vocab.groups.map((g) => [g.slug, new Map(g.values.map((v) => [v.slug, v.id]))] as const),
  )
  return {
    p_workspace_id: access.ctx.workspace.id,
    p_viewer: access.ctx.userId,
    p_view_all: access.viewAll,
    p_filters: toAccountRpcFilters(
      query,
      { groups, statuses: new Map(vocab.statuses.map((s) => [s.slug, s.id])) },
      { userId: access.ctx.userId, viewAll: access.viewAll },
    ) as unknown as Json,
  }
}

export async function listAccounts(
  access: AccountAccess,
  query: AccountQuery,
  vocab: AccountVocabulary,
  members: Person[],
): Promise<AccountListPage> {
  const pageSize = ACCOUNT_PAGE_SIZE
  const { data, error } = await createAdminClient().rpc('crm_list_accounts', {
    ...rpcArgs(access, query, vocab),
    p_sort: query.sort,
    p_desc: query.desc,
    p_limit: pageSize,
    p_offset: (query.page - 1) * pageSize,
  })
  if (error) throw new Error(`listAccounts failed: ${error.message}`)

  const rows = (data ?? []) as unknown as ListRow[]
  return {
    rows: rows.map((row) => toListRow(row, vocab, members)),
    total: rows[0]?.total_count ?? 0,
    page: query.page,
    pageSize,
  }
}

const SOURCES = new Set(['manual', 'import', 'rule', 'ai'])

function toListRow(row: ListRow, vocab: AccountVocabulary, members: Person[]): AccountListRow {
  const valueById = new Map(vocab.groups.flatMap((g) => g.values.map((v) => [v.id, v] as const)))
  const memberById = new Map(members.map((m) => [m.userId, m]))
  const status = vocab.statuses.find((s) => s.id === row.status_id)
  const raw = Array.isArray(row.tags)
    ? (row.tags as { id: string; group_id: string; primary: boolean; source: string }[])
    : []

  return {
    id: row.id,
    name: row.name,
    tags: raw.flatMap((t) => {
      const value = valueById.get(t.id)
      if (!value) return []
      return [
        {
          id: value.id,
          groupId: t.group_id,
          label: value.name,
          title: value.description ?? value.name,
          primary: t.primary,
          isActive: value.isActive,
          source: (SOURCES.has(t.source) ? t.source : 'manual') as AccountTag['source'],
        },
      ]
    }),
    // A member who left still has closed history, never an open assignment
    // (0147), so an unknown id here is a race with removal — shown, not dropped.
    assignees: (row.assignee_ids ?? []).map((id) => memberById.get(id) ?? { userId: id, name: 'Former member' }),
    status: status ? { id: status.id, name: status.name } : null,
    priority: row.priority,
    leadCount: Number(row.lead_count),
    location: row.headquarters,
    employeeCount: row.employee_count,
    employeeCountRange: row.employee_count_range,
    lastActivityAt: row.last_activity_at,
    source: row.source,
    domain: row.domain,
    linkedInUrl: row.linkedin_url,
    salesNavigatorUrl: row.sales_navigator_url,
  }
}

/** One group's tags on a row, primary first — what a table cell renders. */
export function tagsIn(row: Pick<AccountListRow, 'tags'>, groupId: string): AccountTag[] {
  return row.tags.filter((t) => t.groupId === groupId)
}

// ---------------------------------------------------------------------------
// Chip counts
// ---------------------------------------------------------------------------

/**
 * group id → its counts. `total` is the group's "All" chip: accounts matching
 * every OTHER active filter. A group with no matching account is absent and
 * reads as zero.
 */
export type AccountFacets = Map<string, { total: number; byValue: Map<string, number> }>

export async function accountFacets(
  access: AccountAccess,
  query: AccountQuery,
  vocab: AccountVocabulary,
): Promise<AccountFacets> {
  const { data, error } = await createAdminClient().rpc('crm_account_facets', rpcArgs(access, query, vocab))
  if (error) throw new Error(`accountFacets failed: ${error.message}`)

  const out: AccountFacets = new Map()
  for (const row of data ?? []) {
    const entry = out.get(row.group_id) ?? { total: 0, byValue: new Map<string, number>() }
    const n = Number(row.account_count)
    if (row.tag_id) entry.byValue.set(row.tag_id, n)
    else entry.total = n
    out.set(row.group_id, entry)
  }
  return out
}

// ---------------------------------------------------------------------------
// One account
// ---------------------------------------------------------------------------

export type AccountDetail = AccountListRow & {
  summary: string | null
  industry: string | null
  ownerUserId: string | null
  createdBy: string | null
  createdAt: string
  sourceCompanyId: string | null
}

/** Throws ERR_NOT_FOUND for an id this member may not see — never ERR_FORBIDDEN. */
export async function getAccount(
  access: AccountAccess,
  companyId: string,
  vocab: AccountVocabulary,
): Promise<AccountDetail> {
  await assertCanSeeAccount(access, companyId)

  const workspaceId = access.ctx.workspace.id
  const db = createAdminClient()

  const [company, tags, assignments, leads, members] = await Promise.all([
    db
      .from('crm_companies')
      .select(
        'id, name, domain, linkedin_url, sales_navigator_url, headquarters, employee_count, employee_count_range, priority, status_id, source, last_activity_at, summary, industry, owner_user_id, created_by, created_at, source_company_id',
      )
      .eq('workspace_id', workspaceId)
      .eq('id', companyId)
      .is('deleted_at', null)
      .maybeSingle(),
    db
      .from('crm_company_tags')
      .select('tag_id, group_id, is_primary, source, created_at')
      .eq('workspace_id', workspaceId)
      .eq('company_id', companyId)
      .order('is_primary', { ascending: false })
      .order('created_at'),
    db
      .from('crm_company_assignments')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .eq('company_id', companyId)
      .is('unassigned_at', null)
      .order('assigned_at'),
    db
      .from('crm_contacts')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('primary_company_id', companyId)
      .is('deleted_at', null),
    listAssignableMembers(workspaceId),
  ])

  for (const r of [company, tags, assignments, leads]) {
    if (r.error) throw new Error(`getAccount failed: ${r.error.message}`)
  }
  // Deleted between the visibility check and this read.
  if (!company.data) throw new AppError('ERR_NOT_FOUND', `account ${companyId} gone`)
  const c = company.data

  const base = toListRow(
    {
      ...c,
      source: c.source,
      lead_count: leads.count ?? 0,
      tags: (tags.data ?? []).map((t) => ({
        id: t.tag_id,
        group_id: t.group_id,
        primary: t.is_primary,
        source: t.source,
      })) as unknown as Json,
      assignee_ids: (assignments.data ?? []).map((a) => a.user_id),
      total_count: 1,
    },
    vocab,
    members,
  )

  return {
    ...base,
    summary: c.summary,
    industry: c.industry,
    ownerUserId: c.owner_user_id,
    createdBy: c.created_by,
    createdAt: c.created_at,
    sourceCompanyId: c.source_company_id,
  }
}

// ---------------------------------------------------------------------------
// The detail page's secondary reads
// ---------------------------------------------------------------------------

export type AccountTimelineEntry = {
  id: string
  activityType: string
  channel: string
  occurredAt: string
  actorUserId: string | null
  /** Set when the event was about a person at the account, not the account. */
  contact: { id: string; name: string | null } | null
  metadata: Record<string, unknown>
}

/** People the timeline reaches through. A bound, not a page: see below. */
const TIMELINE_PEOPLE = 500

/**
 * The account's activity AND its people's, newest first.
 *
 * ⚠️ PEOPLE FOLLOW THE CONTACT RULE. An employee assigned to the account still
 * sees only the contacts they may see (`dataScope`) — otherwise the account
 * timeline would be a window onto a colleague's conversations that the
 * contact list deliberately hides.
 */
export async function listAccountTimeline(
  access: AccountAccess,
  companyId: string,
  options: { limit?: number; contactScope: 'all' | 'assigned' },
): Promise<AccountTimelineEntry[]> {
  await assertCanSeeAccount(access, companyId)
  const workspaceId = access.ctx.workspace.id
  const db = createAdminClient()

  let people = db
    .from('crm_contacts')
    .select('id, full_name')
    .eq('workspace_id', workspaceId)
    .eq('primary_company_id', companyId)
    .is('deleted_at', null)
    .order('id')
    .limit(TIMELINE_PEOPLE)
  if (options.contactScope === 'assigned') people = people.eq('owner_user_id', access.ctx.userId)

  const { data: contacts, error: peopleError } = await people
  if (peopleError) throw new Error(`listAccountTimeline failed: ${peopleError.message}`)

  const names = new Map((contacts ?? []).map((c) => [c.id, c.full_name]))
  const ids = [...names.keys()]

  /*
   * ⚠️ AN EVENT ABOUT A PERSON CARRIES THE ACCOUNT'S company_id TOO (notes,
   * tasks and emails record both). So for a viewer limited to their own
   * contacts, "about the account" must mean "about the account and NO person"
   * — otherwise `company_id = X` alone lets a colleague's conversations back
   * in through the account door. The ids come from our own query, so they are
   * UUIDs; quoting is not needed.
   */
  const accountOnly =
    options.contactScope === 'assigned'
      ? `and(company_id.eq.${companyId},contact_id.is.null)`
      : `company_id.eq.${companyId}`
  const subject = ids.length > 0 ? `${accountOnly},contact_id.in.(${ids.join(',')})` : accountOnly

  const { data, error } = await db
    .from('crm_activities')
    .select('id, activity_type, channel, occurred_at, actor_user_id, contact_id, metadata')
    .eq('workspace_id', workspaceId)
    .or(subject)
    .order('occurred_at', { ascending: false })
    .limit(Math.min(options.limit ?? 50, 200))

  if (error) throw new Error(`listAccountTimeline failed: ${error.message}`)

  return (data ?? [])
    // Belt and braces: whatever the filter returned, nothing about a person
    // this viewer may not see leaves this function.
    .filter((row) => options.contactScope === 'all' || !row.contact_id || names.has(row.contact_id))
    .map((row) => ({
    id: row.id,
    activityType: row.activity_type,
    channel: row.channel,
    occurredAt: row.occurred_at,
    actorUserId: row.actor_user_id,
    contact: row.contact_id ? { id: row.contact_id, name: names.get(row.contact_id) ?? null } : null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  }))
}

export type AccountNote = { id: string; body: string; createdAt: string; authorUserId: string | null }

export async function listAccountNotes(access: AccountAccess, companyId: string): Promise<AccountNote[]> {
  await assertCanSeeAccount(access, companyId)
  const { data, error } = await createAdminClient()
    .from('crm_notes')
    .select('id, body, created_at, created_by')
    .eq('workspace_id', access.ctx.workspace.id)
    .eq('company_id', companyId)
    // Notes on the ACCOUNT. A note on a person lives on that person's page,
    // under the contact rule — never here, where a setter could read it.
    .is('contact_id', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(`listAccountNotes failed: ${error.message}`)
  return (data ?? []).map((n) => ({
    id: n.id,
    body: n.body,
    createdAt: n.created_at,
    authorUserId: n.created_by,
  }))
}

export type AccountSource = {
  id: string
  type: string
  url: string | null
  importedAt: string
  importedBy: string | null
  /** The parsed row or card, as stored. Rendered as text, never as HTML. */
  payload: Record<string, unknown> | null
}

export async function listAccountSources(access: AccountAccess, companyId: string): Promise<AccountSource[]> {
  await assertCanSeeAccount(access, companyId)
  const { data, error } = await createAdminClient()
    .from('crm_company_sources')
    .select('id, source_type, url, imported_at, imported_by, raw_payload')
    .eq('workspace_id', access.ctx.workspace.id)
    .eq('company_id', companyId)
    .order('imported_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(`listAccountSources failed: ${error.message}`)
  return (data ?? []).map((r) => ({
    id: r.id,
    type: r.source_type,
    url: r.url,
    importedAt: r.imported_at,
    importedBy: r.imported_by,
    payload:
      r.raw_payload && typeof r.raw_payload === 'object' && !Array.isArray(r.raw_payload)
        ? (r.raw_payload as Record<string, unknown>)
        : null,
  }))
}

export type AccountSettings = { allowMultipleAssignees: boolean }

/** Absence of a row means the defaults, exactly as 0144 declares them. */
export async function getAccountSettings(workspaceId: string): Promise<AccountSettings> {
  const { data, error } = await createAdminClient()
    .from('crm_account_settings')
    .select('allow_multiple_assignees')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (error) throw new Error(`getAccountSettings failed: ${error.message}`)
  return { allowMultipleAssignees: data?.allow_multiple_assignees ?? false }
}

/**
 * "Lead status" on the account's People table (approved 2026-10-01): the
 * stage of the lead's OPEN deal, from the existing pipeline — not a second
 * status system. A lead with no open deal has no status, and says so.
 * When a lead has several open deals, the most recently moved one wins.
 */
export async function openDealStages(
  workspaceId: string,
  contactIds: string[],
  options: { ownerUserId?: string | null } = {},
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (contactIds.length === 0) return out
  const db = createAdminClient()

  let query = db
    .from('crm_opportunities')
    .select('contact_id, stage_id, updated_at')
    .eq('workspace_id', workspaceId)
    .eq('status', 'open')
    .is('deleted_at', null)
    .in('contact_id', contactIds)
    .order('updated_at', { ascending: false })
  // Deals follow the contact rule, as on the board.
  if (options.ownerUserId) query = query.eq('owner_user_id', options.ownerUserId)

  const { data: deals, error } = await query
  if (error) throw new Error(`openDealStages failed: ${error.message}`)

  const latest = new Map<string, string>()
  for (const d of deals ?? []) {
    if (d.contact_id && !latest.has(d.contact_id)) latest.set(d.contact_id, d.stage_id)
  }
  if (latest.size === 0) return out

  const { data: stages, error: stageError } = await db
    .from('crm_pipeline_stages')
    .select('id, name')
    .eq('workspace_id', workspaceId)
    .in('id', [...new Set(latest.values())])
  if (stageError) throw new Error(`openDealStages failed: ${stageError.message}`)

  const name = new Map((stages ?? []).map((s) => [s.id, s.name]))
  for (const [contactId, stageId] of latest) {
    const stage = name.get(stageId)
    if (stage) out.set(contactId, stage)
  }
  return out
}
