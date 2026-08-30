/**
 * CRM contact-field normalization (M2 Phase 2).
 *
 * PURE — no I/O, no database, no secrets. Every value here becomes either a
 * stored field or a dedup BLOCKING KEY, so stability is the whole requirement:
 * the same real person arriving from an extraction, a CSV and a manual entry
 * must produce the same key, and two different people must never collide.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  THE CENTRAL DISTINCTION: `address`/`e164`/`canonicalUrl` are what we    ║
 * ║  STORE AND CONTACT. `identityKey` is what we COMPARE.                    ║
 * ║                                                                          ║
 * ║  They are deliberately different values. An identity key is folded —     ║
 * ║  Gmail dots removed, +tags dropped — because those addresses reach one   ║
 * ║  mailbox. Sending to the folded form would mean mailing an address the   ║
 * ║  person never gave us, breaking their filters and any reply threading.   ║
 * ║                                                                          ║
 * ║  NEVER put an identityKey in a To: header.                               ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ WHAT THIS FILE DOES NOT DO, BECAUSE IT ALREADY EXISTS ELSEWHERE:
 *   • company registrable domain  → `normalizeDomain` in lib/companies/normalize.ts
 *   • company name                → `normalizeCompanyName` (same file)
 *   • company LinkedIn page       → `normalizeCompanyLinkedInUrl` (same file)
 *   • Lead Engine dedup keys      → `resolveKey` in lib/leads/dedupe.ts
 * Re-implementing any of those here would create two sources of truth that
 * drift silently — the failure mode lib/companies/normalize.ts warns about.
 */
import {
  getCountries,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js/min'

import { normalizeDomain } from '@/lib/companies/normalize'
import { canonicalizeLeadUrl } from '@/lib/leads/canonical-url'

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

/**
 * Gmail and Google Workspace's consumer domains are the same mailbox, and
 * Google documents that dots in the local part are ignored.
 */
const GMAIL_HOSTS = new Set(['gmail.com', 'googlemail.com'])

/**
 * Providers that DOCUMENT `+tag` sub-addressing.
 *
 * Deliberately a short allow-list rather than "strip + everywhere". At a
 * corporate domain `+` may be an ordinary character in a real address, and
 * folding it there would merge two different people — which M2 Phase 4 forbids
 * outright ("never silently merge uncertain people"). Not folding costs us a
 * duplicate a human can resolve; folding wrongly destroys a person's record.
 */
const PLUS_ADDRESSING_HOSTS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'fastmail.com',
])

/** RFC 5321 §4.5.3.1 — the limits that actually bind in practice. */
const MAX_LOCAL_PART = 64
const MAX_ADDRESS = 254

export type EmailIdentity = {
  /**
   * The canonical STORED and CONTACTED address: trimmed, lowercased, domain
   * punycoded. Nothing is folded away.
   */
  address: string
  /**
   * Dedup blocking key. Provider-folded, so `J.Doe+news@Gmail.com` and
   * `jdoe@googlemail.com` agree. ⚠️ NEVER send to this.
   */
  identityKey: string
  localPart: string
  /** Host of `address`, lowercased and punycoded. */
  domain: string
  /**
   * The registrable domain when it identifies a COMPANY, else `null`.
   * `null` for mailbox providers — see `normalizeDomain`.
   */
  companyDomain: string | null
}

/**
 * Pulls the address out of a display form.
 *
 * CSV exports and mail clients routinely produce `Sam Ellis <sam@acme.com>`.
 * Rejecting those would fail an import for a formatting choice the user did
 * not make.
 */
function extractAddress(value: string): string {
  const angled = /<([^<>]+)>\s*$/.exec(value.trim())
  return (angled?.[1] ?? value).trim()
}

/**
 * Normalizes an email address, or returns `null`.
 *
 * `null` rather than a guess: a wrong address merges two people or mails a
 * stranger, and CLAUDE.md rule 4 forbids inventing a value. The caller stores
 * `NULL` and shows a missing-data indicator.
 */
export function normalizeEmail(value: string | null | undefined): EmailIdentity | null {
  if (!value) return null

  // NFKC first, so a full-width or composed character cannot produce a second
  // key for one address.
  const candidate = extractAddress(value.normalize('NFKC'))
  if (!candidate || /\s/.test(candidate)) return null
  if (candidate.length > MAX_ADDRESS) return null

  // Exactly one `@`, and neither side may be empty. `lastIndexOf` would accept
  // `a@b@c`, which is not an address we should be storing.
  const at = candidate.indexOf('@')
  if (at <= 0 || at !== candidate.lastIndexOf('@')) return null

  const rawLocal = candidate.slice(0, at)
  const rawDomain = candidate.slice(at + 1)
  if (!rawLocal || !rawDomain) return null
  if (rawLocal.length > MAX_LOCAL_PART) return null

  // Quoted local parts (`"a b"@x.com`) are legal and essentially never real in
  // a CRM. Accepting them would mean carrying their escaping rules everywhere.
  if (rawLocal.startsWith('"') || rawLocal.includes('\\')) return null
  if (rawLocal.startsWith('.') || rawLocal.endsWith('.') || rawLocal.includes('..')) {
    return null
  }
  // RFC 5322 specials, plus control characters. A HYPHEN IS NOT A SPECIAL —
  // `mary-jane@acme.com` is ordinary and rejecting it would fail real imports.
  if (/[(),:;<>\[\]@\x00-\x1f\x7f]/.test(rawLocal)) return null

  // `new URL` punycodes an international domain, so unicode hosts survive as a
  // single stable ASCII form instead of two spellings of one domain.
  let domain: string
  try {
    domain = new URL(`http://${rawDomain}`).hostname.toLowerCase()
  } catch {
    return null
  }
  domain = domain.replace(/\.+$/, '')

  if (!domain.includes('.')) return null
  if (domain.startsWith('.') || domain.includes('..')) return null
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(domain)) return null
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return null
  // A label may not begin or end with a hyphen.
  if (domain.split('.').some((label) => label.startsWith('-') || label.endsWith('-'))) {
    return null
  }

  const localPart = rawLocal.toLowerCase()
  const address = `${localPart}@${domain}`

  return {
    address,
    identityKey: foldEmailForIdentity(localPart, domain),
    localPart,
    domain,
    companyDomain: normalizeDomain(domain),
  }
}

/**
 * Folds an already-normalized address to its mailbox identity.
 *
 * Only documented provider behaviour is applied. Anything unrecognised is
 * returned unchanged, which is the safe direction: it can leave a duplicate for
 * a human to merge, but it can never merge two strangers.
 */
function foldEmailForIdentity(localPart: string, domain: string): string {
  let local = localPart
  let host = domain

  if (PLUS_ADDRESSING_HOSTS.has(host)) {
    const plus = local.indexOf('+')
    if (plus > 0) local = local.slice(0, plus)
    // A local part that is nothing but a tag (`+news@`) folds to nothing;
    // keep the original rather than emit a key of `@gmail.com`.
    if (!local) local = localPart
  }

  if (GMAIL_HOSTS.has(host)) {
    const undotted = local.replace(/\./g, '')
    if (undotted) local = undotted
    // googlemail.com is an alias of gmail.com, so both must fold to one key.
    host = 'gmail.com'
  }

  return `${local}@${host}`
}

// ---------------------------------------------------------------------------
// Phone
// ---------------------------------------------------------------------------

export type PhoneReason = 'ok' | 'ambiguous_no_country' | 'invalid'

export type PhoneIdentity = {
  /** Exactly what the source supplied, trimmed. Never discarded. */
  raw: string
  /** E.164, and `null` unless we are certain. */
  e164: string | null
  /** ISO 3166-1 alpha-2, when the number determined one. */
  country: string | null
  /** Dedup blocking key. Present only when `e164` is. */
  identityKey: string | null
  reason: PhoneReason
}

/**
 * Normalizes a phone number to E.164.
 *
 * ⚠️ A REGION IS NEVER GUESSED.
 *
 * `07700 900123` is a valid mobile in the UK, and a valid landline in a dozen
 * other countries. Assuming a default region — US, or the workspace's own —
 * silently rewrites the numbers of everyone outside it into numbers that
 * either fail to dial or dial a stranger. `lib/auth/profile-fields.ts` reached
 * the same conclusion for sign-up and this stays consistent with it.
 *
 * So a national-format number with no country supplied returns
 * `reason: 'ambiguous_no_country'` and NO identity key: it is kept and shown,
 * but it never blocks a merge. `defaultCountry` should come from an explicit
 * user choice — a CSV import mapping, or a workspace setting — never from a
 * locale header.
 */
export function normalizePhoneNumber(
  value: string | null | undefined,
  options: { defaultCountry?: string | null } = {},
): PhoneIdentity | null {
  if (!value) return null

  const raw = value.trim()
  if (!raw) return null

  const miss = (reason: PhoneReason): PhoneIdentity => ({
    raw,
    e164: null,
    country: null,
    identityKey: null,
    reason,
  })

  // Extensions are part of a dial string but not of an identity, and
  // libphonenumber keeps them out of E.164. Strip them before parsing so
  // "+1 555 0100 ext. 42" is not simply rejected.
  const withoutExtension = raw.replace(/\s*(?:ext\.?|x|#)\s*\d+\s*$/i, '')

  // `00` is the international prefix in most of the world. Converting it to `+`
  // turns an otherwise region-dependent string into an unambiguous one.
  const cleaned = /^00\d/.test(withoutExtension.replace(/[\s().\-‐-―]/g, ''))
    ? `+${withoutExtension.replace(/[\s().\-‐-―]/g, '').slice(2)}`
    : withoutExtension

  const international = cleaned.trim().startsWith('+')

  let region: CountryCode | undefined
  if (!international) {
    const supplied = options.defaultCountry?.trim().toUpperCase()
    if (!supplied) return miss('ambiguous_no_country')
    if (!getCountries().includes(supplied as CountryCode)) {
      return miss('ambiguous_no_country')
    }
    region = supplied as CountryCode
  }

  let parsed: ReturnType<typeof parsePhoneNumberFromString>
  try {
    parsed = parsePhoneNumberFromString(cleaned, region)
  } catch {
    return miss('invalid')
  }

  // `isValid()`, not `isPossible()`: possible only checks the length, so it
  // accepts numbers that no operator has ever issued.
  if (!parsed?.isValid()) return miss('invalid')

  return {
    raw,
    e164: parsed.number,
    country: parsed.country ?? null,
    identityKey: parsed.number,
    reason: 'ok',
  }
}

// ---------------------------------------------------------------------------
// LinkedIn (person)
// ---------------------------------------------------------------------------

export type LinkedInKind = 'public_profile' | 'sales_navigator'

export type LinkedInIdentity = {
  /**
   * A clickable canonical URL, or `null`.
   *
   * `null` for Sales Navigator: its lead id is opaque and cannot be turned into
   * a public profile URL without a request to linkedin.com, which CLAUDE.md
   * rule 1 forbids outright.
   */
  canonicalUrl: string | null
  /**
   * Dedup blocking key, produced by `canonicalizeLeadUrl` — the SAME function
   * the Lead Engine uses. Sharing it is the point: a contact ingested from an
   * extraction and the same person typed in by hand must land on one key.
   */
  identityKey: string
  kind: LinkedInKind
}

/** Same rule as `lib/auth/profile-fields.ts`: validate the DECODED slug. */
const PROFILE_SLUG = /^[\p{L}\p{N}_-]{2,100}$/u

/**
 * Canonicalizes a person's LinkedIn URL.
 *
 * Accepts public profiles (`/in/{slug}`) and Sales Navigator leads
 * (`/sales/lead/{id}`), with or without protocol, `www.`, a regional
 * subdomain, a locale path prefix, a query string or a trailing slash. Root-
 * relative paths are accepted because Sales Navigator emits them.
 *
 * Rejects company pages and any non-LinkedIn host. THE HOST CHECK MATTERS:
 * `example.com/in/acme` matches the same path shape and would otherwise be
 * accepted as a LinkedIn identity.
 */
export function normalizeContactLinkedInUrl(
  value: string | null | undefined,
): LinkedInIdentity | null {
  if (!value) return null

  const trimmed = value.trim()
  if (!trimmed) return null

  let path: string
  if (trimmed.startsWith('/')) {
    path = trimmed
  } else {
    let candidate = trimmed
    if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`

    let parsed: URL
    try {
      parsed = new URL(candidate)
    } catch {
      return null
    }

    const host = parsed.hostname.toLowerCase().replace(/\.+$/, '')
    if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return null
    path = parsed.pathname
  }

  const segments = path.split('/').filter(Boolean)

  // Sales Navigator first: its id is the stronger identity, and a lead URL can
  // never also be a public profile.
  const salesIndex = segments.findIndex((s) => s.toLowerCase() === 'sales')
  if (salesIndex !== -1) {
    if (segments[salesIndex + 1]?.toLowerCase() !== 'lead') return null
    const id = segments[salesIndex + 2]
    if (!id) return null

    // Everything from the first comma on is session state that CHANGES BETWEEN
    // SAVES — see lib/leads/canonical-url.ts. Keeping it gives one person a new
    // key on every export.
    const stable = id.split(',')[0]
    if (!stable || !/^[A-Za-z0-9_-]{4,}$/.test(stable)) return null

    return {
      canonicalUrl: null,
      identityKey: canonicalizeLeadUrl(`/sales/lead/${stable}`) ?? `li:lead:${stable}`,
      kind: 'sales_navigator',
    }
  }

  // Public profile. A locale prefix (`/en/in/slug`) means `in` is not always
  // the first segment.
  const inIndex = segments.findIndex((s) => s.toLowerCase() === 'in')
  if (inIndex === -1) return null

  const rawSlug = segments[inIndex + 1]
  if (!rawSlug) return null

  let decoded: string
  try {
    decoded = decodeURIComponent(rawSlug)
  } catch {
    // Malformed percent-encoding, e.g. `%zz`.
    return null
  }

  const slug = decoded.trim().toLowerCase()
  if (!PROFILE_SLUG.test(slug)) return null

  return {
    canonicalUrl: `https://www.linkedin.com/in/${encodeURIComponent(slug)}`,
    identityKey: `li:in:${slug}`,
    kind: 'public_profile',
  }
}

// ---------------------------------------------------------------------------
// Person name
// ---------------------------------------------------------------------------

export type PersonName = {
  /** Display form: trimmed, inner whitespace collapsed. Casing preserved. */
  fullName: string
  firstName: string | null
  lastName: string | null
}

/**
 * Splits a full name into parts for `{{first_name}}` / `{{last_name}}`.
 *
 * ⚠️ A BEST EFFORT ON A PROBLEM WITH NO CORRECT ANSWER. Name order, particles
 * and multi-word surnames vary by culture, and no split is right everywhere.
 * It is therefore used ONLY for merge-variable defaults, NEVER as an identity
 * or a dedup input — `lib/leads/dedupe.ts` keys on the whole name for exactly
 * this reason. Casing is preserved: "McDonald" and "van der Berg" are how
 * those people write their names.
 */
export function normalizePersonName(value: string | null | undefined): PersonName | null {
  if (!value) return null

  const fullName = value.normalize('NFKC').replace(/\s+/g, ' ').trim()
  if (!fullName || fullName.length > 200) return null
  // Must contain at least one letter or digit — "-" is not a name.
  if (!/[\p{L}\p{N}]/u.test(fullName)) return null

  const parts = fullName.split(' ')
  if (parts.length === 1) {
    return { fullName, firstName: fullName, lastName: null }
  }

  return {
    fullName,
    firstName: parts[0] ?? null,
    // Everything after the first token, so "Ana Maria de Souza" keeps
    // "Maria de Souza" together rather than dropping the middle of a surname.
    lastName: parts.slice(1).join(' ') || null,
  }
}
