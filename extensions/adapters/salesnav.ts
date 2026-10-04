/**
 * Sales Navigator results adapter.
 *
 * The ONLY file that knows anything about the page's structure. When the DOM
 * changes — and `docs/SELECTOR_MAP.md` records that it already has once — this
 * is the file that changes. Authentication, the capture loop and the popup do
 * not.
 *
 * ---------------------------------------------------------------------------
 * WHAT WE SEND, AND WHY SO LITTLE
 * ---------------------------------------------------------------------------
 *
 * Not the whole page. We rebuild a minimal document containing just the
 * results list, because:
 *
 *   1. A live LinkedIn page embeds CSRF tokens and session JSON in inline
 *      <script> blocks. Sending the raw DOM would ship credentials we have
 *      promised never to touch. Stripping scripts is a hard requirement, not
 *      an optimisation.
 *   2. EMBER IDS CHANGE ON EVERY RENDER (`SELECTOR_MAP.md` §2). Hashing raw
 *      HTML would give the same page a different hash each time it re-rendered,
 *      so duplicate detection would silently stop working and users would be
 *      billed twice for one page. Dropping `id` makes the hash stable.
 *   3. ~1 MB of markup per page is mostly styling the parser ignores.
 *
 * Parser class hooks ARE kept: the backend anchors rows on
 * `ol.artdeco-list > li.artdeco-list__item`, so stripping those would break the
 * parser. Generated classes, volatile state and executable content are removed.
 */
import type { CaptureOptions, CapturedPage, PageAdapter } from '../core/types'
import { sanitizePageElement, sha256Hex, snapshotUrl } from '../core/page-snapshot'
import { salesNavAccountListAdapter } from './salesnav-account-list'
import { salesNavAccountSearchAdapter } from './salesnav-account-search'
import { companyIdFromUrl, normaliseWebsite } from './salesnav-company'

/** Row anchors, in the order the backend parser tries them. */
const LIST_ROW = 'li.artdeco-list__item'
const TABLE_ROW = 'tr[data-x--people-list--row]'
/** The one stable identity marker on a row. */
const PERSON_NAME = '[data-anonymize="person-name"]'

const CONTAINER_CANDIDATES = ['ol.artdeco-list', 'table', 'main']

function rowCount(): number {
  const rows = document.querySelectorAll(`${LIST_ROW}, ${TABLE_ROW}`)
  let withNames = 0
  rows.forEach((row) => {
    if (row.querySelector(PERSON_NAME)) withNames += 1
  })
  return withNames
}

function resultsContainer(): Element | null {
  // Prefer the tightest container that actually holds rows: `main` is a last
  // resort because it drags in filters and sidebars.
  for (const selector of CONTAINER_CANDIDATES) {
    for (const candidate of Array.from(document.querySelectorAll(selector))) {
      if (candidate.querySelector(PERSON_NAME)) return candidate
    }
  }
  return null
}

/**
 * The company facts LinkedIn renders in a hover card.
 *
 * ⚠️ MATCHED ON SHAPE, NOT POSITION. The card is a stack of unlabelled lines —
 * industry, location, headcount, list count — in an order LinkedIn is free to
 * change. Reading "the third line" would silently return the wrong field after
 * any redesign, so each is recognised by what it looks like: headcount always
 * carries the word "employees", a location carries a comma, and the industry is
 * what remains.
 */
export function companyDetailsFrom(card: ParentNode): {
  industry: string | null
  size: string | null
  headquarters: string | null
} {
  const lines = Array.from(card.querySelectorAll<HTMLElement>('span, div, p'))
    .map((node) => (node.childElementCount === 0 ? (node.textContent ?? '') : ''))
    .map((text) => text.replace(/\s+/g, ' ').trim().replace(/,$/, ''))
    .filter((text) => text.length > 1 && text.length <= 120)

  // The card repeats every value for screen readers.
  const seen = new Set<string>()
  const unique = lines.filter((line) => {
    const key = line.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const size = unique.find((line) => /\bemployees?\b/i.test(line)) ?? null

  // "0 Lists" counts the USER's saved lists, not anything about the company.
  const rest = unique.filter(
    (line) => line !== size && !/\blists?\b/i.test(line) && !/^dismiss$/i.test(line),
  )

  const headquarters = rest.find((line) => /,/.test(line)) ?? null
  const industry = rest.find((line) => line !== headquarters && !/,/.test(line)) ?? null

  return { industry, size, headquarters }
}

/** No layout forcing or interactions: only cards already rendered by the user. */
function isVisible(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (current.hasAttribute('hidden') || current.getAttribute('aria-hidden') === 'true') return false
    const style = window.getComputedStyle(current)
    if (style.display === 'none' || style.visibility === 'hidden') return false
  }
  return true
}

/** Copy labelled facts from an already-visible, identity-matched card to the
 * detached snapshot only. An unrelated tooltip must never enrich every row. */
function copyVisibleCompanyDetails(cleaned: Element): void {
  const cards = Array.from(document.querySelectorAll(
    '[role="tooltip"], .artdeco-hoverable-content, [id*="hovercard"]',
  )).filter(isVisible)

  for (const company of Array.from(cleaned.querySelectorAll('[data-anonymize="company-name"]'))) {
    const id = companyIdFromUrl(company.closest('a')?.getAttribute('href') ?? '')
    if (!id) continue
    const card = cards.find((candidate) => Array.from(candidate.querySelectorAll('a[href]'))
      .some((anchor) => companyIdFromUrl(snapshotUrl(anchor.getAttribute('href') ?? '') ?? '') === id))
    if (!card) continue

    for (const [selector, attribute] of [
      ['[data-anonymize="industry"]', 'data-outlio-company-industry'],
      ['[data-anonymize="company-size"]', 'data-outlio-company-size'],
      ['[data-anonymize="location"]', 'data-outlio-company-hq'],
    ]) {
      const field = card.querySelector(selector!)
      const value = field && isVisible(field) ? field.textContent?.replace(/\s+/g, ' ').trim() : null
      if (value) company.setAttribute(attribute!, value)
    }
    const website = card.querySelector(
      'a[data-control-name="visit_company_website"], a[data-anonymize="company-website"], [data-anonymize="company-website"] a[href]',
    )
    const url = website && isVisible(website)
      ? normaliseWebsite(website.getAttribute('href'), window.location.href) : null
    const safe = url ? snapshotUrl(url) : null
    if (safe) company.setAttribute('data-outlio-company-website', safe)
  }
}

export const salesNavAdapter: PageAdapter = {
  id: 'salesnav',
  sourceType: 'salesnav_lead_results',

  supports(url: string): boolean {
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !/(^|\.)linkedin\.com$/i.test(parsed.hostname)) return false
      // Route boundaries matter: /peopleXYZ is not a results route.
      return /^\/sales\/(search\/people|lists\/people|people)(?:\/|$)/i.test(parsed.pathname)
    } catch {
      return false
    }
  },

  /**
   * Ready means "rows are actually on screen".
   *
   * Sales Navigator renders the shell before the results, so presence of the
   * container is not enough — we require at least one row carrying a person
   * name, which is the same thing the backend parser requires.
   */
  isReady(): boolean {
    return rowCount() > 0
  },

  getPageIdentifier(): string | null {
    const fromUrl = new URL(window.location.href).searchParams.get('page')
    if (fromUrl && /^\d{1,4}$/.test(fromUrl)) return fromUrl

    // Fall back to the paginator's current state.
    const current = document.querySelector(
      '[aria-current="page"], [data-test-pagination-page-btn].active, .artdeco-pagination__indicator--number.active',
    )
    const text = current?.textContent?.trim()
    if (text && /^\d{1,4}$/.test(text)) return text

    // First/single-page saved lists often have no paginator. The capture claim
    // requires an identifier; null misleadingly reports SESSION_NOT_FOUND.
    return '1'
  },

  getPageName(): string {
    const candidates = [
      '[data-test-list-name]',
      '[data-x--people-list--title]',
      'main h1',
      '[role="main"] h1',
    ]

    for (const selector of candidates) {
      const value = document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim()
      if (value && value.length <= 120) return value
    }

    const title = document.title
      .replace(/\s*[|–—-]\s*Sales Navigator.*$/i, '')
      .replace(/^Sales Navigator\s*[|–—-]\s*/i, '')
      .trim()
    return title && title.length <= 120 ? title : 'Sales Navigator lead list'
  },

  async capture(options?: CaptureOptions): Promise<CapturedPage> {
    // All DOM reads happen synchronously under the content script's session
    // gate. The observer already debounces rendering; no delayed DOM pass may
    // run after a user has ended the session.
    const container = resultsContainer()
    if (!container) throw new Error('no results container on this page')
    const cleaned = sanitizePageElement(container)
    if (!cleaned) throw new Error('results container could not be read')
    if (options?.includeCompanyWebsites === true) copyVisibleCompanyDetails(cleaned)

    // Wrapped in a minimal document so the backend's content sniffing sees a
    // real HTML file, exactly as it would for an uploaded page.
    const html =
      '<!doctype html><html><head><meta charset="utf-8"></head><body>'
      + cleaned.outerHTML
      + '</body></html>'

    return {
      sourceType: 'salesnav_lead_results',
      html,
      sourceUrl: snapshotUrl(window.location.href)!,
      pageName: salesNavAdapter.getPageName(),
      pageIdentifier: salesNavAdapter.getPageIdentifier() ?? '1',
      contentHash: await sha256Hex(html),
    }
  },
}

export const ADAPTERS: PageAdapter[] = [salesNavAccountListAdapter, salesNavAccountSearchAdapter, salesNavAdapter]

export function adapterFor(url: string): PageAdapter | null {
  return ADAPTERS.find((a) => a.supports(url)) ?? null
}

/** Session-only fingerprint. Include EVERY row, not just the first and last
 * person: account pages may contain no people, or only recommendations. */
export function pageSignature(adapter: PageAdapter): string {
  const selector = adapter.id === 'salesnav-account-list'
    ? '[data-x--account-hub--table] [data-x--account-hub--table-data-row]'
    : adapter.id === 'salesnav-account-search'
      ? '[data-x-search-result="ACCOUNT"]'
      : `${LIST_ROW}, ${TABLE_ROW}`
  const marker = adapter.sourceType === 'salesnav_lead_results' ? PERSON_NAME : '[data-anonymize="company-name"]'
  const identities = Array.from(document.querySelectorAll(selector)).flatMap((row) => {
    const name = row.querySelector(marker)
    if (!name) return []
    const anchor = name.closest('a[href]') ?? row.querySelector(
      adapter.sourceType === 'salesnav_lead_results' ? 'a[href*="/sales/lead/"]' : 'a[href*="/sales/company/"]',
    )
    const href = anchor?.getAttribute('href')
    return [href ? snapshotUrl(href) : name.textContent?.replace(/\s+/g, ' ').trim()]
  })
  return JSON.stringify([adapter.id, snapshotUrl(window.location.href), adapter.getPageIdentifier(), identities])
}
