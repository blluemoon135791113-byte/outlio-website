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
import type { CapturedPage, PageAdapter } from '../core/types'

/** Row anchors, in the order the backend parser tries them. */
const LIST_ROW = 'li.artdeco-list__item'
const TABLE_ROW = 'tr[data-x--people-list--row]'
/** The one stable identity marker on a row. */
const PERSON_NAME = '[data-anonymize="person-name"]'

const CONTAINER_CANDIDATES = ['ol.artdeco-list', 'table', 'main']

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

  async capture(): Promise<CapturedPage> {
    const container = resultsContainer()
    if (!container) throw new Error('no results container on this page')

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
      pageIdentifier: salesNavAdapter.getPageIdentifier(),
      contentHash: await sha256Hex(html),
    }
  },
}

export const ADAPTERS: PageAdapter[] = [salesNavAdapter]

export function adapterFor(url: string): PageAdapter | null {
  return ADAPTERS.find((a) => a.supports(url)) ?? null
}
