/**
 * Sales Navigator COMPANY page adapter.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THIS DOES NOT NAVIGATE. IT NEVER WILL.                               ║
 * ║                                                                          ║
 * ║  CLAUDE.md rule 1 forbids automated navigation of any kind. Nothing here ║
 * ║  opens a page, clicks a link, or follows one. It reads a company page    ║
 * ║  the USER chose to open, during a session the USER started — the same    ║
 * ║  standing this product has always had for a saved results page.          ║
 * ║                                                                          ║
 * ║  If you are ever tempted to add "and then visit each company", that is   ║
 * ║  the line, and it is not negotiable.                                     ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * WHY THIS EXISTS. The results page only exposes a company's website through a
 * hovercard, which LinkedIn renders inconsistently. The company page carries it
 * as a labelled field. When a user is researching an account anyway, that visit
 * can fill in a column that would otherwise stay empty.
 *
 * WHAT IT SENDS. Three small values — the company's Sales Navigator id, its
 * name, and its website. Not the page. There is no HTML upload, no page count
 * and no credit consumed: this is not a capture, and billing it as one would be
 * charging for a page that yields no leads.
 */

/** `/sales/company/1035` → `1035`. Numeric ids only; anything else is not one. */
export function companyIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (!/(^|\.)linkedin\.com$/i.test(parsed.hostname)) return null

    const match = /^\/sales\/company\/(\d{1,20})(?:\/|$)/i.exec(parsed.pathname)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

/** Whether this is a company page we can read. */
export function isCompanyPage(url: string): boolean {
  return companyIdFromUrl(url) !== null
}

/**
 * Hosts that are never the company's own website.
 *
 * LinkedIn's own domains obviously, but also the URL shorteners and tracking
 * wrappers that appear in profile fields. `lnkd.in` in particular resolves
 * somewhere useful but tells us nothing on its own, and storing it as a domain
 * would poison company identity matching.
 */
const NOT_A_COMPANY_SITE = [
  /(^|\.)linkedin\.com$/i,
  /(^|\.)lnkd\.in$/i,
  /(^|\.)licdn\.com$/i,
  /(^|\.)bit\.ly$/i,
  /(^|\.)t\.co$/i,
]

/**
 * Normalises a candidate href into a company website, or rejects it.
 *
 * PURE, so every rejection is testable without a browser.
 *
 * ⚠️ `javascript:` and `data:` are rejected explicitly. This value ends up
 * stored and later rendered as a link; the same refinement guards evidence
 * `source_url`, and for the same reason.
 */
export function normaliseWebsite(href: string | null | undefined, base?: string): string | null {
  if (!href) return null

  try {
    const url = new URL(href, base)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (NOT_A_COMPANY_SITE.some((pattern) => pattern.test(url.hostname))) return null
    // A bare hostname with no dot is not a public site.
    if (!url.hostname.includes('.')) return null

    return url.toString()
  } catch {
    return null
  }
}

type Doc = Pick<Document, 'querySelectorAll' | 'querySelector'>

/**
 * The company's website, read from its own page.
 *
 * Tries the labelled field first and falls back to any external link in the
 * company's top card. The fallback is bounded to that card deliberately: an
 * external link anywhere on the page could be an employee's personal site or a
 * link in a posted update, and attributing one of those to the company would be
 * a confident, wrong answer.
 */
export function readCompanyWebsite(doc: Doc, baseUrl: string): string | null {
  const LABELLED = [
    'a[data-control-name="visit_company_website"]',
    'a[data-test-company-website]',
    '[data-anonymize="company-website"] a[href]',
    '[data-anonymize="company-website"]',
  ]

  for (const selector of LABELLED) {
    const element = doc.querySelector(selector)
    if (!element) continue

    const href =
      element.getAttribute('href') ?? element.textContent?.trim() ?? null
    const website = normaliseWebsite(href, baseUrl)
    if (website) return website
  }

  // Bounded fallback: the company's own top card, never the whole page.
  const CARDS = ['[data-test-company-card]', '.company-top-card', 'main section:first-of-type']

  for (const cardSelector of CARDS) {
    const card = doc.querySelector(cardSelector)
    if (!card) continue

    for (const anchor of Array.from(card.querySelectorAll('a[href]'))) {
      const website = normaliseWebsite(anchor.getAttribute('href'), baseUrl)
      if (website) return website
    }
  }

  return null
}

/** The company's name, used only to make the dashboard message readable. */
export function readCompanyName(doc: Doc): string | null {
  for (const selector of ['[data-anonymize="company-name"]', 'main h1', '[role="main"] h1']) {
    const value = doc.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim()
    if (value && value.length <= 200) return value
  }
  return null
}

export type CompanyObservation = {
  companyId: string
  companyName: string | null
  websiteUrl: string
}

/**
 * Everything worth sending from a company page, or `null`.
 *
 * `null` when there is no website to report — a company page with no site is a
 * fact about the company, but not one worth a request, and sending an empty
 * observation would let a later read mistake "we saw nothing" for "we looked".
 */
export function readCompanyPage(doc: Doc, url: string): CompanyObservation | null {
  const companyId = companyIdFromUrl(url)
  if (!companyId) return null

  const websiteUrl = readCompanyWebsite(doc, url)
  if (!websiteUrl) return null

  return { companyId, companyName: readCompanyName(doc), websiteUrl }
}
