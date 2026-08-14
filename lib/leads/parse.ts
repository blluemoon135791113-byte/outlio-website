/**
 * Sales Navigator search-results parser.
 *
 * SOURCE OF TRUTH: docs/SELECTOR_MAP.md §3. Never the recovered Python — its
 * selectors target a table layout LinkedIn no longer ships.
 *
 * Pure: takes HTML text, returns rows. No I/O, no network, no database.
 * `CLAUDE.md` rule 1 — nothing here ever contacts linkedin.com.
 */
import * as cheerio from 'cheerio'

export type ParsedLead = {
  fullName: string | null
  /** Public profile URL built from the member URN. */
  linkedinUrl: string | null
  /** The Sales Navigator lead URL, retained for reference. */
  salesNavUrl: string | null
  /** LinkedIn member URN — the stable identity across saves. */
  memberUrn: string | null
  jobTitle: string | null
  companyName: string | null
  /** External company website, only when LinkedIn exposed it in the page UI. */
  companyWebsiteUrl: string | null
  /** Sales Navigator company page. */
  companyUrl: string | null
  location: string | null
  personBlurb: string | null
  tenureInRole: string | null
  tenureInCompany: string | null
  sourceRowIndex: number
}

export type ParseResult = {
  leads: ParsedLead[]
  /** Rows that matched the anchor but yielded no usable identity. */
  skippedRows: number
}

export class ParseError extends Error {
  readonly code: 'ERR_FILE_FORMAT' | 'ERR_NO_LEADS'
  constructor(code: ParseError['code'], message: string) {
    super(message)
    this.name = 'ParseError'
    this.code = code
  }
}

/** Collapses whitespace and trims. Returns null for anything empty. */
function text(value: string | undefined | null): string | null {
  if (!value) return null
  const cleaned = value.replace(/\s+/g, ' ').trim()
  return cleaned.length > 0 ? cleaned : null
}

/**
 * Extracts the LinkedIn member URN.
 *
 * Two sources, identical values (verified: 25 distinct from each, same set):
 *   - `urn:li:fs_salesProfile:(ACwAA…,NAME_SEARCH,xxxx)` on a row ancestor
 *   - the first path segment of `/sales/lead/ACwAA…,NAME_SEARCH,xxxx`
 *
 * Everything after the first comma is session-scoped and changes between saves,
 * so it is discarded — keeping it would break deduplication.
 */
function extractMemberUrn(salesNavHref: string | null, scrollUrn: string | null): string | null {
  if (scrollUrn) {
    const m = /urn:li:fs_salesProfile:\(([A-Za-z0-9_-]+)/.exec(scrollUrn)
    if (m?.[1]) return m[1]
  }
  if (salesNavHref) {
    const m = /\/sales\/lead\/([A-Za-z0-9_-]+)/.exec(salesNavHref)
    if (m?.[1]) return m[1]
  }
  return null
}

/**
 * Builds the public profile URL from the member URN.
 *
 * LinkedIn accepts a member URN in the `/in/` path and redirects to the
 * person's vanity URL. The saved HTML contains NO `publicIdentifier` or
 * `vanityName` field — verified zero occurrences across two real pages — so
 * this is the only way to reach a real profile without contacting LinkedIn,
 * which is prohibited.
 *
 * This is construction from an extracted identifier, not inference: no part of
 * the URL is guessed.
 */
function publicProfileUrl(href: string | null | undefined): string | null {
  const absolute = absolutize(href)
  if (!absolute) return null
  try {
    const parsed = new URL(absolute)
    if (!/(^|\.)linkedin\.com$/i.test(parsed.hostname)) return null
    return /^\/in\/[^/?#]+/i.test(parsed.pathname) ? absolute : null
  } catch {
    return null
  }
}

function canonicalSalesNavUrl(href: string | null, memberUrn: string | null): string | null {
  return absolutize(href) ?? (memberUrn
    ? `https://www.linkedin.com/sales/lead/${memberUrn}`
    : null)
}

/**
 * Splits the tenure blob into its two halves.
 *
 * ⚠️ `div[data-anonymize="job-title"]` is NOT the job title. It holds tenure:
 *
 *     "8 years 7 months in role"  +  "8 years 7 months in company"
 *
 * On real pages these are two sibling TEXT NODES, so `.text()` welds them into
 * `"8 years 7 months in role8 years 7 months in company"`. This is the single
 * most dangerous selector on the page: it is the one selector the old scraper
 * used that STILL MATCHES, so trusting it silently fills every lead's title
 * with tenure garbage (docs/SELECTOR_MAP.md §3).
 *
 * Parsing the combined string rather than walking child nodes means the result
 * is identical whether LinkedIn emits one text node or two — node boundaries
 * are an implementation detail we should not depend on.
 */
export function extractTenure(raw: string | null): {
  inRole: string | null
  inCompany: string | null
} {
  if (!raw) return { inRole: null, inCompany: null }

  const collapsed = raw.replace(/\s+/g, ' ').trim()
  if (!collapsed) return { inRole: null, inCompany: null }

  // No trailing \b after "role": when the two halves are welded the next
  // character is a digit, and `e`→`3` is not a word boundary, so \b would fail.
  const roleMatch = /^(.*?in role)/i.exec(collapsed)
  const remainder = roleMatch ? collapsed.slice(roleMatch[1].length) : collapsed
  const companyMatch = /(.*?in company)/i.exec(remainder)

  return {
    inRole: roleMatch?.[1]?.trim() || null,
    inCompany: companyMatch?.[1]?.trim() || null,
  }
}

function absolutize(href: string | null | undefined): string | null {
  if (!href) return null
  const t = href.trim()
  if (!t) return null
  if (/^https?:\/\//i.test(t)) return t
  if (t.startsWith('/')) return `https://www.linkedin.com${t}`
  return t
}

/**
 * Company URLs must identify a Sales Navigator company page. In the current
 * table layout a company label can sit inside a broader anchor for the person;
 * accepting the nearest arbitrary anchor silently writes the person's URL into
 * Company URL.
 */
function companyProfileUrl(href: string | null | undefined): string | null {
  const absolute = absolutize(href)
  if (!absolute) return null

  try {
    const parsed = new URL(absolute)
    if (!/(^|\.)linkedin\.com$/i.test(parsed.hostname)) return null
    if (!/^\/sales\/company\/[^/?#]+/i.test(parsed.pathname)) return null
    return absolute
  } catch {
    return null
  }
}

/**
 * Parses one saved search-results page.
 *
 * @throws ParseError ERR_FILE_FORMAT when the row anchor matches nothing —
 *   a zero-lead result is ALWAYS a loud error, never a silent empty success.
 *   LinkedIn has already broken this parser once.
 */
export function parseSearchResults(html: string): ParseResult {
  const $ = cheerio.load(html)

  // LinkedIn currently ships both the legacy card list and a newer people
  // table. Stable data attributes are used instead of generated CSS classes.
  // The person-name filter excludes headers, sidebar rows, and other decoys.
  const rows = $('li.artdeco-list__item, tr[data-x--people-list--row]').filter(
    (_, el) => $(el).find('[data-anonymize="person-name"]').length > 0,
  )

  if (rows.length === 0) {
    throw new ParseError(
      'ERR_FILE_FORMAT',
      'no lead rows matched a supported saved search-results layout',
    )
  }

  const leads: ParsedLead[] = []
  let skippedRows = 0

  rows.each((index, el) => {
    const row = $(el)

    const modernTableRow = row.is('tr[data-x--people-list--row]')
    const nameEl = row.find('[data-anonymize="person-name"]').first()
    const fullName = text(nameEl.text())

    // Sales Nav href: the anchor wrapping the name, else the headshot link.
    const nameAnchor = nameEl.closest('a[href]')
    const salesNavHref =
      nameAnchor.attr('href') ??
      row
        .find('[data-anonymize="headshot-photo"]')
        .closest('a[href]')
        .first()
        .attr('href') ??
      null

    // `data-scroll-into-view` carries the fs_salesProfile URN on an ancestor.
    const scrollUrn =
      row.find('[data-scroll-into-view]').first().attr('data-scroll-into-view') ??
      row.attr('data-scroll-into-view') ??
      null

    const memberUrn = extractMemberUrn(salesNavHref, scrollUrn)
    const publicHref = row
      .find('a[href^="/in/"], a[href*="linkedin.com/in/"]')
      .first()
      .attr('href')

    // No name AND no identity means nothing usable. Count it, do not invent it.
    if (!fullName && !memberUrn) {
      skippedRows += 1
      return
    }

    // The field name changed meaning between layouts. In the legacy card,
    // `title` is the role and `job-title` is tenure. In the current table,
    // `job-title` is the actual role and tenure is not present.
    const jobTitle = text(
      row
        .find(
          modernTableRow
            ? '[data-anonymize="job-title"]'
            : 'span[data-anonymize="title"]',
        )
        .first()
        .text(),
    )

    const tenureEl = modernTableRow
      ? null
      : row.find('div[data-anonymize="job-title"]').first()
    const { inRole: tenureInRole, inCompany: tenureInCompany } = extractTenure(
      tenureEl && tenureEl.length > 0 ? tenureEl.text() : null,
    )

    // Company is an anchor in the card layout and a span in the table layout.
    const companyEl = row.find('[data-anonymize="company-name"]').first()
    const companyAnchor = companyEl.is('a[href*="/sales/company/"]')
      ? companyEl
      : companyEl.closest('a[href*="/sales/company/"]')
    let companyName = text(companyEl.text())
    const companyUrl = companyProfileUrl(companyAnchor.attr('href') ?? null)
    const companyWebsiteUrl = text(companyEl.attr('data-outlio-company-website'))

    // …otherwise the name is a BARE TEXT NODE in the subtitle. Without this
    // fallback we silently lose the company on ~20% of leads (1 of 5 on a real
    // page). See docs/SELECTOR_MAP.md §3.
    if (!companyName) {
      const subtitle = row.find('div.artdeco-entity-lockup__subtitle').first()
      if (subtitle.length > 0) {
        const candidates = subtitle
          .contents()
          .filter((_, node) => node.type === 'text')
          .map((_, node) => text($(node).text()))
          .get()
          .filter((v): v is string => Boolean(v))

        if (candidates.length > 0) {
          companyName = candidates.reduce((a, b) => (b.length > a.length ? b : a))
        }
      }
    }

    leads.push({
      fullName,
      linkedinUrl: publicProfileUrl(publicHref),
      salesNavUrl: canonicalSalesNavUrl(salesNavHref, memberUrn),
      memberUrn,
      jobTitle,
      companyName,
      companyUrl,
      companyWebsiteUrl,
      location: text(row.find('[data-anonymize="location"]').first().text()),
      personBlurb: text(row.find('[data-anonymize="person-blurb"]').first().text()),
      tenureInRole,
      tenureInCompany,
      sourceRowIndex: index + 1,
    })
  })

  if (leads.length === 0) {
    throw new ParseError('ERR_NO_LEADS', `matched ${rows.length} rows but none yielded a lead`)
  }

  return { leads, skippedRows }
}
