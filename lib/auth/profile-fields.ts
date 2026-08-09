/**
 * Validation and normalisation for the contact fields required at sign-up.
 *
 * Pure — no I/O, no secrets — so every branch is unit-testable.
 *
 * ⚠️ The LinkedIn URL here is the ACCOUNT HOLDER'S OWN profile, self-supplied
 * for manual vetting. It is stored as a string and NEVER fetched, visited, or
 * scraped. CLAUDE.md rule 1 (no requests to linkedin.com) is unaffected.
 */
import {
  getCountries,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js/min'

export type FieldResult =
  | { ok: true; value: string }
  | { ok: false; reason: string }

// ---------------------------------------------------------------------------
// Phone
// ---------------------------------------------------------------------------

/**
 * Normalises to E.164: a leading `+`, country code, then 7–14 more digits.
 *
 * We require the country code rather than guessing a default region. Guessing
 * silently corrupts numbers for anyone outside the assumed country, and the
 * customer base is explicitly international. This also avoids pulling in
 * libphonenumber (~145 KB) for a single field.
 *
 * Accepts common human formatting — spaces, dashes, dots, parentheses — and a
 * leading `00` international prefix, which is normalised to `+`.
 */
export function normalizePhone(input: string): FieldResult {
  const raw = input.trim()

  if (!raw) {
    return { ok: false, reason: 'Enter your phone number.' }
  }

  // Strip formatting humans use. Keep digits and a leading plus.
  let cleaned = raw.replace(/[\s().\-‐-―]/g, '')

  // `0044…` → `+44…`
  if (cleaned.startsWith('00')) cleaned = `+${cleaned.slice(2)}`

  if (!cleaned.startsWith('+')) {
    return {
      ok: false,
      reason: 'Include your country code, starting with + — for example +44 7700 900123.',
    }
  }

  if (/[^+0-9]/.test(cleaned)) {
    return { ok: false, reason: 'Phone numbers can only contain digits, spaces and a leading +.' }
  }

  if (!/^\+[1-9][0-9]{7,14}$/.test(cleaned)) {
    return {
      ok: false,
      reason: 'That does not look like a valid international phone number.',
    }
  }

  return { ok: true, value: cleaned }
}

/**
 * Parses a national number using the country explicitly chosen by the user,
 * then stores one canonical E.164 value. The allow-list comes from the same
 * maintained metadata that powers the country selector, so a forged country
 * value cannot change parsing behaviour.
 */
export function normalizePhoneForCountry(country: string, input: string): FieldResult {
  if (!getCountries().includes(country as CountryCode)) {
    return { ok: false, reason: 'Choose a valid country code.' }
  }

  const raw = input.trim()
  if (!raw) return { ok: false, reason: 'Enter your phone number.' }

  try {
    const parsed = parsePhoneNumberFromString(raw, country as CountryCode)
    if (!parsed?.isValid()) {
      return { ok: false, reason: 'That does not look like a valid phone number for this country.' }
    }
    return { ok: true, value: parsed.number }
  } catch {
    return { ok: false, reason: 'That does not look like a valid phone number for this country.' }
  }
}

// ---------------------------------------------------------------------------
// LinkedIn profile URL
// ---------------------------------------------------------------------------

/**
 * Validated against the DECODED slug, not the raw one.
 *
 * `new URL()` percent-encodes anything unusual, so a raw-form check that allows
 * `%` (needed for international names like `müller` → `m%C3%BCller`) would also
 * wave through `<script>` as `%3Cscript%3E`. Decoding first means unicode
 * letters pass and structural characters do not.
 *
 * Unicode-aware: allows letters and numbers from any script, plus `-` and `_`.
 */
const LINKEDIN_SLUG_DECODED = /^[\p{L}\p{N}_-]{2,100}$/u

/**
 * Normalises any reasonable form of a personal LinkedIn profile URL to the
 * canonical `https://www.linkedin.com/in/{slug}`.
 *
 * Accepts: with or without protocol, with or without `www.`, regional
 * subdomains (`uk.linkedin.com`), trailing slashes, and query strings.
 *
 * Rejects company pages, Sales Navigator links, and anything that is not a
 * personal `/in/` profile — those are not the account holder's identity.
 */
export function normalizeLinkedInUrl(input: string): FieldResult {
  const raw = input.trim()

  if (!raw) {
    return { ok: false, reason: 'Enter your LinkedIn profile URL.' }
  }

  let candidate = raw
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return { ok: false, reason: 'That does not look like a valid URL.' }
  }

  const host = url.hostname.toLowerCase()
  const isLinkedIn = host === 'linkedin.com' || host.endsWith('.linkedin.com')

  if (!isLinkedIn) {
    return { ok: false, reason: 'Use a linkedin.com profile URL.' }
  }

  // Strip a locale prefix such as /en/in/slug
  const segments = url.pathname.split('/').filter(Boolean)
  const inIndex = segments.findIndex((s) => s.toLowerCase() === 'in')

  if (inIndex === -1) {
    if (segments.some((s) => ['company', 'school', 'showcase'].includes(s.toLowerCase()))) {
      return {
        ok: false,
        reason: 'That is a company page. Use your personal profile URL, which contains /in/.',
      }
    }
    if (segments.some((s) => s.toLowerCase() === 'sales')) {
      return {
        ok: false,
        reason: 'That is a Sales Navigator link. Use your public profile URL, which contains /in/.',
      }
    }
    return {
      ok: false,
      reason: 'Use your personal profile URL — it looks like linkedin.com/in/your-name.',
    }
  }

  const slug = segments[inIndex + 1]
  const invalid: FieldResult = {
    ok: false,
    reason: 'Use your personal profile URL — it looks like linkedin.com/in/your-name.',
  }

  if (!slug) return invalid

  let decoded: string
  try {
    decoded = decodeURIComponent(slug)
  } catch {
    // Malformed percent-encoding, e.g. `%zz`.
    return invalid
  }

  if (!LINKEDIN_SLUG_DECODED.test(decoded)) return invalid

  // Re-encode so the stored value is canonical. Identity for ASCII slugs.
  return { ok: true, value: `https://www.linkedin.com/in/${encodeURIComponent(decoded)}` }
}

// ---------------------------------------------------------------------------
// Full name
// ---------------------------------------------------------------------------

export function normalizeFullName(input: string): FieldResult {
  const value = input.trim().replace(/\s+/g, ' ')

  if (!value) return { ok: false, reason: 'Enter your full name.' }
  if (value.length < 2) return { ok: false, reason: 'Enter your full name.' }
  if (value.length > 120) return { ok: false, reason: 'That name is too long.' }

  return { ok: true, value }
}
