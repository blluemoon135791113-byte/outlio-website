import 'server-only'

/**
 * The company's real domain — read if we have it, found and STORED if not.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE DOMAIN IS WHAT MAKES SEARCH PRECISE.                             ║
 * ║                                                                          ║
 * ║  Without it, a question about "Atlas AI Solutions" searched the name and ║
 * ║  came back with atlasai.uk and atlasaisolutions.org — DIFFERENT          ║
 * ║  COMPANIES that happen to share a name. Evidence from the wrong company  ║
 * ║  is worse than no evidence: it is confidently, specifically wrong.       ║
 * ║                                                                          ║
 * ║  With it, the planner can scope queries to the site and source           ║
 * ║  classification can recognise the company's own pages as primary.        ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ RESOLVED ONCE PER COMPANY, NEVER PER LEAD. 1,074 leads sit on 2,094
 * companies; discovering per lead would repeat the same search for every
 * colleague. `companies.domain` is the store, so ten leads at one company
 * share one lookup — and every later question, for any of them, skips it.
 */
import { looksLikeOwnDomain } from '@/lib/hubble/source-quality'
import { pickCompanyDomain } from '@/lib/intelligence/providers/domain-discovery'
import { resolveSearchProvider } from '@/lib/hubble/providers/search'
import { createAdminClient } from '@/lib/supabase/admin'

export type ResolvedDomain = {
  domain: string
  /** 'stored' costs nothing; 'discovered' cost a search and has been saved. */
  origin: 'stored' | 'discovered'
}

/**
 * Reads `companies.domain`, or finds it and writes it back.
 *
 * Returns null rather than a guess. A WRONG domain is worse than none: it
 * becomes the company's identity, so it would attach another company's
 * funding, headcount and staff to these leads — and `pickCompanyDomain` is
 * deliberately conservative for exactly that reason.
 */
export async function resolveCompanyDomain(
  userId: string,
  companyId: string | null,
  companyName: string | null,
  deadlineAt?: number,
): Promise<ResolvedDomain | null> {
  if (!companyId || !companyName) return null

  const supabase = createAdminClient()

  /*
   * ⚠️ Scoped by user_id. The service role bypasses RLS, so this is the
   * access control — a company row is reachable only through its owner.
   */
  const { data: company } = await supabase
    .from('companies')
    .select('id, domain')
    .eq('user_id', userId)
    .eq('id', companyId)
    .maybeSingle()

  if (!company) return null
  if (company.domain) return { domain: company.domain, origin: 'stored' }

  const search = resolveSearchProvider()
  if (!search.isConfigured()) return null

  /*
   * The company's name, plus the words a company's own site carries and a
   * directory listing usually does not.
   */
  const hits = await search.search(`${companyName} official website`, 8, { deadlineAt })
  if (hits.length === 0) return null

  const candidate = pickCompanyDomain(
    companyName,
    hits.map((hit) => ({
      title: hit.title ?? '',
      url: hit.url,
      content: hit.snippet ?? '',
      score: 0,
      publishedDate: hit.publishedDate,
    })),
  )

  if (!candidate) return null

  /*
   * Written back so this search never happens again for this company — for
   * this lead or any of their colleagues.
   *
   * Guarded on `domain is null`: another request may have resolved it
   * concurrently, and the first answer wins rather than being overwritten.
   */
  await supabase
    .from('companies')
    .update({ domain: candidate.domain } as never)
    .eq('user_id', userId)
    .eq('id', companyId)
    .is('domain', null)

  return { domain: candidate.domain, origin: 'discovered' }
}

/**
 * Learns the domain from pages Hubble actually read and cited.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ A STRONGER SIGNAL THAN SEARCH RANKING, AND IT COSTS NOTHING.         ║
 * ║                                                                          ║
 * ║  `pickCompanyDomain` scores search results, and is conservative because  ║
 * ║  a wrong domain becomes the company's identity. That conservatism has a  ║
 * ║  cost: for "Atlas AI Solutions" it refused `atlasai.co` — which is       ║
 * ║  genuinely theirs, and which Hubble had already fetched, read, and       ║
 * ║  answered a question from minutes earlier.                               ║
 * ║                                                                          ║
 * ║  Being CITED is better evidence than ranking first. It means the page    ║
 * ║  was retrieved, its content was relevant to a question about this        ║
 * ║  company, and the host independently matches the company's name. Search  ║
 * ║  ranking proves popularity; this proves correspondence.                  ║
 * ║                                                                          ║
 * ║  Both conditions are required. A cited page on a host that does NOT      ║
 * ║  match the name is just a good source, not the company's website.        ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
export async function learnDomainFromSources(
  userId: string,
  companyId: string | null,
  companyName: string | null,
  sourceUrls: readonly string[],
): Promise<string | null> {
  if (!companyId || !companyName || sourceUrls.length === 0) return null

  for (const url of sourceUrls) {
    let host: string
    try {
      host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    } catch {
      continue
    }

    if (!looksLikeOwnDomain(host, companyName)) continue

    const supabase = createAdminClient()
    /*
     * `is('domain', null)` is the whole safety story: this only ever FILLS a
     * gap. A domain established by any other means is never overwritten by an
     * inference, however confident.
     */
    const { data } = await supabase
      .from('companies')
      .update({ domain: host } as never)
      .eq('user_id', userId)
      .eq('id', companyId)
      .is('domain', null)
      .select('id')

    return (data?.length ?? 0) > 0 ? host : null
  }

  return null
}

/**
 * Scopes a search query to the company's own site.
 *
 * ⚠️ USED FOR ONE EXTRA QUERY, NOT ALL OF THEM. `site:` finds what the company
 * says about itself, which is authoritative for products, pricing and people —
 * and useless for funding, news or anything they would rather not publish. The
 * unscoped queries still run alongside it.
 */
export function siteScopedQuery(question: string, domain: string): string {
  const words = question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .slice(0, 6)
    .join(' ')

  return `site:${domain} ${words}`.trim()
}
