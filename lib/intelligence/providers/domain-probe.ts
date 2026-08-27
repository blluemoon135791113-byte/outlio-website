import 'server-only'

/**
 * Finds a company's website by PROBING candidate hosts and verifying content.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 *  FREE, NO KEY, NO SEARCH API. The last line of the domain waterfall: when
 *  Wikidata has never heard of the company and no search provider is
 *  available, we try the hosts the NAME implies and check what answers.
 *
 *  ⚠️ A WRONG DOMAIN IS WORSE THAN NO DOMAIN (see domain-discovery.ts). Two
 *  rules keep a probe honest:
 *
 *    1. VERIFIED BY CONTENT, NOT BY RESOLUTION. A host answering is nothing —
 *       parked domains answer all day. The page must actually carry the
 *       company's own normalized name before the domain is believed.
 *    2. AMBIGUITY REFUSES. If `acmesystems.com` AND `acmesystems.io` both
 *       verify, we do not know which one the company owns, and either answer
 *       would be a guess with real blast radius: identity precedence means a
 *       wrong domain can merge two different companies.
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import { normalizeCompanyName, normalizeDomain } from '@/lib/companies/normalize'
import { requestTextWithMeta } from '@/lib/intelligence/http'
import { expiresAtFor } from '@/lib/intelligence/ttl'
import {
  type CompanyEntity,
  type IntelligenceProvider,
  type NormalizedEvidence,
} from '@/lib/intelligence/types'

/** Bounded: a probe sweep must never dominate a research run. */
const PROBE_TIMEOUT_MS = 6_000
/**
 * Identity lives in the title, meta description and first text of a page, so
 * the head is all we need — and modern homepages blow past any small cap.
 * Truncating (not failing) is therefore the correct reading mode here; the
 * shared HTTP layer stops at the cap and cancels the rest of the body.
 */
const PROBE_MAX_BYTES = 200_000

/**
 * Candidate hosts implied by the name, most likely first.
 *
 * PURE. Capped at four sweeps so the worst case stays inside one research
 * step: flat and hyphenated forms over `.com`, then `.io`, then `.co.uk`.
 */
export function candidateHosts(companyName: string | null): string[] {
  const normalized = normalizeCompanyName(companyName)
  if (!normalized) return []

  const words = normalized.split(' ')
  // A single word gains nothing from a hyphenated twin.
  const forms = [...new Set([words.join(''), words.join('-')])]

  const tlds = words.length > 1 ? ['com', 'io', 'co.uk'] : ['com', 'co.uk']

  const hosts: string[] = []
  for (const tld of tlds) {
    for (const form of forms) {
      if (hosts.length >= 4) return hosts
      hosts.push(`${form}.${tld}`)
    }
  }
  return hosts
}

/**
 * Decides whether a fetched page is really this company speaking about itself.
 *
 * PURE, so every parked page and lookalike is testable without a network.
 *
 * The FULL normalized name must appear in the page text (compacted the same
 * way, so spacing and punctuation differences do not matter). A bare brand
 * fragment would match every page that mentions the sector once.
 */
export function verifyPageMentionsCompany(
  companyName: string | null,
  pageText: string | null,
): boolean {
  const target = normalizeCompanyName(companyName)
  // Four-letter brands ("Acme") appear inside too many unrelated pages to be
  // an identity; five is the floor at which a match starts meaning something.
  if (!target || target.length < 5) return false

  if (!pageText) return false

  // Same normalization on both sides, whitespace fully removed: "Acme Systems"
  // must survive as `acmesystems` inside whatever the page actually says.
  const haystack = pageText
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
  if (!haystack) return false

  const needle = target.replace(/[^\p{L}\p{N}]+/gu, '')
  return haystack.includes(needle)
}

export type ProbedDomain = {
  domain: string
  sourceUrl: string
}

/**
 * Whether a response actually came from the host we asked, for ownership
 * purposes.
 *
 * PURE. `vercel.co.uk` redirects to `vercel.com` and inherits its content —
 * counting that as vercel.co.uk's own verification would manufacture a second
 * "verified" identity out of one real site. A redirect to a www-variant of the
 * same host IS the host speaking; anything else adds no evidence about the
 * candidate and is skipped rather than counted.
 */
export function servedDirectly(host: string, finalUrl: string | null | undefined): boolean {
  if (!finalUrl) return true

  const final = normalizeDomain(finalUrl)
  if (!final) return true

  return final.replace(/^www\./, '') === host.replace(/^www\./, '')
}

async function probeHost(host: string, companyName: string): Promise<ProbedDomain | null> {
  let text: string
  let finalUrl: string
  try {
    const response = await requestTextWithMeta({
      url: `https://${host}/`,
      method: 'GET',
      timeoutMs: PROBE_TIMEOUT_MS,
      maxBytes: PROBE_MAX_BYTES,
      truncateWhenTooLarge: true,
    })
    text = response.text
    finalUrl = response.finalUrl
  } catch {
    // Unresolvable, unreachable, or hostile — none of these are facts about
    // the company, and the next candidate decides nothing differently.
    return null
  }

  // The redirect case: this host merely handed us somebody else's page.
  if (!servedDirectly(host, finalUrl)) return null

  if (!verifyPageMentionsCompany(companyName, text)) return null

  // normalizeDomain re-validates what we constructed, keeping the stored value
  // inside the same identity space as every other domain source.
  const domain = normalizeDomain(host)
  return domain ? { domain, sourceUrl: `https://${host}/` } : null
}

export const domainProbeProvider: IntelligenceProvider<ProbedDomain | null> = {
  name: 'domain-probe',
  category: 'company_profile',

  canHandle: (task) =>
    task.entity.type === 'company' &&
    task.fields.includes('company_domain') &&
    // Nothing to discover if the capture already gave us one.
    !task.entity.domain &&
    Boolean((task.entity as CompanyEntity).name),

  estimateCost: async () => 0,

  execute: async (task) => {
    const company = task.entity as CompanyEntity
    if (!company.name) return null

    let verified: ProbedDomain | null = null
    for (const host of candidateHosts(company.name)) {
      const result = await probeHost(host, company.name)
      if (!result) continue

      if (verified && result.domain !== verified.domain) {
        // Two different hosts verified equally. We do not know, so we refuse.
        return null
      }
      verified ??= result
    }

    return verified
  },

  normalize: (result, task): NormalizedEvidence[] => {
    if (!result) return []

    const retrievedAt = new Date()
    return [
      {
        field: 'company_domain',
        entityType: 'company',
        entityId: task.entity.id,
        value: { domain: result.domain },
        sourceProvider: 'domain-probe',
        sourceUrl: result.sourceUrl,
        // The page is the company's own voice, but the NAME-TO-SITE match is
        // our observation — never rated above MEDIUM, and it loses the
        // waterfall to every stated-fact source ahead of it.
        sourceConfidence: 'medium',
        confidence: 0.7,
        retrievedAt: retrievedAt.toISOString(),
        expiresAt: expiresAtFor('company_domain', retrievedAt)?.toISOString() ?? null,
      },
    ]
  },
}
