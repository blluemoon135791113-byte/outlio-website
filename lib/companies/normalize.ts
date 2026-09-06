/**
 * Company identity normalization (spec §9).
 *
 * PURE — no I/O, no database, no secrets. Everything here becomes a company
 * identity key, so stability across captures is the entire requirement: the
 * same real company arriving from two different saved pages must produce the
 * same key, and two different companies must never produce the same one.
 *
 * ⚠️ THIS IS THE ONLY PLACE THESE RULES EXIST. `link_leads_to_companies` in
 * supabase/migrations/0043_companies.sql deliberately receives values that are
 * already normalized. Re-implementing any of this in SQL would create two
 * sources of truth that drift silently — the failure mode `lib/limits/credits.ts`
 * carries a warning comment about.
 */

/**
 * Hosts that identify a person's mailbox provider or a hosting platform, never
 * a company. Treating `gmail.com` as a company identity would collapse every
 * unrelated lead that happens to list a personal address into one row.
 */
const NON_COMPANY_HOSTS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'ymail.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'gmx.de',
  'mail.com',
  'yandex.com',
  'zoho.com',
  'qq.com',
  '163.com',
  '126.com',
  // Profile hosts. A LinkedIn or Linktree URL is not a company website.
  'linkedin.com',
  'linktr.ee',
  'bit.ly',
  'lnkd.in',
])

/**
 * Legal-form suffixes stripped before comparing names.
 *
 * "Acme Inc" and "Acme" are the same company; "Acme" and "Acme Systems" are
 * not, so only trailing legal forms are removed — never a substantive word.
 */
const LEGAL_SUFFIXES = new Set([
  'inc',
  'incorporated',
  'llc',
  'lc',
  'llp',
  'lp',
  'ltd',
  'limited',
  'plc',
  'co',
  'corp',
  'corporation',
  'company',
  'gmbh',
  'mbh',
  'ag',
  'kg',
  'ug',
  'bv',
  'nv',
  'sa',
  'sas',
  'sarl',
  'srl',
  'spa',
  'ab',
  'as',
  'oy',
  'aps',
  'pty',
  'pte',
  'pvt',
  'sl',
  'sp',
  'zoo',
  'doo',
  'kft',
  'ou',
])

/** Every strategy that can identify a company, strongest first. */
export const COMPANY_MATCH_STRATEGIES = ['domain', 'linkedin', 'name'] as const

export type CompanyMatchStrategy = (typeof COMPANY_MATCH_STRATEGIES)[number]

export type CompanyIdentityInput = {
  companyName?: string | null
  /** The company's own website, when the source page exposed one. */
  companyWebsiteUrl?: string | null
  /** The LinkedIn or Sales Navigator company page. */
  companyLinkedInUrl?: string | null
}

export type CompanyIdentity = {
  /** Stable key for this identity. Distinct strategies never collide. */
  key: string
  strategy: CompanyMatchStrategy
  name: string | null
  normalizedName: string | null
  domain: string | null
  normalizedDomain: string | null
  linkedinUrl: string | null
  normalizedLinkedInUrl: string | null
}

/**
 * Normalizes a company website to a bare registrable host.
 *
 * Accepts a full URL, a protocol-relative URL, or a bare host. Returns `null`
 * rather than guessing whenever the input cannot be trusted to identify a
 * company — an IP address, a local host, a mailbox provider, or anything
 * unparseable. A wrong domain merges unrelated companies, which is far worse
 * than leaving the field empty (CLAUDE.md rule 4).
 */
export function normalizeDomain(value: string | null | undefined): string | null {
  if (!value) return null

  let candidate = value.trim()
  if (!candidate) return null

  // An email address is a legitimate way for a company domain to reach us.
  const at = candidate.lastIndexOf('@')
  if (at !== -1) candidate = candidate.slice(at + 1)

  candidate = candidate.replace(/^\/\//, 'https://')
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) candidate = `https://${candidate}`

  let host: string
  try {
    host = new URL(candidate).hostname
  } catch {
    return null
  }

  host = host.toLowerCase().replace(/\.+$/, '')
  if (host.startsWith('www.')) host = host.slice(4)
  if (!host) return null

  // Reject anything that is not a public domain name.
  if (!host.includes('.')) return null
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null
  if (host.endsWith('.local') || host.endsWith('.localhost')) return null
  // Only letters, digits, hyphens and dots survive; `new URL` already
  // punycodes international hostnames, so this does not reject them.
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null

  if (NON_COMPANY_HOSTS.has(host)) return null

  return host
}

/**
 * Normalizes a company name for comparison.
 *
 * NFKC first, so full-width and composed characters compare equal to their
 * plain forms. Diacritics are preserved — "Müller" and "Muller" are different
 * companies as often as they are the same one, and this is only ever the
 * last-resort identity.
 */
export function normalizeCompanyName(value: string | null | undefined): string | null {
  if (!value) return null

  let text = value.normalize('NFKC').toLowerCase()

  // Drop anything a capture appended after a separator: "Acme | We build X".
  text = text.split(/[|·•–—]/)[0] ?? text

  // Periods are REMOVED, not turned into spaces. "B.V." must survive as the
  // single token "bv" so it can be recognised as a legal form; splitting it
  // into "b v" leaves two fragments that match nothing.
  text = text.replace(/\./g, '')

  // Collapse remaining punctuation to spaces so "acme, inc" and "acme inc" agree.
  text = text.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  if (!text) return null

  let words = text.split(/\s+/)
  // Strip trailing legal forms repeatedly: "acme holdings ltd co" → "acme holdings".
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1]!)) {
    words = words.slice(0, -1)
  }

  const normalized = words.join(' ')
  return normalized || null
}

/**
 * Normalizes a LinkedIn company page to one stable key.
 *
 * Sales Navigator and the public site address the same company differently
 * (`/sales/company/1234` vs `/company/acme`), and neither form can be converted
 * into the other without a request to linkedin.com — which is forbidden
 * (CLAUDE.md rule 1). They therefore remain distinct identities, and the
 * company row converges when a capture that carries both arrives.
 */
export function normalizeCompanyLinkedInUrl(
  value: string | null | undefined,
): string | null {
  if (!value) return null

  const trimmed = value.trim()
  if (!trimmed) return null

  // THE HOST MUST BE CHECKED. `example.com/company/acme` matches the same path
  // shape and would otherwise be accepted as a LinkedIn identity.
  let path: string
  if (trimmed.startsWith('/')) {
    // Sales Navigator emits root-relative hrefs; those are LinkedIn by origin.
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

  const numeric = /^\/sales\/company\/(\d+)(?:\/|$|[?#])/i.exec(path)
  if (numeric?.[1]) return `linkedin.com/sales/company/${numeric[1]}`

  const slug = /^\/company\/([^/?#]+)/i.exec(path)
  if (slug?.[1]) {
    let decoded: string
    try {
      decoded = decodeURIComponent(slug[1])
    } catch {
      decoded = slug[1]
    }

    // Validate the DECODED form. Percent-encoding hides structure — this is the
    // same trap the sign-up LinkedIn validator was caught by, where
    // `%3Cscript%3E` passed a check applied before decoding.
    const clean = decoded.trim().toLowerCase()
    if (!/^[\p{L}\p{N}._-]{1,120}$/u.test(clean)) return null
    // Dots are legal inside a slug (`acme.io`) but `..` and a slug of nothing
    // but punctuation are path traversal wearing a slug's clothes.
    if (clean.includes('..')) return null
    if (!/[\p{L}\p{N}]/u.test(clean)) return null

    return `linkedin.com/company/${clean}`
  }

  return null
}

/**
 * Resolves the identity a lead row gives us for its company.
 *
 * PRECEDENCE (spec §9): normalized domain → company LinkedIn URL → normalized
 * name. The strategy is chosen from what THIS lead carries, so the weak
 * name-only path is reached only when nothing stronger exists. That is what
 * stops two unrelated companies sharing a name from being merged (spec §10).
 *
 * Returns `null` when the row identifies no company at all — the lead is then
 * left unlinked rather than attached to an invented company.
 */
export function resolveCompanyIdentity(
  input: CompanyIdentityInput,
): CompanyIdentity | null {
  const name = input.companyName?.trim() || null
  const normalizedName = normalizeCompanyName(name)

  const normalizedDomain = normalizeDomain(input.companyWebsiteUrl)
  const domain = normalizedDomain ? input.companyWebsiteUrl?.trim() || null : null

  const normalizedLinkedInUrl = normalizeCompanyLinkedInUrl(input.companyLinkedInUrl)
  const linkedinUrl = normalizedLinkedInUrl
    ? input.companyLinkedInUrl?.trim() || null
    : null

  const base = {
    name,
    normalizedName,
    domain,
    normalizedDomain,
    linkedinUrl,
    normalizedLinkedInUrl,
  }

  if (normalizedDomain) {
    return { ...base, key: `domain:${normalizedDomain}`, strategy: 'domain' }
  }
  if (normalizedLinkedInUrl) {
    return { ...base, key: `linkedin:${normalizedLinkedInUrl}`, strategy: 'linkedin' }
  }
  if (normalizedName) {
    return { ...base, key: `name:${normalizedName}`, strategy: 'name' }
  }

  return null
}

/**
 * Groups leads by the company they identify.
 *
 * THIS IS THE COST CONTROL. Company-level research runs once per returned
 * entry, never once per lead — 500 employees of one company cost one funding
 * lookup, not 500 (spec §9).
 *
 * Leads that identify no company are returned separately so a caller can never
 * silently lose them.
 */
export function groupLeadsByCompany<T extends CompanyIdentityInput>(
  leads: readonly T[],
): {
  groups: Array<{ identity: CompanyIdentity; leads: T[] }>
  unidentified: T[]
} {
  const groups = new Map<string, { identity: CompanyIdentity; leads: T[] }>()
  const unidentified: T[] = []

  for (const lead of leads) {
    const identity = resolveCompanyIdentity(lead)
    if (!identity) {
      unidentified.push(lead)
      continue
    }

    const existing = groups.get(identity.key)
    if (existing) {
      existing.leads.push(lead)
      // Keep the richest view of the company we have seen for this key.
      existing.identity.name ??= identity.name
      existing.identity.normalizedName ??= identity.normalizedName
      existing.identity.linkedinUrl ??= identity.linkedinUrl
      existing.identity.normalizedLinkedInUrl ??= identity.normalizedLinkedInUrl
    } else {
      groups.set(identity.key, { identity: { ...identity }, leads: [lead] })
    }
  }

  return { groups: [...groups.values()], unidentified }
}
