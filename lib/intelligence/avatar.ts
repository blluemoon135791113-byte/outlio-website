/**
 * Avatars for the Hubble lead list.
 *
 * PURE — no I/O, no React.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  WE HAVE NO PHOTOGRAPHS, AND WE ARE NOT GOING TO INVENT ANY.             ║
 * ║                                                                          ║
 * ║  The extension strips every <img> before a page leaves the browser       ║
 * ║  (`extensions/adapters/salesnav.ts`, DROP_ELEMENTS), so no avatar URL    ║
 * ║  has ever reached the database. A person therefore gets a MONOGRAM —     ║
 * ║  their initials, on a colour derived from their name.                    ║
 * ║                                                                          ║
 * ║  A company can do better, because we hold its DOMAIN: a favicon is the   ║
 * ║  company's own published mark, free, and needs nothing stored.           ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

/**
 * Initials for a monogram, at most two characters.
 *
 * Takes the first and LAST word, not the first two: "Maria del Carmen Ruiz"
 * should read MR, and "Jean-Luc" should not become JL from one word.
 */
export function initialsFor(name: string | null | undefined): string {
  if (!name) return '?'

  const words = name
    .trim()
    .split(/[\s.]+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)

  if (words.length === 0) return '?'
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()

  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase()
}

/**
 * The monogram palette.
 *
 * Warm and low-saturation so a column of them reads as texture rather than
 * confetti. Values are HSL triples resolved in the component, not colour
 * literals in a style position — CLAUDE.md forbids those.
 */
export const MONOGRAM_TINTS = [
  { bg: 'oklch(0.92 0.04 60)', fg: 'oklch(0.42 0.09 60)' },
  { bg: 'oklch(0.92 0.04 145)', fg: 'oklch(0.40 0.08 145)' },
  { bg: 'oklch(0.92 0.04 250)', fg: 'oklch(0.42 0.10 265)' },
  { bg: 'oklch(0.92 0.04 320)', fg: 'oklch(0.42 0.10 330)' },
  { bg: 'oklch(0.92 0.045 30)', fg: 'oklch(0.44 0.11 30)' },
  { bg: 'oklch(0.92 0.04 195)', fg: 'oklch(0.40 0.08 200)' },
] as const

/**
 * A stable tint for a name.
 *
 * ⚠️ DETERMINISTIC. The same lead must get the same colour on every render and
 * every page load — a monogram that changes colour when you page back and forth
 * reads as a different person.
 */
export function tintFor(seed: string | null | undefined): (typeof MONOGRAM_TINTS)[number] {
  const text = seed?.trim() || '?'

  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0
  }

  return MONOGRAM_TINTS[Math.abs(hash) % MONOGRAM_TINTS.length]!
}

/** Hosts whose favicon would be ours or a shortener's, not the company's. */
const NOT_A_BRAND = [/(^|\.)linkedin\.com$/i, /(^|\.)lnkd\.in$/i, /(^|\.)outlio\.io$/i]

/**
 * A company's logo URL, or `null` when we have no domain to ask about.
 *
 * Google's favicon endpoint: free, no key, no account, and it already holds
 * essentially every company domain. It returns a generic globe for a domain it
 * does not know, which is a graceful miss rather than a broken image.
 *
 * ⚠️ THIS IS A THIRD-PARTY REQUEST FROM THE USER'S BROWSER. It tells Google
 * which domains are being looked at. It carries no lead data, no identifiers
 * and no credentials — only a domain — but `referrerPolicy="no-referrer"` is
 * set at the call site so our own URLs do not travel with it either.
 */
export function companyLogoUrl(domain: string | null | undefined, size = 64): string | null {
  if (!domain) return null

  const cleaned = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]!
    .split('?')[0]!

  if (!cleaned.includes('.')) return null
  if (NOT_A_BRAND.some((pattern) => pattern.test(cleaned))) return null
  // Anything with URL grammar in it is not a hostname.
  if (/[^a-z0-9.-]/.test(cleaned)) return null

  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(cleaned)}&sz=${size}`
}
