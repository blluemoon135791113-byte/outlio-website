import 'server-only'

/**
 * What enrichment visited and searched, for the admin view.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ NO CONTENT, NO NAMES, NO QUERIES.                                    ║
 * ║                                                                          ║
 * ║  A page visit is its HOST, a page kind, which provider read it and what  ║
 * ║  it came to. A search is its PURPOSE and shape (word count, quoted, an  ║
 * ║  operator) and what each engine did — never the query text, which       ║
 * ║  carries a person's name. Nothing here can rebuild a lead.               ║
 * ║                                                                          ║
 * ║  WHY: until 2026-11-01 a page that yielded nothing left no trace, and a ║
 * ║  search that came back empty said nothing about which engine answered.  ║
 * ║  63% of 2,223 cached searches were empty with no way to tell why.        ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Recorded only inside a research run (`withRunObservation`), buffered in
 * memory, written once when the run ends. A missing table (migration 0159 not
 * applied) or a failed write loses observations, never a run.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

import { isFetchFailure, type FetchedPage, type FetchFailure } from '@/lib/hubble/providers/types'
import { createAdminClient } from '@/lib/supabase/admin'

export const PAGE_OUTCOMES = [
  'read_contact', // read; the page stated an email or phone
  'read_empty', // read; nothing a contact reader could take
  'refused', // 401/403/429/503 or a bot check — never worked around
  'js_rendered', // answered with no readable text
  'blocked', // refused by OUR policy: LinkedIn, people-search, private address
  'unreachable', // DNS, TLS, connection, other HTTP errors
  'timeout',
  'not_html', // a PDF, an image
  'too_large',
] as const
export type PageOutcome = (typeof PAGE_OUTCOMES)[number]

export type PageVisit = {
  provider: string
  host: string
  /** home, contact, about, team, press, search_result, listing, other */
  pageKind: string
  outcome: PageOutcome
  httpStatus?: number | null
  latencyMs?: number | null
}

export const ENGINE_OUTCOMES = ['hits', 'empty', 'failed', 'cooling_down', 'over_budget', 'not_configured'] as const
export type EngineOutcome = (typeof ENGINE_OUTCOMES)[number]

export type SearchObservation = {
  /** contact_email, contact_phone, domain_email, company_contact, domain_discovery, … */
  purpose: string
  words: number
  quoted: boolean
  /** `site:`, `filetype:`, an `@domain` token — the shape, not the value. */
  operators: string[]
  cached: boolean
  hits: number
  engines: Array<{ engine: string; outcome: EngineOutcome; hits?: number; ms?: number }>
}

type Context = {
  userId: string
  runId: string
  visits: Array<PageVisit & { at: string }>
  searches: Array<SearchObservation & { at: string }>
}

const STORE = new AsyncLocalStorage<Context>()

/** Above this, a run's observations are written early rather than held. */
const FLUSH_AT = 500

/** Runs `work` with observation on; writes what it saw when it ends, success or not. */
export async function withRunObservation<T>(userId: string, runId: string, work: () => Promise<T>): Promise<T> {
  const context: Context = { userId, runId, visits: [], searches: [] }
  try {
    return await STORE.run(context, work)
  } finally {
    await flush(context)
  }
}

export function recordPageVisit(visit: PageVisit): void {
  const context = STORE.getStore()
  if (!context || !visit.host) return
  context.visits.push({ ...visit, host: visit.host.toLowerCase().replace(/^www\./, ''), at: new Date().toISOString() })
  if (context.visits.length + context.searches.length >= FLUSH_AT) void flush(context)
}

export function recordSearch(search: SearchObservation): void {
  const context = STORE.getStore()
  if (!context) return
  context.searches.push({ ...search, at: new Date().toISOString() })
  if (context.visits.length + context.searches.length >= FLUSH_AT) void flush(context)
}

const REFUSAL = /HTTP (401|403|429|503)\b/

/** PURE. What one guarded fetch came to, in the log's vocabulary. */
export function fetchOutcome(result: FetchedPage | FetchFailure): { outcome: PageOutcome; httpStatus: number | null } {
  if (!isFetchFailure(result)) {
    const structured = result.structured as { emails?: unknown[]; phones?: unknown[]; people?: Array<{ email?: unknown; phone?: unknown }> }
    const stated =
      (structured.emails?.length ?? 0) > 0 ||
      (structured.phones?.length ?? 0) > 0 ||
      (structured.people ?? []).some((person) => person.email || person.phone)
    return { outcome: stated ? 'read_contact' : 'read_empty', httpStatus: result.status }
  }
  const status = Number(/HTTP (\d{3})/.exec(result.detail)?.[1]) || null
  switch (result.code) {
    case 'blocked': return { outcome: 'blocked', httpStatus: null }
    case 'timeout': return { outcome: 'timeout', httpStatus: null }
    case 'not_html': return { outcome: 'not_html', httpStatus: null }
    case 'too_large': return { outcome: 'too_large', httpStatus: null }
    case 'empty': return { outcome: /javascript/i.test(result.detail) ? 'js_rendered' : 'read_empty', httpStatus: null }
    default: return { outcome: REFUSAL.test(result.detail) ? 'refused' : 'unreachable', httpStatus: status }
  }
}

/** Records one guarded fetch as a visit. */
export function recordFetch(provider: string, pageKind: string, result: FetchedPage | FetchFailure, startedAt: number): void {
  let host = ''
  try {
    host = new URL(result.url).hostname
  } catch {
    return
  }
  recordPageVisit({ provider, host, pageKind, ...fetchOutcome(result), latencyMs: Date.now() - startedAt })
}

/** PURE. The shape of a query, without any of its words. */
export function queryShape(query: string): Pick<SearchObservation, 'words' | 'quoted' | 'operators'> {
  const operators = [
    ...(/\bsite:/i.test(query) ? ['site'] : []),
    ...(/\bfiletype:/i.test(query) ? ['filetype'] : []),
    ...(/"@[a-z0-9.-]+\.[a-z]{2,}"/i.test(query) ? ['at_domain'] : []),
  ]
  return { words: query.trim().split(/\s+/).filter(Boolean).length, quoted: query.includes('"'), operators }
}

/** PURE. What kind of page a URL is, from its path alone. */
export function pageKindOf(url: string, fallback = 'other'): string {
  let path = ''
  try {
    path = new URL(url).pathname.toLowerCase()
  } catch {
    return fallback
  }
  if (path === '/' || path === '') return 'home'
  if (/contact|get-in-touch|kontakt/.test(path)) return 'contact'
  if (/team|people|leadership|founders|staff/.test(path)) return 'team'
  if (/press|media|news/.test(path)) return 'press'
  if (/about|our-story|company/.test(path)) return 'about'
  return fallback
}

async function flush(context: Context): Promise<void> {
  const visits = context.visits.splice(0)
  const searches = context.searches.splice(0)
  if (visits.length === 0 && searches.length === 0) return
  try {
    const db = createAdminClient()
    if (visits.length > 0) {
      const { error } = await db.from('enrichment_page_visits').insert(visits.map((visit) => ({
        user_id: context.userId,
        research_run_id: context.runId,
        provider: visit.provider,
        host: visit.host.slice(0, 253),
        page_kind: visit.pageKind,
        outcome: visit.outcome,
        http_status: visit.httpStatus ?? null,
        latency_ms: visit.latencyMs ?? null,
        created_at: visit.at,
      })))
      if (error) console.warn('[observe] visits not recorded', { code: error.code ?? 'unknown' })
    }
    if (searches.length > 0) {
      const { error } = await db.from('enrichment_searches').insert(searches.map((search) => ({
        user_id: context.userId,
        research_run_id: context.runId,
        purpose: search.purpose,
        words: search.words,
        quoted: search.quoted,
        operators: search.operators,
        cached: search.cached,
        hits: search.hits,
        engines: search.engines,
        created_at: search.at,
      })))
      if (error) console.warn('[observe] searches not recorded', { code: error.code ?? 'unknown' })
    }
  } catch {
    // Observability is never worth failing a run over.
  }
}

/** How long visits and searches are kept. */
export const LOG_RETENTION_DAYS = 30

/**
 * Removes log rows older than the retention window. Throws on a read or write
 * error so the tick records it, instead of reporting "0 removed" forever.
 */
export async function pruneEnrichmentLogs(now = new Date()): Promise<number | 'not_applied'> {
  const before = new Date(now.getTime() - LOG_RETENTION_DAYS * 86_400_000).toISOString()
  const db = createAdminClient()
  let removed = 0
  for (const table of ['enrichment_page_visits', 'enrichment_searches'] as const) {
    const { count, error } = await db.from(table).delete({ count: 'exact' }).lt('created_at', before)
    // The tables arrive with migration 0159, applied by hand: until then there is nothing to prune.
    if (error && (error.code === '42P01' || error.code === 'PGRST205')) return 'not_applied'
    if (error) throw new Error(`prune ${table} failed: ${error.code ?? 'unknown'}`)
    removed += count ?? 0
  }
  return removed
}
