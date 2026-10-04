/** Shared sanitisation for extension-captured HTML snapshots. */
const DROP_ELEMENTS = new Set([
  'script', 'style', 'noscript', 'svg', 'math', 'img', 'canvas', 'iframe',
  'object', 'embed', 'template', 'link', 'meta', 'base', 'form', 'input',
  'textarea', 'select', 'option', 'audio', 'video', 'source',
])

// An allowlist, not a blacklist of possible token names. Unknown page-owned
// data attributes can carry session JSON. These are the parser's actual hooks.
const KEEP_ATTRIBUTES = new Set([
  'class', 'title', 'href', 'data-anonymize', 'data-control-name',
  'data-scroll-into-view', 'data-x-search-result',
  'data-x--people-list--row', 'data-x--account-hub--table',
  'data-x--account-hub--table-data-row',
  'data-x-accounts-dashboard-table-column-header',
  'data-x--account-hub--selected-tab--account',
])
const PARSER_CLASSES = new Set(['artdeco-list', 'artdeco-list__item', 'artdeco-entity-lockup__subtitle'])

/** Never copy credentials, tracking/query state, fragments, or executable URLs. */
export function snapshotUrl(value: string, base = 'https://www.linkedin.com'): string | null {
  try {
    const url = new URL(value, base)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null
    url.search = ''
    url.hash = ''
    if (/(^|\.)linkedin\.com$/i.test(url.hostname)) {
      // The comma suffix on a lead URL is volatile, session-scoped state.
      const lead = /^(\/sales\/lead\/[^/,]+)(?:,.*)?$/.exec(url.pathname)
      if (lead) url.pathname = lead[1]!
    }
    return url.toString()
  } catch {
    return null
  }
}

export function sanitizePageElement(node: Element): Element | null {
  if (DROP_ELEMENTS.has(node.localName.toLowerCase()) || node.hasAttribute('hidden')) return null

  const clone = node.cloneNode(false) as Element
  for (const attr of Array.from(node.attributes)) {
    clone.removeAttribute(attr.name)
  }
  // Stable attribute ordering also prevents a harmless rerender changing the hash.
  for (const attr of Array.from(node.attributes).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!KEEP_ATTRIBUTES.has(attr.name)) continue
    let value: string | null = attr.name === 'href' ? snapshotUrl(attr.value) : attr.value
    if (attr.name === 'class') {
      value = attr.value.split(/\s+/).filter((name) => PARSER_CLASSES.has(name)).sort().join(' ') || null
    }
    if (attr.name === 'data-scroll-into-view') {
      const id = /^urn:li:fs_salesProfile:\(([A-Za-z0-9_-]+)/.exec(attr.value)?.[1]
      value = id ? `urn:li:fs_salesProfile:(${id})` : null
    }
    if (value !== null) clone.setAttribute(attr.name, value)
  }

  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      clone.appendChild(child.cloneNode(false))
      continue
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue
    const cleaned = sanitizePageElement(child as Element)
    if (cleaned) clone.appendChild(cleaned)
  }

  return clone
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
