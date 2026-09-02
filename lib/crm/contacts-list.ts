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
export async function listContacts(
  workspaceId: string,
  options: ListContactsOptions = {},
): Promise<ContactListPage> {
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
  company: { id: string; name: string | null } | null
  emails: { id: string; address: string; isPrimary: boolean }[]
  phones: { id: string; raw: string; e164: string | null; isPrimary: boolean }[]
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
      .select('id, address, is_primary')
      .eq('workspace_id', workspaceId)
      .eq('contact_id', contactId)
      .is('deleted_at', null)
      .order('is_primary', { ascending: false }),
    db
      .from('crm_contact_phones')
      .select('id, raw, e164, is_primary')
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
          .select('id, name')
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
    company: company.data ? { id: company.data.id, name: company.data.name } : null,
    emails: (emails.data ?? []).map((e) => ({
      id: e.id,
      address: e.address,
      isPrimary: e.is_primary,
    })),
    phones: (phones.data ?? []).map((p) => ({
      id: p.id,
      raw: p.raw,
      e164: p.e164,
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
