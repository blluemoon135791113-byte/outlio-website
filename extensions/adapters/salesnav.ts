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
 * Class names ARE kept: the backend anchors rows on
 * `ol.artdeco-list > li.artdeco-list__item`, so stripping them would break the
 * parser. Only volatile and executable content is removed.
 */
import type { CaptureOptions, CapturedPage, PageAdapter } from '../core/types'
import { sanitizePageElement, sha256Hex } from '../core/page-snapshot'
import { salesNavAccountListAdapter } from './salesnav-account-list'

/** Row anchors, in the order the backend parser tries them. */
const LIST_ROW = 'li.artdeco-list__item'
const TABLE_ROW = 'tr[data-x--people-list--row]'
/** The one stable identity marker on a row. */
const PERSON_NAME = '[data-anonymize="person-name"]'

const CONTAINER_CANDIDATES = ['ol.artdeco-list', 'table', 'main']
const SETTLE_QUIET_MS = 600
const SETTLE_MAX_MS = 3_000
const COMPANY_HOVER_SETTLE_MS = 250

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

function externalWebsiteFrom(root: ParentNode): string | null {
  for (const anchor of Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    try {
      const url = new URL(anchor.href, window.location.href)
      if (!['http:', 'https:'].includes(url.protocol)) continue
      if (/(^|\.)linkedin\.com$/i.test(url.hostname)) continue
      // licdn is LinkedIn's own asset CDN, not the company's site.
      if (/(^|\.)licdn\.com$/i.test(url.hostname)) continue
      return url.toString()
    } catch {
      // Ignore malformed page-owned links.
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

/**
 * Reads the company hover card for every company already on screen.
 *
 * ⚠️ NOTHING HERE NAVIGATES. It dispatches a hover on an element the user has
 * already loaded and reads what LinkedIn renders in response. No clicking, no
 * opening, no request of our own — CLAUDE.md rule 1 stands.
 *
 * This is the ONLY source of company industry, headcount and headquarters. A
 * results row carries the company's NAME and its LinkedIn URL and nothing
 * else — verified by an attribute census of a real saved page.
 */
async function revealCompanyDetails(container: Element): Promise<void> {
  const companies = Array.from(
    container.querySelectorAll<HTMLElement>('[data-anonymize="company-name"]'),
  )

  for (const company of companies) {
    const row = company.closest('tr, li') ?? company
    let website = externalWebsiteFrom(row)
    let details: ReturnType<typeof companyDetailsFrom> = {
      industry: null,
      size: null,
      headquarters: null,
    }

    company.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }))
    company.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: true }))
    await new Promise((resolve) => setTimeout(resolve, COMPANY_HOVER_SETTLE_MS))

    const card = document.querySelector(
      '[role="tooltip"], .artdeco-hoverable-content, .artdeco-hoverable-content__content, [id*="hovercard"]',
    )

    if (card) {
      website = website ?? externalWebsiteFrom(card)
      details = companyDetailsFrom(card)
    }

    company.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }))
    company.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))

    /*
     * Written onto the element so the SERVER parser reads them out of the saved
     * markup like every other field. The extension extracts nothing itself; it
     * only makes what LinkedIn rendered persist into the document.
     */
    if (website) company.dataset.outlioCompanyWebsite = website
    if (details.industry) company.dataset.outlioCompanyIndustry = details.industry
    if (details.size) company.dataset.outlioCompanySize = details.size
    if (details.headquarters) company.dataset.outlioCompanyHq = details.headquarters
  }
}


/**
 * Names render before some company cells on slower connections. Capture after
 * a short quiet window so LinkedIn's own lazy rendering can finish. This only
 * observes the page the user opened; it never hovers, scrolls, clicks, or
 * initiates a request.
 */
function waitForResultsToSettle(container: Element): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    let quietTimer: ReturnType<typeof setTimeout>

    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(quietTimer)
      clearTimeout(maxTimer)
      observer.disconnect()
      resolve()
    }

    const scheduleQuiet = () => {
      clearTimeout(quietTimer)
      quietTimer = setTimeout(finish, SETTLE_QUIET_MS)
    }

    const observer = new MutationObserver(scheduleQuiet)
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href', 'data-anonymize'],
    })

    const maxTimer = setTimeout(finish, SETTLE_MAX_MS)
    scheduleQuiet()
  })
}

export const salesNavAdapter: PageAdapter = {
  id: 'salesnav',
  sourceType: 'salesnav_lead_results',

  supports(url: string): boolean {
    try {
      const parsed = new URL(url)
      if (!/(^|\.)linkedin\.com$/i.test(parsed.hostname)) return false
      // Lead search results only — not company pages, not a single profile.
      return /^\/sales\/(search\/people|lists\/people|people)/i.test(parsed.pathname)
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
      '[data-test-pagination-page-btn].active, .artdeco-pagination__indicator--number.active',
    )
    const text = current?.textContent?.trim()
    if (text && /^\d{1,4}$/.test(text)) return text

    return null
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
    const initialContainer = resultsContainer()
    if (!initialContainer) throw new Error('no results container on this page')

    await waitForResultsToSettle(initialContainer)

    // The SPA may replace the whole list while it settles, so reacquire it.
    const container = resultsContainer()
    if (!container) throw new Error('results disappeared before capture')

    /*
     * ⚠️ ON BY DEFAULT. This pass was opt-in and effectively never used —
     * `company_website_url` was NULL on 400 of 400 real leads — so the company
     * data users ask for most was the data nobody ever got. The popup can
     * still switch it off for a faster capture.
     */
    if (options?.includeCompanyWebsites !== false) await revealCompanyDetails(container)

    const cleaned = sanitizePageElement(container)
    if (!cleaned) throw new Error('results container could not be read')

    // Wrapped in a minimal document so the backend's content sniffing sees a
    // real HTML file, exactly as it would for an uploaded page.
    const html =
      '<!doctype html><html><head><meta charset="utf-8"></head><body>'
      + cleaned.outerHTML
      + '</body></html>'

    return {
      sourceType: 'salesnav_lead_results',
      html,
      sourceUrl: window.location.href.split('#')[0]!,
      pageName: salesNavAdapter.getPageName(),
      pageIdentifier: salesNavAdapter.getPageIdentifier() ?? '1',
      contentHash: await sha256Hex(html),
    }
  },
}

export const ADAPTERS: PageAdapter[] = [salesNavAccountListAdapter, salesNavAdapter]

export function adapterFor(url: string): PageAdapter | null {
  return ADAPTERS.find((a) => a.supports(url)) ?? null
}
