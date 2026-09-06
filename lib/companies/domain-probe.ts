import 'server-only'

/**
 * Finds a company's domain WITHOUT a search engine, by guessing and verifying.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  WHY THIS EXISTS.                                                        ║
 * ║                                                                          ║
 * ║  1,534 of 2,094 companies have no domain. Domain is the highest-leverage ║
 * ║  field in the system: it scopes Hubble's search, drives source tiering,  ║
 * ║  and is the join key to every external dataset. Without it a company     ║
 * ║  cannot be enriched, verified, or answered about with any precision.     ║
 * ║                                                                          ║
 * ║  The existing discovery path runs a web search — and web search is the   ║
 * ║  thing that is currently broken. This path needs none. A company name    ║
 * ║  implies a small set of candidate hostnames; DNS says which exist; and   ║
 * ║  fetching says which one is actually THEM.                               ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ GUESSING A HOSTNAME IS NOT FINDING A DOMAIN.                         ║
 * ║                                                                          ║
 * ║  `acme.com` resolving proves a domain exists, NOT that it belongs to the ║
 * ║  Acme in this database. It could be a squatter, a parking page, or a     ║
 * ║  completely unrelated company with the same name — and a wrong domain is ║
 * ║  worse than none, because it becomes the company's identity and drags    ║
 * ║  another company's funding, headcount and staff onto these leads.        ║
 * ║                                                                          ║
 * ║  So a candidate is accepted ONLY when the page it serves NAMES THE       ║
 * ║  COMPANY. The verification step is not an optimisation; it is the only   ║
 * ║  thing separating this from fabrication.                                 ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import { lookup } from 'node:dns/promises'

import { httpPageFetcher } from '@/lib/hubble/fetch/fetcher'
import { isFetchFailure } from '@/lib/hubble/providers/types'
import { normalizeCompanyName } from '@/lib/companies/normalize'

/**
 * Legal suffixes and filler that are not part of a company's web identity.
 *
 * "Atlas AI Solutions Ltd" and "Atlas AI Solutions" resolve to the same
 * candidates; a company almost never puts "ltd" in its hostname.
 */
const NAME_NOISE =
  /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|plc|corp|corporation|gmbh|bv|nv|sa|ag|pty|co|company|holdings|group|the)\b/gi

/** Ordered by how often a B2B company actually uses them. */
const TLDS = ['com', 'io', 'ai', 'co', 'net', 'org', 'app', 'dev'] as const

/**
 * Hostname stems worth trying for a name.
 *
 * ⚠️ BOUNDED AT THREE. "Atlas AI Solutions" could plausibly be a dozen things;
 * generating all of them turns a backfill into a port scan of the internet and
 * makes a false positive far likelier. Full name, name-without-last-word, and
 * first word — beyond that the guess is too weak to verify safely.
 */
export function candidateStems(companyName: string): string[] {
  const cleaned = (normalizeCompanyName(companyName) ?? companyName)
    .replace(NAME_NOISE, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()

  const words = cleaned.split(/\s+/).filter(Boolean)
  if (words.length === 0) return []

  const stems = new Set<string>()
  const full = words.join('')

  // ⚠️ Under 5 characters collides with unrelated domains far too easily.
  if (full.length >= 5 && full.length <= 40) stems.add(full)
  if (words.length > 1) {
    const dropLast = words.slice(0, -1).join('')
    if (dropLast.length >= 5) stems.add(dropLast)
  }
  if (words[0] && words[0].length >= 5) stems.add(words[0])

  return [...stems].slice(0, 3)
}

/**
 * When the company NAME is already a hostname, that is the answer.
 *
 * ⚠️ A REAL MISS. A sample run failed on `evry.space`, `Litigators.org` and
 * `echomode.io` — three companies that had put their domain in their name
 * — while happily probing a dozen invented candidates for each. It even
 * "found" evryspace.com for evry.space, which is a different string and may
 * be a different company. Try the obvious first.
 */
export function nameAsHost(companyName: string): string | null {
  const cleaned = companyName
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .trim()
    .replace(/\/.*$/, '')

  // A hostname: labels of letters/digits/hyphens, and a TLD of 2+ letters.
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(cleaned)) return null
  // Two labels minimum, and nothing absurdly long.
  if (cleaned.split('.').length < 2 || cleaned.length > 60) return null

  return cleaned
}

export function candidateHosts(companyName: string): string[] {
  const hosts: string[] = []

  // The name itself, when it is already a hostname. Highest confidence.
  const literal = nameAsHost(companyName)
  if (literal) hosts.push(literal)

  for (const stem of candidateStems(companyName)) {
    for (const tld of TLDS) {
      if (!hosts.includes(`${stem}.${tld}`)) hosts.push(`${stem}.${tld}`)
    }
  }
  return hosts
}

/** Does this hostname exist at all? The cheap filter before any fetch. */
async function resolves(host: string): Promise<boolean> {
  try {
    const addresses = await lookup(host, { all: true })
    return addresses.length > 0
  } catch {
    return false
  }
}

/**
 * Does the page at this host actually belong to this company?
 *
 * ⚠️ THE WHOLE SAFETY STORY. Requires the company's distinctive words to
 * appear in the page's own text. A parking page, a squatter, or an unrelated
 * namesake will not contain them, and is rejected — leaving the column NULL,
 * which is the correct outcome.
 */
export function pageNamesCompany(companyName: string, title: string | null, content: string): boolean {
  const cleaned = (normalizeCompanyName(companyName) ?? companyName)
    .replace(NAME_NOISE, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')

  const words = cleaned.split(/\s+/).filter((word) => word.length >= 3)
  if (words.length === 0) return false

  const haystack = `${title ?? ''} ${content}`.toLowerCase()

  /*
   * Every distinctive word must appear. "Atlas AI Solutions" matching a page
   * that says only "atlas" is not a match — that is how you attach a mapping
   * company's website to an AI company.
   */
  const distinctive = words.filter((word) => !['and', 'for', 'the'].includes(word))
  return distinctive.every((word) => haystack.includes(word))
}

export type ProbeResult = {
  domain: string
  /** The host we verified, for the audit trail. */
  verifiedVia: string
}

/**
 * Tries candidate hosts until one serves a page that names the company.
 *
 * Returns null rather than a guess, always. A NULL domain is a gap; a wrong
 * domain is a corruption that spreads to every field keyed on it.
 */
export async function probeCompanyDomain(
  companyName: string | null,
  options: { maxFetches?: number } = {},
): Promise<ProbeResult | null> {
  if (!companyName) return null

  const maxFetches = options.maxFetches ?? 4
  const hosts = candidateHosts(companyName)
  if (hosts.length === 0) return null

  let fetches = 0

  for (const host of hosts) {
    if (fetches >= maxFetches) break

    // DNS first: it is far cheaper than a fetch and eliminates most candidates.
    if (!(await resolves(host))) continue

    fetches += 1

    /*
     * `httpPageFetcher` carries the SSRF guard, the LinkedIn ban and the byte
     * ceiling. Probing must not become a second, unguarded way out to the
     * network.
     */
    const page = await httpPageFetcher.fetchPage(`https://${host}`)
    if (isFetchFailure(page)) continue

    if (pageNamesCompany(companyName, page.title, page.content)) {
      return { domain: host, verifiedVia: page.url }
    }
  }

  return null
}
