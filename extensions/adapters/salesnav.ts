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

/** Row anchors, in the order the backend parser tries them. */
const LIST_ROW = 'li.artdeco-list__item'
const TABLE_ROW = 'tr[data-x--people-list--row]'
/** The one stable identity marker on a row. */
const PERSON_NAME = '[data-anonymize="person-name"]'

const CONTAINER_CANDIDATES = ['ol.artdeco-list', 'table', 'main']
const SETTLE_QUIET_MS = 600
const SETTLE_MAX_MS = 3_000
const COMPANY_HOVER_SETTLE_MS = 250

/** Elements that carry no parseable data and may carry secrets. */
const DROP_ELEMENTS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'IMG', 'CANVAS', 'IFRAME'])

/** Volatile or executable attributes. `id` is the per-render Ember id. */
function keepAttribute(name: string): boolean {
  if (name === 'id' || name === 'style') return false
  if (name.startsWith('on')) return false
  if (name.startsWith('aria-')) return false
  return true
}

function sanitize(node: Element): Element | null {
  if (DROP_ELEMENTS.has(node.tagName)) return null

  const clone = node.cloneNode(false) as Element

  for (const attr of Array.from(node.attributes)) {
    if (!keepAttribute(attr.name)) clone.removeAttribute(attr.name)
  }

  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      clone.appendChild(child.cloneNode(false))
      continue
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue

    const cleaned = sanitize(child as Element)
    if (cleaned) clone.appendChild(cleaned)
  }

  return clone
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

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
      return url.toString()
    } catch {
      // Ignore malformed page-owned links.
    }
  }
  return null
}

/**
 * Sales Navigator lazy-renders some company hover cards. This opt-in pass only
 * hovers already-visible company labels and reads an external URL if LinkedIn
 * renders one; it never clicks, opens a page, or makes its own network request.
 */
async function revealCompanyWebsites(container: Element): Promise<void> {
  const companies = Array.from(
    container.querySelectorAll<HTMLElement>('[data-anonymize="company-name"]'),
  )

  for (const company of companies) {
    let website = externalWebsiteFrom(company.closest('tr, li') ?? company)
    if (!website) {
      company.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }))
      company.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: true }))
      await new Promise((resolve) => setTimeout(resolve, COMPANY_HOVER_SETTLE_MS))

      const hoverContent = document.querySelector(
        '[role="tooltip"], .artdeco-hoverable-content, .artdeco-hoverable-content__content',
      )
      if (hoverContent) website = externalWebsiteFrom(hoverContent)

      company.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }))
      company.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
    }
    if (website) company.dataset.outlioCompanyWebsite = website
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

    if (options?.includeCompanyWebsites) await revealCompanyWebsites(container)

    const cleaned = sanitize(container)
    if (!cleaned) throw new Error('results container could not be read')

    // Wrapped in a minimal document so the backend's content sniffing sees a
    // real HTML file, exactly as it would for an uploaded page.
    const html =
      '<!doctype html><html><head><meta charset="utf-8"></head><body>'
      + cleaned.outerHTML
      + '</body></html>'

    return {
      html,
      sourceUrl: window.location.href.split('#')[0]!,
      pageName: salesNavAdapter.getPageName(),
      pageIdentifier: salesNavAdapter.getPageIdentifier() ?? '1',
      contentHash: await sha256Hex(html),
    }
  },
}

export const ADAPTERS: PageAdapter[] = [salesNavAdapter]

export function adapterFor(url: string): PageAdapter | null {
  return ADAPTERS.find((a) => a.supports(url)) ?? null
}
