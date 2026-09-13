/**
 * A profile link the Action Inbox can safely render.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  §4.13: "OPENING A REFERENCE NEVER PERFORMS A LINKEDIN ACTION."          ║
 * ║                                                                           ║
 * ║  That is not a UI nicety. LinkedIn has URLs that DO things — an invite    ║
 * ║  path, a message compose path, a follow path — and the URL on a contact    ║
 * ║  came out of uploaded or fetched HTML, which is untrusted input. A card    ║
 * ║  that renders whatever it was given can hand an operator a one-click       ║
 * ║  action against a stranger, performed by their real account, that Outlio   ║
 * ║  never decided to take.                                                   ║
 * ║                                                                           ║
 * ║  So this is an ALLOWLIST of read-only profile paths, not a blocklist of    ║
 * ║  dangerous ones. A blocklist is a promise to have thought of every path    ║
 * ║  LinkedIn will ever add.                                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ AND `javascript:` IS THE OTHER HALF. `components/crm/ValueProvenance.tsx`
 * already records why: an href built from a crawled page is stored XSS
 * executing for every user who opens the record. `new URL()` parses
 * `javascript:alert(1)` perfectly happily; only the protocol check stops it.
 */

/** Read-only person paths. Nothing here changes state on LinkedIn. */
const PROFILE_PATHS = [
  /*
   * The public profile. `[^/]+` rather than a slug charset, because LinkedIn
   * slugs contain unicode and percent-encoding, and a charset guess that is
   * too narrow silently drops real people.
   */
  /^\/in\/([^/]+)\/?$/,
  /*
   * A Sales Navigator lead. Kept DISTINCT from `/in/` rather than rewritten
   * into one: §4.5 forbids converting Sales Navigator identifiers to public
   * profile slugs by guessing, and the two are different addresses for the
   * same person.
   */
  /^\/sales\/lead\/([^/]+)\/?$/,
] as const

export type ProfileReference = {
  /** Safe to place in an href. Query and fragment removed. */
  href: string
  /** `public` or `sales_navigator` — never conflated. */
  kind: 'public' | 'sales_navigator'
}

/**
 * Validates a profile destination, or returns null.
 *
 * ⚠️ QUERY AND FRAGMENT ARE DROPPED, NOT PRESERVED. They carry tracking, and
 * more importantly they are where an action would hide — `?action=`,
 * `?invite=`. Keeping "just the harmless ones" means maintaining a second
 * allowlist for a part of the URL the card has no use for at all.
 */
export function profileReference(raw: string | null | undefined): ProfileReference | null {
  if (!raw) return null

  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }

  // The protocol check comes first and is absolute.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null

  const host = url.hostname.toLowerCase()
  /*
   * ⚠️ ANCHORED. A bare `includes('linkedin.com')` matches
   * `linkedin.com.evil.example`, which is the classic way an allowlist becomes
   * decorative. Subdomains are permitted because LinkedIn uses country ones.
   */
  if (!/(^|\.)linkedin\.com$/.test(host)) return null

  const path = url.pathname.replace(/\/+$/, '') || '/'

  for (const [index, pattern] of PROFILE_PATHS.entries()) {
    if (!pattern.test(path)) continue
    return {
      // Rebuilt from validated parts. Never the caller's string.
      href: `https://www.linkedin.com${path}`,
      kind: index === 0 ? 'public' : 'sales_navigator',
    }
  }

  return null
}
