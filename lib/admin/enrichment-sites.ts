import 'server-only'

/**
 * What enrichment read and searched, across every account, for the admin.
 *
 * ⚠️ HOSTS AND COUNTS ONLY. The logs hold no content, names or query text
 * (lib/intelligence/observe.ts); this summary adds the hosts that contact
 * evidence was cited from, which are business sites and directories, never a
 * lead's own detail. Service role, behind `requireAdmin()` on the page.
 */
import { PAGE_OUTCOMES, type EngineOutcome, type PageOutcome } from '@/lib/intelligence/observe'
import { createAdminClient } from '@/lib/supabase/admin'

export const SITES_WINDOW_DAYS = 7
const MAX_ROWS = 20_000

export type OutcomeCounts = Partial<Record<PageOutcome, number>>

export type SiteRow = { host: string; visits: number; outcomes: OutcomeCounts }

export type SearchPurposeRow = {
  purpose: string
  searches: number
  empty: number
  cached: number
  /** engine → outcome → count, for searches that reached the waterfall. */
  engines: Record<string, Partial<Record<EngineOutcome, number>>>
}

export type SitesSummary =
  | { state: 'not_applied' }
  | {
      state: 'ok'
      visits: number
      /** The window held more rows than were read; counts cover the newest only. */
      truncated: boolean
      byOutcome: OutcomeCounts
      byProvider: Array<{ provider: string; visits: number; outcomes: OutcomeCounts }>
      topSites: SiteRow[]
      refusingSites: SiteRow[]
      searches: SearchPurposeRow[]
      valueSources: Array<{ host: string; values: number; kinds: Record<string, number> }>
    }

type VisitRow = { host: string; provider: string; outcome: PageOutcome }
type SearchRow = { purpose: string; hits: number; cached: boolean; engines: unknown }

const missingTable = (code: string | undefined) => code === '42P01' || code === 'PGRST205'

async function readAll<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code?: string } | null }>): Promise<T[] | 'not_applied'> {
  const rows: T[] = []
  for (let from = 0; from < MAX_ROWS; from += 1_000) {
    const { data, error } = await read(from, from + 999)
    if (error && missingTable(error.code)) return 'not_applied'
    if (error) throw new Error(`sites summary read failed (${error.code ?? 'unknown'})`)
    rows.push(...(data ?? []))
    if ((data ?? []).length < 1_000) break
  }
  return rows
}

function bump<K extends string>(counts: Partial<Record<K, number>>, key: K, by = 1): void {
  counts[key] = (counts[key] ?? 0) + by
}

/** PURE. Visits grouped for the view. */
export function summariseVisits(rows: readonly VisitRow[]) {
  const byOutcome: OutcomeCounts = {}
  const providers = new Map<string, { visits: number; outcomes: OutcomeCounts }>()
  const hosts = new Map<string, SiteRow>()
  for (const row of rows) {
    bump(byOutcome, row.outcome)
    const provider = providers.get(row.provider) ?? { visits: 0, outcomes: {} }
    provider.visits += 1
    bump(provider.outcomes, row.outcome)
    providers.set(row.provider, provider)
    const host = hosts.get(row.host) ?? { host: row.host, visits: 0, outcomes: {} }
    host.visits += 1
    bump(host.outcomes, row.outcome)
    hosts.set(row.host, host)
  }
  const sites = [...hosts.values()]
  return {
    visits: rows.length,
    byOutcome,
    byProvider: [...providers.entries()]
      .map(([provider, value]) => ({ provider, ...value }))
      .sort((left, right) => right.visits - left.visits),
    topSites: [...sites].sort((left, right) => right.visits - left.visits).slice(0, 25),
    refusingSites: sites
      .filter((site) => (site.outcomes.refused ?? 0) > 0)
      .sort((left, right) => (right.outcomes.refused ?? 0) - (left.outcomes.refused ?? 0))
      .slice(0, 15),
  }
}

/** PURE. Searches grouped by purpose, with what each engine did. */
export function summariseSearches(rows: readonly SearchRow[]): SearchPurposeRow[] {
  const purposes = new Map<string, SearchPurposeRow>()
  for (const row of rows) {
    const entry = purposes.get(row.purpose) ?? { purpose: row.purpose, searches: 0, empty: 0, cached: 0, engines: {} }
    entry.searches += 1
    if (row.hits === 0) entry.empty += 1
    if (row.cached) entry.cached += 1
    for (const step of Array.isArray(row.engines) ? row.engines : []) {
      const { engine, outcome } = (step ?? {}) as { engine?: unknown; outcome?: unknown }
      if (typeof engine !== 'string' || typeof outcome !== 'string') continue
      bump((entry.engines[engine] ??= {}), outcome as EngineOutcome)
    }
    purposes.set(row.purpose, entry)
  }
  return [...purposes.values()].sort((left, right) => right.searches - left.searches)
}

function hostOf(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

export async function loadSitesSummary(now = new Date()): Promise<SitesSummary> {
  const db = createAdminClient()
  const since = new Date(now.getTime() - SITES_WINDOW_DAYS * 86_400_000).toISOString()

  const visits = await readAll<VisitRow>((from, to) =>
    db.from('enrichment_page_visits').select('host, provider, outcome').gte('created_at', since).order('created_at', { ascending: false }).order('id').range(from, to) as never)
  if (visits === 'not_applied') return { state: 'not_applied' }
  const searches = await readAll<SearchRow>((from, to) =>
    db.from('enrichment_searches').select('purpose, hits, cached, engines').gte('created_at', since).order('created_at', { ascending: false }).order('id').range(from, to) as never)
  if (searches === 'not_applied') return { state: 'not_applied' }

  const evidence = await readAll<{ field: string; source_url: string | null }>((from, to) =>
    db.from('research_evidence')
      .select('field, source_url')
      .gte('created_at', since)
      .in('field', ['work_email', 'mobile_phone', 'company_contact_email', 'company_contact_phone'])
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to) as never)
  const sources = new Map<string, { host: string; values: number; kinds: Record<string, number> }>()
  for (const row of evidence === 'not_applied' ? [] : evidence) {
    const host = hostOf(row.source_url)
    if (!host) continue
    const entry = sources.get(host) ?? { host, values: 0, kinds: {} }
    entry.values += 1
    entry.kinds[row.field] = (entry.kinds[row.field] ?? 0) + 1
    sources.set(host, entry)
  }

  return {
    state: 'ok',
    truncated: visits.length >= MAX_ROWS || searches.length >= MAX_ROWS,
    ...summariseVisits(visits.filter((row) => (PAGE_OUTCOMES as readonly string[]).includes(row.outcome))),
    searches: summariseSearches(searches),
    valueSources: [...sources.values()].sort((left, right) => right.values - left.values).slice(0, 20),
  }
}
