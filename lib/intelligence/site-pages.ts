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
