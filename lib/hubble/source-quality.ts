import 'server-only'

/**
 * How much to trust a source, by where it came from.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ WHY THIS EXISTS — A REAL FAILURE, NOT A HYPOTHETICAL ONE.            ║
 * ║                                                                          ║
 * ║  Asked "who is the CEO of Anthropic", retrieval ranked a contact-broker  ║
 * ║  page FIRST. It said "The CEO of Anthropic is Sam McCandlish". That is   ║
 * ║  wrong — Tracxn and Wikipedia both say Dario Amodei, and they ranked     ║
 * ║  below it.                                                               ║
 * ║                                                                          ║
 * ║  It won because relevance scoring rewards exactly what those pages are   ║
 * ║  built to do: they auto-generate FAQ blocks echoing the question         ║
 * ║  verbatim ("Who is the CEO of X?"), so they match a user's phrasing      ║
 * ║  better than the primary source that simply states the fact in prose.    ║
 * ║  Their data is scraped, stale, and frequently wrong.                     ║
 * ║                                                                          ║
 * ║  Relevance is not credibility. Ranking on relevance alone systematically ║
 * ║  promotes the least reliable sources on the web for precisely the        ║
 * ║  questions a sales tool asks.                                            ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

/**
 * Contact and company-data brokers.
 *
 * Not banned — occasionally a broker page is the only thing that mentions a
 * small company at all. Heavily discounted, so it wins only when nothing
 * better exists, and never outranks a primary source that says otherwise.
 */
const BROKERS = [
  /(^|\.)seamless\.ai$/i,
  /(^|\.)rocketreach\.co$/i,
  /(^|\.)zoominfo\.com$/i,
  /(^|\.)apollo\.io$/i,
  /(^|\.)signalhire\.com$/i,
  /(^|\.)lead411\.com$/i,
  /(^|\.)leadiq\.com$/i,
  /(^|\.)datanyze\.com$/i,
  /(^|\.)kaspr\.io$/i,
  /(^|\.)lusha\.com$/i,
  /(^|\.)contactout\.com$/i,
  /(^|\.)hunter\.io$/i,
  /(^|\.)clearbit\.com$/i,
  /(^|\.)cbinsights\.com$/i,
  /(^|\.)owler\.com$/i,
  /(^|\.)zippia\.com$/i,
  /(^|\.)glassdoor\./i,
  /(^|\.)indeed\./i,
  /(^|\.)6sense\.com$/i,
]

/** Official registries and filings. The highest-quality public facts there are. */
const OFFICIAL = [
  /(^|\.)sec\.gov$/i,
  /(^|\.)gov\.uk$/i,
  /(^|\.)companieshouse\.gov\.uk$/i,
  /\.gov$/i,
  /\.gov\.[a-z]{2}$/i,
  /(^|\.)europa\.eu$/i,
]

/** Encyclopaedic and reputable business press. Edited, and correctable. */
const REPUTABLE = [
  /(^|\.)wikipedia\.org$/i,
  /(^|\.)reuters\.com$/i,
  /(^|\.)bloomberg\.com$/i,
  /(^|\.)ft\.com$/i,
  /(^|\.)wsj\.com$/i,
  /(^|\.)techcrunch\.com$/i,
  /(^|\.)theinformation\.com$/i,
  /(^|\.)cnbc\.com$/i,
  /(^|\.)bbc\.(co\.uk|com)$/i,
  /(^|\.)crunchbase\.com$/i,
  /(^|\.)britannica\.com$/i,
  /(^|\.)tracxn\.com$/i,
  /(^|\.)pitchbook\.com$/i,
]

/** User-generated. Real signal sometimes, but never a fact on its own. */
const FORUMS = [/(^|\.)reddit\.com$/i, /(^|\.)quora\.com$/i, /(^|\.)medium\.com$/i, /(^|\.)substack\.com$/i]

export type SourceTier = 'primary' | 'official' | 'reputable' | 'unknown' | 'forum' | 'broker'

/**
 * Which tier a URL belongs to.
 *
 * `companyDomain` promotes the company's OWN site to `primary`: for "what do
 * they sell" or "what does it cost", nobody outranks the company itself.
 */
export function classifySource(url: string, companyDomain: string | null): SourceTier {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return 'unknown'
  }

  if (companyDomain) {
    const own = companyDomain.toLowerCase().replace(/^www\./, '')
    if (host === own || host.endsWith(`.${own}`)) return 'primary'
  }

  if (OFFICIAL.some((pattern) => pattern.test(host))) return 'official'
  // ⚠️ Brokers are checked BEFORE reputable: several are also plausible-looking
  // business-data sites, and the discount must win the tie.
  if (BROKERS.some((pattern) => pattern.test(host))) return 'broker'
  if (REPUTABLE.some((pattern) => pattern.test(host))) return 'reputable'
  if (FORUMS.some((pattern) => pattern.test(host))) return 'forum'

  return 'unknown'
}

/**
 * The multiplier applied to a passage's relevance score.
 *
 * ⚠️ A MULTIPLIER, NOT A FILTER. A broker page that is the only source on a
 * small company still surfaces; it simply cannot outrank a primary source that
 * contradicts it. Removing these domains outright would lose the long tail of
 * companies nobody else writes about.
 */
export const TIER_WEIGHT: Record<SourceTier, number> = {
  primary: 1.25,
  official: 1.2,
  reputable: 1.1,
  unknown: 1.0,
  forum: 0.75,
  // Deliberately severe. This is the tier that produced a confidently wrong
  // CEO and outranked two correct sources while doing it.
  broker: 0.4,
}

export function sourceWeight(url: string, companyDomain: string | null): number {
  return TIER_WEIGHT[classifySource(url, companyDomain)]
}

/**
 * The most confidence an answer may claim, given where its evidence came from.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE DENYLIST DOES NOT GENERALISE. THIS IS WHAT CATCHES THE REST.     ║
 * ║                                                                          ║
 * ║  `BROKERS` names the offenders we know. The web is full of SEO content   ║
 * ║  farms that behave identically — auto-generated FAQ pages echoing the    ║
 * ║  question verbatim, outranking the primary source — and are on no list.  ║
 * ║  A real run surfaced one (`makerstations.io`) immediately after the      ║
 * ║  broker was demoted.                                                     ║
 * ║                                                                          ║
 * ║  Naming them one by one is a losing game. Instead: an answer resting     ║
 * ║  ONLY on sources we cannot vouch for is capped, however certain the      ║
 * ║  model sounds. The user still gets the answer and the links — they just  ║
 * ║  are not told it is near-certain when nothing credible backs it.         ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
export function confidenceCeiling(urls: readonly string[], companyDomain: string | null): number {
  if (urls.length === 0) return 0.3

  const tiers = urls.map((url) => classifySource(url, companyDomain))

  if (tiers.some((tier) => tier === 'primary' || tier === 'official')) return 1
  if (tiers.some((tier) => tier === 'reputable')) return 0.9

  // Nothing we can vouch for: unknown blogs, forums, brokers.
  if (tiers.some((tier) => tier === 'unknown')) return 0.6
  return 0.45
}

/**
 * Whether an answer drawn from these sources deserves `corroborated`.
 *
 * Requires agreement across two DIFFERENT hosts, neither of them a broker.
 * Two pages on one domain are one source, and two brokers are frequently the
 * same scraped record echoed twice — corroboration between them is not
 * corroboration at all.
 */
export function canCorroborate(urls: readonly string[], companyDomain: string | null): boolean {
  const hosts = new Set<string>()

  for (const url of urls) {
    if (classifySource(url, companyDomain) === 'broker') continue
    try {
      hosts.add(new URL(url).hostname.toLowerCase().replace(/^www\./, ''))
    } catch {
      // Not a URL, so not a source.
    }
  }

  return hosts.size >= 2
}
