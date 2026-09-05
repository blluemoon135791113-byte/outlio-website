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

/** Legal suffixes and filler that are not part of a company's identity. */
const NAME_NOISE =
  /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|plc|corp|corporation|gmbh|bv|nv|sa|ag|pty|co|company|holdings|group|labs|technologies|technology|the)\b/gi

/** `Atlas AI Solutions` → `atlasaisolutions`. */
function compress(value: string): string {
  return value.replace(NAME_NOISE, ' ').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Whether a host is plausibly the company's own site, judged by NAME.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ WITHOUT THIS, MOST ANSWERS ARE UNDER-CONFIDENT.                      ║
 * ║                                                                          ║
 * ║  A real run answered "what does this company do" entirely from           ║
 * ║  atlasai.co — the company's own website — and reported 0.6 confidence,   ║
 * ║  because the lead had no `company_website_url` stored, so nothing could  ║
 * ║  tell that atlasai.co WAS them. Most extracted leads have no domain      ║
 * ║  until enrichment runs, so that was nearly every answer.                 ║
 * ║                                                                          ║
 * ║  Comparing the compressed name to the registrable label recovers it:     ║
 * ║  "Atlas AI Solutions" → `atlasaisolutions`, host `atlasai.co` → NN       ║
 * ║  `atlasai`, one a prefix of the other. Bounded at 5 characters so short  ║
 * ║  names cannot collide their way to `primary`.                            ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
export function looksLikeOwnDomain(host: string, companyName: string | null): boolean {
  if (!companyName) return false

  const name = compress(companyName)
  // Short names ("Bun", "Arc") collide with unrelated domains far too easily.
  if (name.length < 5) return false

  const label = compress(host.replace(/^www\./, '').split('.')[0] ?? '')
  if (label.length < 5) return false

  return name.startsWith(label) || label.startsWith(name)
}

/**
 * Which tier a URL belongs to.
 *
 * `companyDomain` promotes the company's OWN site to `primary`: for "what do
 * they sell" or "what does it cost", nobody outranks the company itself.
 */
export function classifySource(
  url: string,
  companyDomain: string | null,
  /** Falls back to name matching when no domain is stored on the lead. */
  companyName: string | null = null,
): SourceTier {
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

  /*
   * ⚠️ Checked AFTER the known domain but BEFORE every other tier — except
   * the broker list, which still wins: a broker page carrying the company's
   * name in its host is not the company.
   */
  if (!BROKERS.some((pattern) => pattern.test(host)) && looksLikeOwnDomain(host, companyName)) {
    return 'primary'
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

export function sourceWeight(
  url: string,
  companyDomain: string | null,
  companyName: string | null = null,
): number {
  return TIER_WEIGHT[classifySource(url, companyDomain, companyName)]
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
export function confidenceCeiling(
  urls: readonly string[],
  companyDomain: string | null,
  companyName: string | null = null,
): number {
  if (urls.length === 0) return 0.3

  const tiers = urls.map((url) => classifySource(url, companyDomain, companyName))

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
export function canCorroborate(
  urls: readonly string[],
  companyDomain: string | null,
  companyName: string | null = null,
): boolean {
  const hosts = new Set<string>()

  for (const url of urls) {
    if (classifySource(url, companyDomain, companyName) === 'broker') continue
    try {
      hosts.add(new URL(url).hostname.toLowerCase().replace(/^www\./, ''))
    } catch {
      // Not a URL, so not a source.
    }
  }

  return hosts.size >= 2
}
