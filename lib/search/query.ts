/**
 * Query shaping and result shaping for the SERP service.
 *
 * PURE — no I/O, no environment, no clock. Everything here is a decision about
 * text and URLs, which makes it the part of search that can be tested exactly.
 *
 * The reason this file exists separately from `serp.ts`: cache correctness is
 * entirely a function of how a query is normalized. Two callers asking the same
 * question in different whitespace must hit the same cache entry, or the cache
 * silently stops working and the daily quota drains at full speed with nobody
 * noticing.
 */
import { createHash } from 'node:crypto'

import type { SearchHit } from '@/lib/hubble/providers/types'

/** What gets SENT to an engine: collapsed whitespace, nothing else changed. */
export function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, ' ').trim()
}

/**
 * What the cache is KEYED on.
 *
 * Lowercased, because every engine here is case-insensitive and `"Acme Corp"`
 * and `"acme corp"` are the same search — paying twice for them is the exact
 * waste the cache exists to prevent. Punctuation is preserved: `site:`,
 * `filetype:` and quoted phrases change the result set and must not collide.
 */
export function canonicalQuery(query: string): string {
  return normalizeQuery(query).toLowerCase()
}

/**
 * Cache key for one search.
 *
 * Hashed rather than stored raw because `provider_cache.cache_key` is indexed
 * and a query can be 400 characters. The limit and time range are part of the
 * key: a 10-result answer cannot serve a caller that asked for 20, and a
 * month-restricted search is a different question from an unrestricted one.
 */
export function searchCacheKey(
  query: string,
  limit: number,
  timeRange?: string | null,
): string {
  const material = `${canonicalQuery(query)}${limit}${timeRange ?? ''}`
  return createHash('sha256').update(material).digest('hex')
}

/** Distinct queries, first occurrence wins, original spelling preserved. */
export function dedupeQueries(queries: readonly string[]): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const query of queries) {
    const normalized = normalizeQuery(query)
    if (!normalized) continue
    const key = canonicalQuery(normalized)
    if (seen.has(key)) continue
    seen.add(key)
    output.push(normalized)
  }
  return output
}

/** Hostname without `www.`, or `''` when the URL is unparseable. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Bare host form of anything a caller might hand us as a "domain". */
export function bareDomain(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    ?.split(':')[0] ?? ''
}

/** True for the domain itself and its subdomains — never for `notacme.com`. */
export function matchesDomain(host: string, domain: string): boolean {
  const target = bareDomain(domain)
  if (!host || !target) return false
  return host === target || host.endsWith(`.${target}`)
}

export type DomainFilter = {
  /** When present, ONLY hits on these domains survive. */
  allowDomains?: readonly string[]
  /** Hits on these domains are dropped. */
  blockDomains?: readonly string[]
}

export function filterHits(
  hits: readonly SearchHit[],
  filter: DomainFilter = {},
): SearchHit[] {
  const allow = (filter.allowDomains ?? []).map(bareDomain).filter(Boolean)
  const block = (filter.blockDomains ?? []).map(bareDomain).filter(Boolean)
  if (allow.length === 0 && block.length === 0) return [...hits]

  return hits.filter((hit) => {
    const host = hostOf(hit.url)
    if (block.some((domain) => matchesDomain(host, domain))) return false
    if (allow.length > 0 && !allow.some((domain) => matchesDomain(host, domain))) return false
    return true
  })
}

/**
 * Stable rank: preferred domains first, original engine order within each group.
 *
 * The preferred list is normally the employer's own domain. A fact stated on
 * the company's own site outranks the same fact on a directory, and putting
 * those hits first means the extractors downstream read them before they hit
 * whatever budget bounds how many results they look at.
 */
export function rankHits(
  hits: readonly SearchHit[],
  preferDomains: readonly string[] = [],
): SearchHit[] {
  const preferred = preferDomains.map(bareDomain).filter(Boolean)
  if (preferred.length === 0) return [...hits]

  return hits
    .map((hit, index) => ({ hit, index, host: hostOf(hit.url) }))
    .sort((left, right) => {
      const leftPreferred = preferred.some((domain) => matchesDomain(left.host, domain))
      const rightPreferred = preferred.some((domain) => matchesDomain(right.host, domain))
      if (leftPreferred !== rightPreferred) return leftPreferred ? -1 : 1
      return left.index - right.index
    })
    .map((entry) => entry.hit)
}

/**
 * Merges several result sets into one, first occurrence of a URL winning.
 *
 * Keyed on URL alone rather than URL + snippet: the same page returned by two
 * engines with slightly different snippets is one page, and treating it as two
 * would make a single source look like corroboration by two.
 */
export function mergeHits(...groups: ReadonlyArray<readonly SearchHit[]>): SearchHit[] {
  const byUrl = new Map<string, SearchHit>()
  for (const group of groups) {
    for (const hit of group) {
      if (!byUrl.has(hit.url)) byUrl.set(hit.url, hit)
    }
  }
  return [...byUrl.values()]
}
