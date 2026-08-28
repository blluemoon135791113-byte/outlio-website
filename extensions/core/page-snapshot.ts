/** Shared sanitisation for extension-captured HTML snapshots. */
const DROP_ELEMENTS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'IMG', 'CANVAS', 'IFRAME'])

function keepAttribute(name: string): boolean {
  if (name === 'id' || name === 'style') return false
  if (name.startsWith('on') || name.startsWith('aria-')) return false
  return true
}

export function sanitizePageElement(node: Element): Element | null {
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
