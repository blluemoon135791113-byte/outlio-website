/**
 * Which exported cells become clickable links.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ LINKS ARE APPLIED BY THE DESTINATION'S LINK API, NEVER AS A FORMULA.  ║
 * ║                                                                           ║
 * ║  The original scraper wrote `=HYPERLINK(...)` into cells. `sanitizeCell`  ║
 * ║  deliberately neuters a leading `=`, because lead data is attacker-       ║
 * ║  controlled — anyone can put anything in their own LinkedIn profile — and ║
 * ║  a formula is executable. docs/SCRAPER_AUDIT.md §H2 records the approved  ║
 * ║  resolution: keep the URL as plain text in its own column, and recreate   ║
 * ║  the link with the writer's own link API. This module decides WHICH cells ║
 * ║  qualify; each writer applies the link its own way.                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * Pure — no I/O — so the rule is testable without a network.
 */

/**
 * The URL a cell should link to, or null when it should stay plain text.
 *
 * ⚠️ THE WHOLE VALUE MUST BE THE URL. A cell is linked only when its entire
 * text is one http(s) address, and the link target is exactly that text. So the
 * reader always sees the destination before they click it: a lead cannot make
 * "Acme Corp" point somewhere else, because a cell reading "Acme Corp" is never
 * linked at all.
 *
 * ⚠️ HTTP AND HTTPS ONLY. `javascript:`, `data:`, `file:` and friends are
 * refused outright rather than escaped — there is no legitimate lead field that
 * needs them, and a spreadsheet link is followed by a click.
 *
 * Returns the URL exactly as written (trimmed), not a re-serialised form, so
 * the link opens the address the cell displays, character for character.
 */
export function linkableUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()

  // A URL cannot contain whitespace; "https://a.com and more" is prose.
  if (text === '' || /\s/.test(text)) return null
  if (!/^https?:\/\//i.test(text)) return null

  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    return null
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  // `https://` with nothing after it parses on some runtimes; it is not a link.
  if (!parsed.hostname) return null
  // Credentials in a URL are a phishing shape (`https://bank.com@evil.test`),
  // never a real lead or company address.
  if (parsed.username || parsed.password) return null

  return text
}
