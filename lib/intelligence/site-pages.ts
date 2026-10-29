/**
 * Which pages of a company's own site to read for contact details, and how.
 *
 * PURE.
 *
 * ⚠️ COMMON CRAWL WAS TRIED HERE AND REMOVED (2026-10-13). Discovering pages
 * from its public index, then reading them live, was measured against 25
 * companies sampled from real lead data: only 3 had contact-type pages in the
 * index, and the readers found exactly the same emails (16 on-domain, 21 in
 * all) with and without it — while a cold lookup added ~2–6s per company.
 * Sales Navigator leads are mostly too small to be crawled. See PROGRESS.md
 * before trying again.
 *
 * What the experiment DID prove is kept: reading pages three at a time cut the
 * average read from 3.5s to 2.5s per company, and stops five sequential 8s
 * reads from overrunning the reader's 15s provider budget.
 */

/** Pages read per company, homepage first. */
export const CONTACT_PATHS = ['', '/contact', '/contact-us', '/about', '/about-us'] as const

/** The URLs to read for a company, in order. Empty for an unusable domain. */
export function siteReadingList(host: string | null): string[] {
  const registrable = host?.replace(/^www\./, '')
  if (!registrable) return []
  return CONTACT_PATHS.map((path) => `https://${registrable}${path}/`)
}

/** Pages read after the homepage. */
export const FOLLOW_UP_PAGES = 4

/**
 * The pages to read after the homepage: the contact and about pages it LINKS
 * to first, then the guessed paths to fill what is left.
 *
 * ⚠️ GUESSED PATHS MISS REAL SITES. `/contact-us/` 404s on a site whose page
 * is `/get-in-touch`, `/kontakt` or `/pages/contact`; the homepage's own link
 * does not. Only links on the company's own host are followed — never a
 * third-party booking or form service.
 */
export function followUpPages(
  host: string,
  links: readonly { url: string; kind: string }[],
): string[] {
  const registrable = host.replace(/^www\./, '')
  const onSite = (url: string) => {
    try {
      const linked = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
      return linked === registrable || linked.endsWith(`.${registrable}`)
    } catch {
      return false
    }
  }
  const key = (url: string) => {
    const parsed = new URL(url)
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname.replace(/\/+$/, '')}`
  }
  const homepage = `${registrable}`
  const linked = [
    ...links.filter((link) => link.kind === 'contact'),
    ...links.filter((link) => link.kind === 'about'),
    // "Team" and "Our story" were `about` links until 2026-10-29; still read.
    ...links.filter((link) => link.kind === 'team'),
  ].map((link) => link.url).filter(onSite)

  const seen = new Set([homepage])
  const pages: string[] = []
  for (const url of [...linked, ...siteReadingList(registrable).slice(1)]) {
    const page = url.split('#')[0]!
    const id = key(page)
    if (seen.has(id)) continue
    seen.add(id)
    pages.push(page)
    if (pages.length === FOLLOW_UP_PAGES) break
  }
  return pages
}

/** People pages read per company, after the homepage. */
export const PEOPLE_PAGES = 3

/** Guessed when the homepage links no team page. */
const PEOPLE_PATHS = ['/team', '/about', '/about-us'] as const

/**
 * The pages where a company names its people: the team, people and press
 * pages its homepage LINKS to, then guessed paths. On-site only.
 *
 * A founder's address is rarely on /contact — that page carries the shared
 * inbox. It is on "Team", "Our story", or a press release's media contact.
 */
export function peoplePages(
  host: string,
  links: readonly { url: string; kind: string }[],
): string[] {
  const registrable = host.replace(/^www\./, '')
  const onSite = (url: string) => {
    try {
      const linked = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
      return linked === registrable || linked.endsWith(`.${registrable}`)
    } catch {
      return false
    }
  }
  const linked = [
    ...links.filter((link) => link.kind === 'team'),
    ...links.filter((link) => link.kind === 'news' && /press|media/i.test(link.url)),
  ].map((link) => link.url).filter(onSite)

  const seen = new Set<string>()
  const pages: string[] = []
  for (const url of [...linked, ...PEOPLE_PATHS.map((path) => `https://${registrable}${path}/`)]) {
    const page = url.split('#')[0]!
    const id = page.replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '')
    if (seen.has(id)) continue
    seen.add(id)
    pages.push(page)
    if (pages.length === PEOPLE_PAGES) break
  }
  return pages
}

/** Runs `work` over `items`, at most `limit` at once, preserving order. */
export async function inParallel<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await work(items[index]!)
    }
  })
  await Promise.all(runners)
  return results
}
