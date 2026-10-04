/**
 * The Accounts list's query language: URL ⇄ filters ⇄ the SQL call.
 *
 * PURE. Two jobs, kept apart so each is testable:
 *
 *   parseAccountQuery    URL search params → a validated `AccountQuery`.
 *                        Anything malformed is DROPPED, never thrown: a
 *                        bookmarked URL from an older release must still open.
 *   toAccountRpcFilters  `AccountQuery` + vocabulary → the jsonb that
 *                        `crm_account_matches` (0150) reads, with ids.
 *
 * ⚠️ THE URL CARRIES SLUGS, NOT IDS. `?tag=industry:saas` survives an admin
 * renaming "SaaS" to "Software", and reads as what it is when pasted into a
 * chat. One `tag` parameter per group; statuses work the same way.
 *
 * ⚠️ AN UNKNOWN SLUG FILTERS TO NOTHING, IT IS NOT IGNORED. Dropping it would
 * silently widen a shared view — "Hospital accounts" becoming "all accounts"
 * after someone deletes a value — and the person reading it would act on the
 * wrong list. Nothing is the honest answer, and the active-filter chip says why.
 */

export const ACCOUNT_SORTS = ['name', 'last_activity', 'created', 'employees', 'priority'] as const
export type AccountSort = (typeof ACCOUNT_SORTS)[number]

export const ACCOUNT_PRIORITIES = ['high', 'medium', 'low'] as const
export type AccountPriority = (typeof ACCOUNT_PRIORITIES)[number]

/** crm_record_source values, plus 'extension' (0145). */
export const ACCOUNT_SOURCES = ['lead_engine', 'csv_import', 'manual', 'api', 'flow', 'extension'] as const
export type AccountSource = (typeof ACCOUNT_SOURCES)[number]

export const ACCOUNT_PAGE_SIZE = 25
const MAX_SEARCH = 100
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type AccountQuery = {
  /** `undefined` = the viewer's default (All with view_all, otherwise Mine). */
  scope?: 'mine' | 'all'
  /**
   * Tag filters: group slug → value slug, one value per group (spec §6.1:
   * single-select within a group, AND between groups). Workspace-defined, so
   * the keys are whatever groups this workspace has.
   */
  tags: Record<string, string>
  /** A member's user id, `unassigned`, or `me`. */
  assignee?: string
  status?: string
  priority?: AccountPriority
  source?: AccountSource
  q?: string
  sort: AccountSort
  desc: boolean
  page: number
}

type RawParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value
  const trimmed = v?.trim()
  return trimmed ? trimmed : undefined
}

function oneOf<T extends string>(list: readonly T[], value: string | undefined): T | undefined {
  return value !== undefined && (list as readonly string[]).includes(value) ? (value as T) : undefined
}

/**
 * `tag=group:value`, repeated. The first value for a group wins — one value per
 * group — and anything that is not two slugs is dropped like any malformed
 * parameter.
 */
function parseTags(raw: string | string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]) {
    const [group, value, extra] = entry.trim().toLowerCase().split(':')
    if (extra !== undefined || !group || !value) continue
    if (!SLUG.test(group) || !SLUG.test(value)) continue
    if (!(group in out)) out[group] = value
  }
  return out
}

/** A copy of the tag filters with one group set, or cleared with `undefined`. */
export function withTag(
  tags: Record<string, string>,
  group: string,
  value: string | undefined,
): Record<string, string> {
  const next = { ...tags }
  if (value === undefined) delete next[group]
  else next[group] = value
  return next
}

export function parseAccountQuery(params: RawParams): AccountQuery {
  const slug = (key: string) => {
    const v = first(params[key])?.toLowerCase()
    return v && SLUG.test(v) ? v : undefined
  }

  const assigneeRaw = first(params.assignee)
  const assignee =
    assigneeRaw === 'unassigned' || assigneeRaw === 'me' || (assigneeRaw && UUID.test(assigneeRaw))
      ? assigneeRaw.toLowerCase()
      : undefined

  const pageRaw = Number(first(params.page) ?? 1)
  const q = first(params.q)?.slice(0, MAX_SEARCH)

  return {
    scope: oneOf(['mine', 'all'] as const, first(params.scope)),
    tags: parseTags(params.tag),
    assignee,
    status: slug('status'),
    priority: oneOf(ACCOUNT_PRIORITIES, first(params.priority)),
    source: oneOf(ACCOUNT_SOURCES, first(params.source)),
    q: q || undefined,
    sort: oneOf(ACCOUNT_SORTS, first(params.sort)) ?? 'name',
    desc: first(params.dir) === 'desc',
    page: Number.isInteger(pageRaw) && pageRaw >= 1 ? Math.min(pageRaw, 10_000) : 1,
  }
}

/** The query back as URL params, omitting defaults, so links stay short. */
export function accountQueryToParams(query: AccountQuery): URLSearchParams {
  const out = new URLSearchParams()
  if (query.scope) out.set('scope', query.scope)
  // Sorted by group so one view has one URL, whatever order it was built in.
  for (const group of Object.keys(query.tags).sort()) out.append('tag', `${group}:${query.tags[group]}`)
  if (query.assignee) out.set('assignee', query.assignee)
  if (query.status) out.set('status', query.status)
  if (query.priority) out.set('priority', query.priority)
  if (query.source) out.set('source', query.source)
  if (query.q) out.set('q', query.q)
  if (query.sort !== 'name') out.set('sort', query.sort)
  if (query.desc) out.set('dir', 'desc')
  if (query.page > 1) out.set('page', String(query.page))
  return out
}

export const ACCOUNTS_PATH = '/crm/companies'

/**
 * The one place an Accounts URL is assembled. Any change to WHAT is shown
 * resets to page 1 — page 4 of a narrower list is usually past its end — while
 * sorting and paging keep the page the reader chose.
 */
export function accountsHref(query: AccountQuery, patch: Partial<AccountQuery> = {}): string {
  const membershipChanged = Object.keys(patch).some((k) => k !== 'page' && k !== 'sort' && k !== 'desc')
  const next: AccountQuery = { ...query, ...(membershipChanged ? { page: 1 } : {}), ...patch }
  const params = accountQueryToParams(next).toString()
  return params ? `${ACCOUNTS_PATH}?${params}` : ACCOUNTS_PATH
}

/** Escapes LIKE wildcards so a search for "100%" means the text, not a pattern. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/** Never a real id; compared as text in SQL, so it matches nothing. */
export const NO_MATCH = 'no-match'

export type SlugIndex = ReadonlyMap<string, string>

export type AccountRpcFilters = {
  scope: 'mine' | 'all'
  /** Tag ids, ANDed. An unknown group or value contributes NO_MATCH. */
  tags: string[]
  assignee?: string
  status?: string
  priority?: AccountPriority
  source?: AccountSource
  q?: string
}

/**
 * ⚠️ `scope` IS DECIDED HERE FOR A VIEWER WITHOUT view_all, but it is not
 * what protects them: `crm_account_matches` restricts to their assignments
 * whenever p_view_all is false, whatever this says.
 */
export function toAccountRpcFilters(
  query: AccountQuery,
  vocab: {
    /** group slug → (value slug → tag id) */
    groups: ReadonlyMap<string, SlugIndex>
    statuses: SlugIndex
  },
  viewer: { userId: string; viewAll: boolean },
): AccountRpcFilters {
  const id = (index: SlugIndex, slug: string | undefined) =>
    slug === undefined ? undefined : (index.get(slug) ?? NO_MATCH)

  return {
    scope: viewer.viewAll ? (query.scope ?? 'all') : 'mine',
    tags: Object.entries(query.tags).map(([group, value]) => vocab.groups.get(group)?.get(value) ?? NO_MATCH),
    assignee: query.assignee === 'me' ? viewer.userId : query.assignee,
    status: id(vocab.statuses, query.status),
    priority: query.priority,
    source: query.source,
    q: query.q ? escapeLike(query.q) : undefined,
  }
}

/** How many filters are active, for "Clear filters" and empty-state copy. */
export function activeFilterCount(query: AccountQuery): number {
  return (
    Object.keys(query.tags).length +
    [query.assignee, query.status, query.priority, query.source, query.q].filter((v) => v !== undefined).length
  )
}
