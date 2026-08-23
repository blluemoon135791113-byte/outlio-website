import 'server-only'

/**
 * Classifying a URL into a KIND, and turning typed facts back into columns.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE EXPORT EMITS ONLY WHAT EXISTS.                                   ║
 * ║                                                                          ║
 * ║  A fixed column per link kind would put `GitHub`, `YouTube`, `Instagram` ║
 * ║  and eight more into every CSV, nearly all of them empty, because a      ║
 * ║  company has three or four of these and not eleven.                      ║
 * ║                                                                          ║
 * ║  Instead the columns are DERIVED from the batch: whichever kinds are     ║
 * ║  actually present get a column, in a fixed order so an import mapping is ║
 * ║  still buildable. The same rule the CSV writer already applies to empty  ║
 * ║  columns, moved one level earlier so the column is never created.        ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

export const LINK_KINDS = [
  'website',
  'landing',
  'product',
  'pricing',
  'careers',
  'about',
  'blog',
  'github',
  'x',
  'youtube',
  'instagram',
  'facebook',
  'app_store',
  'play_store',
  'crunchbase',
  'partner',
  'press',
  'other',
] as const

export type LinkKind = (typeof LINK_KINDS)[number]

/** Human labels, used as CSV headers when a kind is present. */
export const LINK_LABEL: Record<LinkKind, string> = {
  website: 'Website',
  landing: 'Landing Page',
  product: 'Product Page',
  pricing: 'Pricing Page',
  careers: 'Careers Page',
  about: 'About Page',
  blog: 'Blog',
  github: 'GitHub',
  x: 'X / Twitter',
  youtube: 'YouTube',
  instagram: 'Instagram',
  facebook: 'Facebook',
  app_store: 'App Store',
  play_store: 'Play Store',
  crunchbase: 'Crunchbase',
  partner: 'Partner Link',
  press: 'Press',
  other: 'Other Link',
}

/**
 * Host patterns first — a host is definitive where a path is suggestive.
 *
 * `github.com/acme` IS a GitHub link regardless of path; `/pricing` on an
 * unknown host is a pricing page only by convention.
 */
const HOST_KINDS: Array<[LinkKind, RegExp]> = [
  ['github', /(^|\.)github\.(com|io)$/i],
  ['x', /(^|\.)(twitter\.com|x\.com)$/i],
  ['youtube', /(^|\.)(youtube\.com|youtu\.be)$/i],
  ['instagram', /(^|\.)instagram\.com$/i],
  ['facebook', /(^|\.)facebook\.com$/i],
  ['crunchbase', /(^|\.)crunchbase\.com$/i],
  ['app_store', /(^|\.)apps\.apple\.com$/i],
  ['play_store', /(^|\.)play\.google\.com$/i],
]

/** Path patterns, applied only when the host says nothing. */
const PATH_KINDS: Array<[LinkKind, RegExp]> = [
  ['pricing', /\/pricing|\/plans(\/|$)/i],
  ['careers', /\/careers?|\/jobs?(\/|$)|\/join-us/i],
  ['about', /\/about|\/company(\/|$)|\/team(\/|$)/i],
  ['blog', /\/blog|\/news|\/press/i],
  ['product', /\/product|\/features|\/platform/i],
  ['landing', /\/launch|\/get-started|\/demo/i],
  ['partner', /\/partners?/i],
]

/**
 * Hosts that are never a company's own presence.
 *
 * ⚠️ A SHORTENER IS NOT A LINK. `lnkd.in/abc` resolves somewhere useful but
 * tells us nothing on its own, and stored as a company's link it would be a
 * dead reference the moment the shortener expires.
 */
const NOT_A_LINK = [
  /(^|\.)linkedin\.com$/i,
  /(^|\.)licdn\.com$/i,
  /(^|\.)lnkd\.in$/i,
  /(^|\.)bit\.ly$/i,
  /(^|\.)t\.co$/i,
]

export type ClassifiedLink = { kind: LinkKind; url: string; host: string }

/**
 * Turns a URL into a typed link, or rejects it.
 *
 * `ownDomain` promotes the company's own pages: `/pricing` on their site is a
 * pricing page; the same path on a third party is somebody else's.
 */
export function classifyLink(raw: string, ownDomain: string | null = null): ClassifiedLink | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  // Stored and later rendered as a link, so the scheme is a security question.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (!host.includes('.')) return null
  if (NOT_A_LINK.some((pattern) => pattern.test(host))) return null

  for (const [kind, pattern] of HOST_KINDS) {
    if (pattern.test(host)) return { kind, url: url.toString(), host }
  }

  const own = ownDomain?.toLowerCase().replace(/^www\./, '') ?? null
  const isOwn = own !== null && (host === own || host.endsWith(`.${own}`))

  for (const [kind, pattern] of PATH_KINDS) {
    if (pattern.test(url.pathname)) {
      /*
       * A `/partners` page on someone else's site is a page that mentions
       * partners, not this company's partner link.
       */
      if (kind === 'partner' && !isOwn) continue
      return { kind, url: url.toString(), host }
    }
  }

  // The company's own root is its website; anything else is unclassified.
  if (isOwn) {
    return {
      kind: url.pathname === '/' || url.pathname === '' ? 'website' : 'landing',
      url: url.toString(),
      host,
    }
  }

  return { kind: 'other', url: url.toString(), host }
}

/**
 * Which link columns a batch deserves.
 *
 * ⚠️ DERIVED FROM THE DATA, NOT DECLARED. Returns the kinds actually present,
 * in `LINK_KINDS` order so the column order is stable across exports even as
 * membership changes — an import mapping built on the columns that appear
 * keeps working, which a set ordered by frequency would break every run.
 */
export function presentKinds(links: readonly { kind: string }[]): LinkKind[] {
  const present = new Set(links.map((link) => link.kind))
  return LINK_KINDS.filter((kind) => present.has(kind))
}

/**
 * Collapses one company's links into `kind → url` for export.
 *
 * A company can have several links of a kind — three product pages, two
 * partner links. The export takes the FIRST, and the rest stay queryable in
 * `company_links`. A CSV cell holding five URLs is a cell nobody can use.
 */
export function linksByKind(
  links: readonly { kind: string; url: string }[],
): Partial<Record<LinkKind, string>> {
  const out: Partial<Record<LinkKind, string>> = {}
  for (const link of links) {
    const kind = link.kind as LinkKind
    if (!LINK_KINDS.includes(kind)) continue
    out[kind] ??= link.url
  }
  return out
}
