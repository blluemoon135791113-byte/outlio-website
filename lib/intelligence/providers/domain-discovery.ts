import 'server-only'

/**
 * Finds a company's official website from its name.
 *
 * ⚠️ THIS IS LOAD-BEARING ON REAL DATA. Sales Navigator captures rarely expose
 * a company website: on the first 2,088 linked leads in production, `domain`
 * identified exactly ZERO companies — every match came through the LinkedIn
 * company page. Website intelligence and tech-stack detection both need a
 * domain, so without this step those two categories can never run.
 *
 * ⚠️ A WRONG DOMAIN IS WORSE THAN NO DOMAIN. It becomes the company's primary
 * identity, so a bad guess attaches another company's funding, headcount and
 * tech stack to these leads — and, because the domain outranks the LinkedIn URL
 * in identity precedence, it can merge two genuinely different companies. The
 * scoring below is therefore deliberately conservative and returns `null`
 * rather than a plausible-looking guess.
 */
import { normalizeCompanyName, normalizeDomain } from '@/lib/companies/normalize'
import { expiresAtFor } from '@/lib/intelligence/ttl'
import {
  type CompanyEntity,
  type IntelligenceProvider,
  type NormalizedEvidence,
  type ResearchTask,
} from '@/lib/intelligence/types'
import { hasTavilyCredentials, tavilySearch, type SearchResult } from './tavily'

/**
 * Minimum score to accept a domain. Reached only by a real name-to-domain
 * correspondence, never by search ranking alone — being first for a company's
 * name proves popularity, not ownership.
 */
const ACCEPT_THRESHOLD = 5

/**
 * Hosts that rank highly for a company name but are never its website.
 * `normalizeDomain` already rejects mailbox and profile hosts; these are the
 * aggregators and directories that would otherwise win on ranking alone.
 */
const NEVER_A_COMPANY_SITE = new Set([
  'crunchbase.com',
  'pitchbook.com',
  'bloomberg.com',
  'wikipedia.org',
  'glassdoor.com',
  'indeed.com',
  'ziprecruiter.com',
  'facebook.com',
  'instagram.com',
  'x.com',
  'twitter.com',
  'youtube.com',
  'tiktok.com',
  'github.com',
  'medium.com',
  'notion.site',
  'apollo.io',
  'zoominfo.com',
  'rocketreach.co',
  'signalhire.com',
  'lusha.com',
  'owler.com',
  'dnb.com',
  'trustpilot.com',
  'g2.com',
  'capterra.com',
  'producthunt.com',
  'ycombinator.com',
])

export type DomainCandidate = {
  domain: string
  score: number
  sourceUrl: string
}

/** Strips a leading `www` and returns the registrable label, e.g. `acme`. */
function domainLabel(domain: string): string {
  return domain.split('.')[0] ?? ''
}

function compact(value: string | null): string {
  return value ? value.replace(/\s+/g, '') : ''
}

/**
 * Picks the company's own website from search results, or nothing.
 *
 * PURE — the whole decision is testable against recorded results.
 *
 * Scoring rewards the domain LOOKING LIKE THE COMPANY NAME, because that is the
 * only signal here that indicates ownership rather than mere relevance.
 */
export function pickCompanyDomain(
  companyName: string | null,
  results: readonly SearchResult[],
): DomainCandidate | null {
  const normalizedName = normalizeCompanyName(companyName)
  if (!normalizedName) return null

  const target = compact(normalizedName)
  const byDomain = new Map<
    string,
    { score: number; nameScore: number; sourceUrl: string; hits: number }
  >()

  results.forEach((result, index) => {
    const domain = normalizeDomain(result.url)
    if (!domain) return

    // Reject the aggregator, and any subdomain of it.
    const registrable = domain.split('.').slice(-2).join('.')
    if (NEVER_A_COMPANY_SITE.has(domain) || NEVER_A_COMPANY_SITE.has(registrable)) return

    const label = domainLabel(domain)
    const flatLabel = label.replace(/-/g, '')

    /*
     * How well the DOMAIN ITSELF corresponds to the company name. Kept separate
     * from the ranking bonus below, because only this component is evidence of
     * ownership — and only this component may decide between two candidates.
     */
    let nameScore = 0
    if (flatLabel === target) {
      // `acme systems` → `acmesystems.com`. As close to proof as search gets.
      nameScore = 6
    } else if (target.startsWith(flatLabel) && flatLabel.length >= 4) {
      // `acme systems` → `acme.com`. Common and usually right.
      nameScore = 4
    } else if (flatLabel.startsWith(target) && target.length >= 4) {
      // `acme` → `acmehq.com`.
      nameScore = 3
    }

    // Position is a tiebreak on an already-qualifying candidate, never a
    // qualification in itself.
    const score = nameScore + (index === 0 ? 1 : 0)

    const existing = byDomain.get(domain)
    if (existing) {
      existing.hits += 1
      // Several results on one host corroborates that it is a real site rather
      // than a stray mention.
      existing.score = Math.max(existing.score, score) + 1
      existing.nameScore = Math.max(existing.nameScore, nameScore)
    } else {
      byDomain.set(domain, { score, nameScore, sourceUrl: result.url, hits: 1 })
    }
  })

  const ranked = [...byDomain.entries()]
    .map(([domain, entry]) => ({ domain, ...entry }))
    .sort((a, b) => b.score - a.score)

  const best = ranked[0]
  if (!best || best.score < ACCEPT_THRESHOLD) return null

  /*
   * ⚠️ AMBIGUITY CHECK, ON THE NAME SCORE ONLY.
   *
   * `acme.com` and `acme.io` correspond to the name equally well, so nothing
   * here can tell which one the company owns — and the search ranking must not
   * be allowed to break that tie, because being listed first is popularity, not
   * ownership. Two candidates matching the name equally well means we do not
   * know, and returning either would be a guess with the blast radius described
   * at the top of this file.
   */
  const equallyGoodMatch = ranked.some(
    (candidate) => candidate.domain !== best.domain && candidate.nameScore >= best.nameScore,
  )
  if (equallyGoodMatch) return null

  return { domain: best.domain, score: best.score, sourceUrl: best.sourceUrl }
}

/** Score → reported confidence. Capped: this is inference over search results. */
function confidenceFor(score: number): number {
  if (score >= 7) return 0.85
  if (score >= 6) return 0.8
  return 0.7
}

export const domainDiscoveryProvider: IntelligenceProvider<DomainCandidate | null> = {
  name: 'tavily-domain-discovery',
  category: 'company_profile',

  canHandle: (task) =>
    task.entity.type === 'company' &&
    task.fields.includes('company_domain') &&
    // Nothing to discover if the capture already gave us one.
    !task.entity.domain &&
    Boolean(task.entity.name) &&
    hasTavilyCredentials(),

  estimateCost: async () => 1_000, // ~$0.001 per basic Tavily search.

  execute: async (task: ResearchTask) => {
    const company = task.entity as CompanyEntity
    const results = await tavilySearch({
      query: `${company.name} official company website`,
      maxResults: 8,
    })
    return pickCompanyDomain(company.name, results)
  },

  normalize: (candidate, task): NormalizedEvidence[] => {
    if (!candidate) return []

    const retrievedAt = new Date()
    return [
      {
        field: 'company_domain',
        entityType: 'company',
        entityId: task.entity.id,
        value: { domain: candidate.domain },
        sourceProvider: 'tavily-domain-discovery',
        sourceUrl: candidate.sourceUrl,
        // MEDIUM, never HIGH: the page is the company's own, but the MATCH
        // between name and page is our inference, not the company's statement.
        sourceConfidence: 'medium',
        confidence: confidenceFor(candidate.score),
        retrievedAt: retrievedAt.toISOString(),
        expiresAt: expiresAtFor('company_domain', retrievedAt)?.toISOString() ?? null,
      },
    ]
  },
}
