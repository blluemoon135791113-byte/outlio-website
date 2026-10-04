/**
 * A lead's OTHER public profiles (0154 `crm_contact_links`): X, Facebook,
 * Instagram, GitHub, a website, or any labelled link.
 *
 * Pure — shared by the server (validation before the write) and the forms
 * (the kind list). The table constraints check the scheme and LinkedIn again.
 *
 * ⚠️ ONLY WHAT A PERSON TYPED. Nothing here builds a handle from a name; a
 * value that is not a full address of the right site is refused, not repaired
 * into one (CLAUDE.md rule 4).
 */

export const SOCIAL_KINDS = ['x', 'facebook', 'instagram', 'github', 'website', 'other'] as const
export type SocialKind = (typeof SOCIAL_KINDS)[number]

export const SOCIAL_LABEL: Record<SocialKind, string> = {
  x: 'X',
  facebook: 'Facebook',
  instagram: 'Instagram',
  github: 'GitHub',
  website: 'Website',
  other: 'Other',
}

/** Matching hosts for the named kinds. `website` and `other` take any host. */
const HOSTS: Partial<Record<SocialKind, string[]>> = {
  x: ['x.com', 'twitter.com'],
  facebook: ['facebook.com', 'fb.com'],
  instagram: ['instagram.com'],
  github: ['github.com'],
}

export const MAX_LINKS_PER_LEAD = 20

export type SocialLink = { kind: SocialKind; label: string | null; url: string; urlKey: string }

export type SocialLinkResult = { ok: true; link: SocialLink } | { ok: false; error: string }

const isSocialKind = (value: string): value is SocialKind => (SOCIAL_KINDS as readonly string[]).includes(value)

/**
 * What makes two addresses one link. The host is case-blind and "www." is
 * dropped everywhere. A PROFILE path is case-blind too (github.com/Pat is
 * github.com/pat); a website's path and query are not — `site.com/p?id=1` and
 * `?id=2` are two pages, and folding them would silently drop one.
 */
function urlKeyOf(url: URL, kind: SocialKind): string {
  const host = url.hostname.toLowerCase().replace(/\.+$/, '').replace(/^www\./, '')
  const path = url.pathname.replace(/\/+$/, '')
  if (HOSTS[kind]) return `${host}${path.toLowerCase()}`
  return `${host}${path}${url.search}`
}

const onHost = (host: string, allowed: string[]) => allowed.some((h) => host === h || host.endsWith(`.${h}`))

/**
 * Validates one link. A bare "github.com/pat" is accepted (https is assumed,
 * as browsers do); a handle on its own ("@pat") is refused — turning it into
 * an address would be guessing which site it belongs to.
 */
export function parseSocialLink(input: { kind: unknown; label?: unknown; url: unknown }): SocialLinkResult {
  const kind = String(input.kind ?? '')
  if (!isSocialKind(kind)) return { ok: false, error: 'Choose what kind of link this is.' }

  const rawLabel = String(input.label ?? '').trim().replace(/\s+/g, ' ')
  const label = rawLabel ? rawLabel : null
  if (label && label.length > 40) return { ok: false, error: 'Keep a link label to 40 characters.' }
  if (kind === 'other' && !label) return { ok: false, error: 'Give the link a label, such as "Blog".' }

  const raw = String(input.url ?? '').trim()
  if (!raw) return { ok: false, error: `Add the ${SOCIAL_LABEL[kind]} address.` }
  if (raw.length > 500) return { ok: false, error: 'That address is too long.' }
  if (/\s/.test(raw)) return { ok: false, error: 'An address cannot contain spaces.' }

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw)
  if (hasScheme && !/^https?:\/\//i.test(raw)) return { ok: false, error: 'Use a web address starting with https://.' }

  let url: URL
  try {
    url = new URL(hasScheme ? raw : `https://${raw}`)
  } catch {
    return { ok: false, error: 'That is not a web address.' }
  }
  const host = url.hostname.toLowerCase().replace(/\.+$/, '')
  // A dotless host ("@pat", "pat") is a handle, not an address.
  if (!host.includes('.')) return { ok: false, error: 'Paste the full address, not just a handle.' }
  if (url.username || url.password) return { ok: false, error: 'That is not a web address.' }

  if (onHost(host, ['linkedin.com'])) {
    return { ok: false, error: 'LinkedIn and Sales Navigator have their own fields.' }
  }

  const hosts = HOSTS[kind]
  if (hosts && !onHost(host, hosts)) {
    return { ok: false, error: `That address is not on ${SOCIAL_LABEL[kind]}.` }
  }
  // A profile link names someone: the site's home page alone is not one.
  if (hosts && url.pathname.replace(/\/+$/, '') === '') {
    return { ok: false, error: `Paste the profile address, not the ${SOCIAL_LABEL[kind]} home page.` }
  }

  // Encoding can lengthen it; the table's 500 applies to what is stored.
  const stored = url.toString()
  if (stored.length > 500) return { ok: false, error: 'That address is too long.' }

  return { ok: true, link: { kind, label, url: stored, urlKey: urlKeyOf(url, kind) } }
}

/**
 * Reads the repeated `link_kind` / `link_label` / `link_url` fields a form
 * posts, skipping rows left completely empty. Duplicates (same address) are
 * kept once. Returns the first problem, worded for the person.
 */
export function socialLinksFromForm(form: FormData): { ok: true; links: SocialLink[] } | { ok: false; error: string } {
  const kinds = form.getAll('link_kind').map(String)
  const labels = form.getAll('link_label').map(String)
  const urls = form.getAll('link_url').map(String)
  if (kinds.length !== urls.length || labels.length !== urls.length) {
    return { ok: false, error: 'The links could not be read. Refresh and try again.' }
  }

  const links: SocialLink[] = []
  const seen = new Set<string>()
  for (let i = 0; i < urls.length; i++) {
    if (!urls[i]!.trim() && !labels[i]!.trim()) continue
    const parsed = parseSocialLink({ kind: kinds[i], label: labels[i], url: urls[i] })
    if (!parsed.ok) return parsed
    if (seen.has(parsed.link.urlKey)) continue
    seen.add(parsed.link.urlKey)
    links.push(parsed.link)
  }
  if (links.length > MAX_LINKS_PER_LEAD) return { ok: false, error: `At most ${MAX_LINKS_PER_LEAD} links per lead.` }
  return { ok: true, links }
}

/** The text a link is shown as: its label, else its kind. */
export function socialLinkText(link: { kind: string; label: string | null }): string {
  if (link.label) return link.label
  return isSocialKind(link.kind) ? SOCIAL_LABEL[link.kind] : 'Link'
}
