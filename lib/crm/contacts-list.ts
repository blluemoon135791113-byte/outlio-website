import 'server-only'

/**
 * Reads for the contacts list and detail pages.
 *
 * ⚠️ NOTHING HERE IS UNBOUNDED (A6). Every query filters on the server, pages,
 * and caps its own page size. A list that loads "all contacts" is fine on the
 * demo account and fatal on the first real one.
 *
 * ⚠️ SCOPE IS A REQUIRED ARGUMENT, NOT AN OPTION. RLS grants a member the
 * whole workspace; `dataScope` is what narrows a setter to their own records,
 * and a caller that forgets it shows them the entire company's book.
 */
import type { TenantScope } from '@/lib/auth/scope'
import type { Database } from '@/types/database'
import { createAdminClient } from '@/lib/supabase/admin'

export type ContactListRow = {
  id: string
  fullName: string | null
  jobTitle: string | null
  companyName: string | null
  ownerUserId: string | null
  ownerName: string | null
  primaryEmail: string | null
  lastActivityAt: string | null
  createdAt: string
}

export type ContactListPage = {
  rows: ContactListRow[]
  total: number
  page: number
  pageSize: number
}

const MAX_PAGE_SIZE = 100

export type ListContactsOptions = {
  search?: string | null
  /** `null` means "the whole workspace" and is only ever passed for a manager. */
  ownerUserId?: string | null
  /**
   * ⚠️ A SEPARATE FLAG, NOT `ownerUserId: null`.
   *
   * "Everyone" and "nobody" are different filters and null already means the
   * first. Overloading it would make "show me unassigned contacts" —
   * the single most useful view straight after an import — unexpressible.
   */
  unassignedOnly?: boolean
  page?: number
  pageSize?: number
  /**
   * ⚠️ ONLY COLUMNS THE BASE QUERY CAN ORDER BY.
   *
   * Company, email, owner and last activity are resolved AFTER the page is
   * fetched, in four batched lookups. Sorting on one of them could only sort
   * the 25 rows already in hand, which looks identical to a real sort and is
   * wrong the moment there is a second page — the top name on page 1 would not
   * be the top name overall. Rather than offer that, the list offers no sort
   * control on those columns at all.
   */
  sort?: ContactSort
  direction?: 'asc' | 'desc'
  /**
   * Contacts carrying ALL of these tag ids.
   *
   * ⚠️ AND, NOT OR. "Marketing qualified" AND "London" is a segment; the OR of
   * them is nearly the whole list and nobody asks for it. Each tag therefore
   * narrows, which also means an empty array must mean "no tag filter" rather
   * than "no tags allowed" — the two are opposite and the second is useless.
   */
  tagIds?: string[]
  /** Contacts at this company. */
  companyId?: string | null
  /** ISO date; contacts created on or after it. */
  createdAfter?: string | null
  /** ISO date; contacts created strictly before it. */
  createdBefore?: string | null
  /**
   * `true` → only contacts with at least one email address.
   * `false` → only contacts with none.
   *
   * ⚠️ `undefined` IS A THIRD STATE and means "do not filter". A boolean with a
   * default of `false` would silently hide every contact that has an email —
   * which is most of them — and read as an empty database.
   */
  hasEmail?: boolean
  /**
   * Where the contact came from.
   *
   * ⚠️ THE DATABASE ENUM, NOT `string`. Typing this as a string would let a
   * caller pass anything and get a PostgREST error at runtime; the union makes
   * an invalid source a compile failure and needs no separate allowlist —
   * which is the same reasoning behind `isContactSort`.
   */
  source?: ContactSource | null
}

/** `crm_record_source`, from the generated database types. */
export type ContactSource = Database['public']['Enums']['crm_record_source']

export const CONTACT_SOURCES: readonly ContactSource[] = [
  'lead_engine',
  'csv_import',
  'manual',
  'api',
  'flow',
]

export function isContactSource(value: string | undefined): value is ContactSource {
  return (CONTACT_SOURCES as readonly string[]).includes(value ?? '')
}

/** The sortable columns, and the database column each one means. */
export const CONTACT_SORTS = {
  name: 'full_name',
  created: 'created_at',
} as const

export type ContactSort = keyof typeof CONTACT_SORTS

export function isContactSort(value: string | undefined): value is ContactSort {
  return value === 'name' || value === 'created'
}

/**
 * One page of contacts.
 *
 * Search matches a name or an email address. Both are backed by trigram
 * indexes (migration 0080), so a partial word matches — someone typing "sam"
 * expects to find Samuel.
 */
/**
 * ⚠️ TAKES A `TenantScope`, NOT A BARE STRING.
 *
 * A `workspaceId: string` parameter is indistinguishable from any other string
 * at a call site — passing a contact id, a user id, or another tenant's id all
 * typecheck. `TenantScope` can only be produced by `scopeFor` from a
 * `WorkspaceContext`, which can only be produced by an authenticated request.
 * That is the same property that makes `apiRoute` safe: the scope is not
 * something a caller can invent.
 */
/**
 * A uuid that cannot exist, for the empty-set case.
 *
 * ⚠️ POSTGREST REJECTS `not.id.in.()` WITH AN EMPTY LIST as a syntax error, and
 * the natural fallback — skipping the clause — inverts the filter: "contacts
 * with no email" would return EVERY contact the moment none had one. A
 * guaranteed-absent id keeps the meaning intact.
 */
const NO_UUID = '00000000-0000-0000-0000-000000000000'

/**
 * Contacts carrying every one of `tagIds`.
 *
 * ⚠️ INTERSECTION, COMPUTED HERE. `crm_contact_tags` has one row per (contact,
 * tag), so a plain `.in('tag_id', ids)` returns contacts with ANY of them —
 * which is a different, much larger, and much less useful answer than the one
 * the caller asked for.
 */
async function contactIdsWithAllTags(
  db: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  tagIds: string[],
): Promise<string[]> {
  const { data, error } = await db
    .from('crm_contact_tags')
    .select('contact_id, tag_id')
    .eq('workspace_id', workspaceId)
    .in('tag_id', tagIds)

  if (error) throw new Error(`tag filter failed: ${error.message}`)

  const counts = new Map<string, Set<string>>()
  for (const row of data ?? []) {
    const seen = counts.get(row.contact_id) ?? new Set<string>()
    seen.add(row.tag_id)
    counts.set(row.contact_id, seen)
  }

  return [...counts.entries()]
    .filter(([, seen]) => seen.size === tagIds.length)
    .map(([contactId]) => contactId)
}

/** Contacts with at least one non-deleted email address. */
async function contactIdsWithEmail(
  db: ReturnType<typeof createAdminClient>,
  workspaceId: string,
): Promise<string[]> {
  const { data, error } = await db
    .from('crm_contact_emails')
    .select('contact_id')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)

  if (error) throw new Error(`email filter failed: ${error.message}`)
  return [...new Set((data ?? []).map((r) => r.contact_id))]
}

export async function listContacts(
  scope: TenantScope,
  options: ListContactsOptions = {},
): Promise<ContactListPage> {
  const workspaceId = scope.workspaceId
  const db = createAdminClient()
  const pageSize = Math.min(Math.max(options.pageSize ?? 25, 1), MAX_PAGE_SIZE)
  const page = Math.max(options.page ?? 1, 1)
  const from = (page - 1) * pageSize

  const search = options.search?.trim() ?? ''

  let matchedIds: string[] | null = null
  if (search) {
    // An email match is resolved first and separately: the address lives on a
    // child table, and PostgREST cannot OR across an embedded resource and a
    // parent column in one filter.
    const { data: byEmail, error: emailError } = await db
      .from('crm_contact_emails')
      .select('contact_id')
      .eq('workspace_id', workspaceId)
      .ilike('address', `%${search}%`)
      .is('deleted_at', null)
      .limit(MAX_PAGE_SIZE)

    if (emailError) throw new Error(`listContacts failed: ${emailError.message}`)
    matchedIds = [...new Set((byEmail ?? []).map((r) => r.contact_id))]
  }

  let query = db
    .from('crm_contacts')
    /*
     * ⚠️ `estimated`, NOT `exact` — M9 Phase 28, measured at 100k contacts.
     *
     * An exact count is a SECOND query that PostgREST runs alongside EVERY
     * page request, and it is O(rows in the workspace): at 100,000 contacts it
     * touched all 100,000 of them on every page load (18.8ms, 1,720 buffers
     * locally — worse on Supabase over the network with a cold cache). Page 1
     * itself costs 4 buffers, so the count was ~430x the cost of the data it
     * accompanied.
     *
     * `estimated` asks the PLANNER instead, which is answered during planning
     * without executing: 0.05ms, and measured 0.2% off at 100k (100,207 vs
     * 100,000). Below PostgREST's threshold it still returns an exact count,
     * so a small workspace is unaffected.
     *
     * The cost is real and accepted: at large volumes the last page number is
     * approximate, so paging to the very end can land on an empty page or
     * leave a few rows reachable only by search. Nobody pages to row 99,999 —
     * they search, which is indexed.
     */
    .select('id, full_name, job_title, owner_user_id, created_at, primary_company_id', {
      count: 'estimated',
    })
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)

  if (options.ownerUserId) query = query.eq('owner_user_id', options.ownerUserId)
  // Nobody, as opposed to everyone. See the note on `unassignedOnly`.
  if (options.unassignedOnly) query = query.is('owner_user_id', null)

  if (options.companyId) query = query.eq('primary_company_id', options.companyId)
  if (options.source) query = query.eq('source', options.source)
  if (options.createdAfter) query = query.gte('created_at', options.createdAfter)
  if (options.createdBefore) query = query.lt('created_at', options.createdBefore)

  /*
   * ⚠️ TAGS AND EMAILS LIVE ON CHILD TABLES, SO THEY ARE RESOLVED TO AN ID SET
   * FIRST AND APPLIED AS `.in()`.
   *
   * PostgREST can filter on an embedded resource, but not in a way that
   * composes with the `or()` the search already uses — and the failure mode is
   * a filter that silently does nothing rather than an error. Two extra
   * round-trips per request is the honest price; both are indexed lookups
   * scoped to the workspace.
   */
  if (options.tagIds && options.tagIds.length > 0) {
    const ids = await contactIdsWithAllTags(db, workspaceId, options.tagIds)
    // No match must return nothing, NOT "no filter". `.in()` with an empty
    // array is the correct expression of that and PostgREST honours it.
    query = query.in('id', ids)
  }

  if (options.hasEmail !== undefined) {
    const withEmail = await contactIdsWithEmail(db, workspaceId)
    query = options.hasEmail ? query.in('id', withEmail) : query.not('id', 'in', `(${withEmail.join(',') || NO_UUID})`)
  }

  if (search) {
    const escaped = search.replace(/[%_,()]/g, '')
    const clauses = [`full_name.ilike.%${escaped}%`]
    if (matchedIds && matchedIds.length > 0) {
      clauses.push(`id.in.(${matchedIds.join(',')})`)
    }
    query = query.or(clauses.join(','))
  }

  const sort: ContactSort = options.sort ?? 'created'
  const ascending = options.direction === 'asc'

  const { data, count, error } = await query
    /*
     * ⚠️ NULLS LAST IN BOTH DIRECTIONS. A contact with no name is not the
     * "first" one alphabetically in any sense a reader means, and Postgres
     * defaults to NULLS FIRST on DESC — so reversing the sort would otherwise
     * put every unnamed row at the top and bury the answer.
     */
    .order(CONTACT_SORTS[sort], { ascending, nullsFirst: false })
    /*
     * A stable tiebreaker. Without one, two contacts added in the same second
     * can swap places between page 1 and page 2 and a row is seen twice while
     * another is never seen at all.
     */
    .order('id', { ascending: true })
    .range(from, from + pageSize - 1)

  if (error) throw new Error(`listContacts failed: ${error.message}`)

  const rows = data ?? []
  if (rows.length === 0) {
    return { rows: [], total: count ?? 0, page, pageSize }
  }

  // Company names, owner names, primary emails and last activity are resolved
  // in FOUR batched lookups rather than per row. A per-row join is how a
  // 25-row page becomes 100 round trips.
  const contactIds = rows.map((r) => r.id)
  const companyIds = [...new Set(rows.map((r) => r.primary_company_id).filter(Boolean))] as string[]
  const ownerIds = [...new Set(rows.map((r) => r.owner_user_id).filter(Boolean))] as string[]

  const [companies, owners, emails, activity] = await Promise.all([
    companyIds.length
      ? db.from('crm_companies').select('id, name').in('id', companyIds)
      : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
    ownerIds.length
      ? db.from('profiles').select('id, full_name, email').in('id', ownerIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string | null }[] }),
    db
      .from('crm_contact_emails')
      .select('contact_id, address')
      .eq('workspace_id', workspaceId)
      .in('contact_id', contactIds)
      .eq('is_primary', true)
      .is('deleted_at', null),
    db
      .from('crm_activities')
      .select('contact_id, occurred_at')
      .eq('workspace_id', workspaceId)
      .in('contact_id', contactIds)
      .order('occurred_at', { ascending: false }),
  ])

  const companyName = new Map((companies.data ?? []).map((c) => [c.id, c.name]))
  const ownerName = new Map<string, string | null>(
    (owners.data ?? []).map((o) => [o.id, o.full_name?.trim() || o.email || null]),
  )
  const primaryEmail = new Map((emails.data ?? []).map((e) => [e.contact_id, e.address]))

  // First row per contact wins, because the query is already sorted newest
  // first. `contact_id` is nullable on crm_activities — an event can be about
  // a company alone — so it is guarded rather than cast.
  const lastActivity = new Map<string, string>()
  for (const row of activity.data ?? []) {
    if (!row.contact_id) continue
    if (!lastActivity.has(row.contact_id)) lastActivity.set(row.contact_id, row.occurred_at)
  }

  return {
    rows: rows.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      jobTitle: row.job_title,
      companyName: row.primary_company_id
        ? (companyName.get(row.primary_company_id) ?? null)
        : null,
      ownerUserId: row.owner_user_id,
      ownerName: row.owner_user_id ? (ownerName.get(row.owner_user_id) ?? null) : null,
      primaryEmail: primaryEmail.get(row.id) ?? null,
      lastActivityAt: lastActivity.get(row.id) ?? null,
      createdAt: row.created_at,
    })),
    total: count ?? rows.length,
    page,
    pageSize,
  }
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export type ContactDetail = {
  id: string
  fullName: string | null
  jobTitle: string | null
  headline: string | null
  location: string | null
  linkedInUrl: string | null
  ownerUserId: string | null
  ownerName: string | null
  source: string
  createdAt: string
  /*
   * ⚠️ THE COMPANY'S OWN FIELDS TRAVEL WITH THE CONTACT. A lead is worked as a
   * person AT a company, and "how big are they" / "what is their site" are part
   * of deciding whether to write at all — asking for them meant a second page
   * load, which in practice meant not asking.
   *
   * `sourceCompanyId` is the structural link to research evidence, so the
   * researched detail can be read from here without a second company query.
   */
  company: {
    id: string
    name: string | null
    domain: string | null
    employeeCount: number | null
    headquarters: string | null
    linkedInUrl: string | null
    source: string | null
    sourceCompanyId: string | null
  } | null
  /*
   * ⚠️ `evidenceId` TRAVELS WITH THE VALUE. Resolving citations separately by
   * matching addresses would cross the user_id/workspace_id seam and return the
   * wrong row whenever a value was observed twice — which is why 0113 added the
   * column rather than leaving it to a lookup.
   */
  emails: { id: string; address: string; isPrimary: boolean; evidenceId: string | null }[]
  phones: {
    id: string
    raw: string
    e164: string | null
    isPrimary: boolean
    evidenceId: string | null
  }[]
  tags: { id: string; name: string }[]
}

export async function getContactDetail(
  workspaceId: string,
  contactId: string,
): Promise<ContactDetail | null> {
  const db = createAdminClient()

  const { data: contact, error } = await db
    .from('crm_contacts')
    .select('id, full_name, job_title, headline, location, linkedin_url, owner_user_id, source, created_at, primary_company_id')
    .eq('workspace_id', workspaceId)
    .eq('id', contactId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw new Error(`getContactDetail failed: ${error.message}`)
  if (!contact) return null

  const [emails, phones, tags, company, owner] = await Promise.all([
    db
      .from('crm_contact_emails')
      // `evidence_id` is the citation this value carries (0113).
      .select('id, address, is_primary, evidence_id')
      .eq('workspace_id', workspaceId)
      .eq('contact_id', contactId)
      .is('deleted_at', null)
      .order('is_primary', { ascending: false }),
    db
      .from('crm_contact_phones')
      .select('id, raw, e164, is_primary, evidence_id')
      .eq('workspace_id', workspaceId)
      .eq('contact_id', contactId)
      .is('deleted_at', null)
      .order('is_primary', { ascending: false }),
    db
      .from('crm_contact_tags')
      .select('tag_id, crm_tags!inner(id, name)')
      .eq('workspace_id', workspaceId)
      .eq('contact_id', contactId),
    contact.primary_company_id
      ? db
          .from('crm_companies')
          .select(
            'id, name, domain, employee_count, headquarters, linkedin_url, source, source_company_id',
          )
          /*
           * ⚠️ SCOPED BY WORKSPACE, even though `primary_company_id` came off a
           * row this workspace owns. The service role bypasses RLS, so an id in
           * a column is the only thing standing between this query and another
           * tenant's company — and a mis-set foreign key would resolve silently.
           * Defence in depth, the same rule `citationsFor` follows.
           */
          .eq('workspace_id', workspaceId)
          .eq('id', contact.primary_company_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    contact.owner_user_id
      ? db
          .from('profiles')
          .select('full_name, email')
          .eq('id', contact.owner_user_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  type TagJoin = { tag_id: string; crm_tags: { id: string; name: string } | null }

  return {
    id: contact.id,
    fullName: contact.full_name,
    jobTitle: contact.job_title,
    headline: contact.headline,
    location: contact.location,
    linkedInUrl: contact.linkedin_url,
    ownerUserId: contact.owner_user_id,
    ownerName: owner.data?.full_name?.trim() || owner.data?.email || null,
    source: contact.source,
    createdAt: contact.created_at,
    company: company.data
      ? {
          id: company.data.id,
          name: company.data.name,
          domain: company.data.domain,
          employeeCount: company.data.employee_count,
          headquarters: company.data.headquarters,
          linkedInUrl: company.data.linkedin_url,
          source: company.data.source,
          sourceCompanyId: company.data.source_company_id,
        }
      : null,
    emails: (emails.data ?? []).map((e) => ({
      id: e.id,
      address: e.address,
      isPrimary: e.is_primary,
      evidenceId: e.evidence_id,
    })),
    phones: (phones.data ?? []).map((p) => ({
      id: p.id,
      raw: p.raw,
      e164: p.e164,
      evidenceId: p.evidence_id,
      isPrimary: p.is_primary,
    })),
    tags: ((tags.data ?? []) as unknown as TagJoin[])
      .map((t) => t.crm_tags)
      .filter((t): t is { id: string; name: string } => t !== null),
  }
}

/** Workspace members, for the owner picker. */
export async function listAssignableMembers(
  workspaceId: string,
): Promise<{ userId: string; name: string }[]> {
  const db = createAdminClient()

  const { data: memberships, error } = await db
    .from('workspace_memberships')
    .select('user_id')
    .eq('workspace_id', workspaceId)

  if (error) throw new Error(`listAssignableMembers failed: ${error.message}`)
  const ids = (memberships ?? []).map((m) => m.user_id)
  if (ids.length === 0) return []

  const { data: profiles } = await db
    .from('profiles')
    .select('id, full_name, email')
    .in('id', ids)

  return (profiles ?? []).map((p) => ({
    userId: p.id,
    name: p.full_name?.trim() || p.email || 'Unknown',
  }))
}
