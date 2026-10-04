/**
 * Sales Navigator ACCOUNT SEARCH results parser (`/sales/search/company`).
 *
 * Validated against a real saved page on 2026-10-03 (kept locally under
 * `private/`, never committed). 25 rows, each anchored by
 * `data-x-search-result="ACCOUNT"`:
 *
 *   a[data-anonymize="company-name"][href*="/sales/company/"]  name + link   25/25
 *   [data-anonymize="industry"]                                industry      25/25
 *   a[data-anonymize="company-size"]                           "253 employees" 25/25
 *   [data-anonymize="location"]                                headquarters  0/25 (blank in this save)
 *   [data-anonymize="person-blurb"]                            About — see below
 *   [data-control-name^="search_spotlight_"]                   signals (hiring 16, strategic priorities 3)
 *
 * ⚠️ THE ABOUT TEXT IS READ FROM THE `title` ATTRIBUTE, NOT THE VISIBLE TEXT.
 * On screen LinkedIn shows a truncated preview behind a "…see more" button
 * (`data-truncated`); the full text, 46–1,985 characters in the sample, is the
 * description element's `title`. Reading the visible text would store a
 * clipped sentence as if it were the company's summary. With no `title`, the
 * summary is NULL — never the preview.
 *
 * Anchors are `data-*` hooks only (docs/SELECTOR_MAP.md): ember ids and CSS
 * module hashes change on every LinkedIn deploy. Pure — no network.
 */
import * as cheerio from 'cheerio'

import { AccountListParseError, type ParsedAccount } from '@/lib/companies/parse-account-list'

const MAX_SUMMARY = 5000
const MAX_LOCATION = 200
const MAX_SIGNALS = 10

function clean(value: string | null | undefined): string | null {
  const result = value?.replace(/\s+/g, ' ').trim() ?? ''
  return result.length > 0 ? result : null
}

/** Absolute https LinkedIn URL with the query (session state) and hash removed. */
function companyLink(href: string | undefined): { url: string; id: string } | null {
  if (!href) return null
  try {
    const url = new URL(href, 'https://www.linkedin.com')
    const host = url.hostname.toLowerCase().replace(/\.+$/, '')
    if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return null
    const match = /^\/sales\/company\/(\d{1,20})(?:\/|$)/i.exec(url.pathname)
    if (!match?.[1]) return null
    return { url: `https://www.linkedin.com/sales/company/${match[1]}`, id: match[1] }
  } catch {
    return null
  }
}

/**
 * "253 employees" → an exact count. "1.2K+ employees" or "10,001+ employees"
 * → a RANGE, kept as printed ("1.2K+"), never turned into a number (0145).
 * Anything else → neither.
 */
export function readHeadcount(text: string | null): { count: number | null; range: string | null } {
  const value = clean(text)
  if (!value) return { count: null, range: null }
  const exact = /^(\d{1,3}(?:,\d{3})*|\d+)\s+employees?$/i.exec(value)
  if (exact?.[1]) {
    const count = Number(exact[1].replace(/,/g, ''))
    return Number.isSafeInteger(count) ? { count, range: null } : { count: null, range: null }
  }
  const range = /^(\d[\d.,]*\s?[KM]?\+|\d[\d.,]*\s?[KM]|\d[\d,]*\s?[-–]\s?\d[\d,]*)\s+employees?$/i.exec(value)
  if (range?.[1] && range[1].length <= 40) return { count: null, range: range[1].replace(/\s+/g, '') }
  return { count: null, range: null }
}

/** The About text from `title`, line breaks kept, runs of spaces collapsed. */
function readSummary(title: string | undefined): string | null {
  if (!title) return null
  const text = title
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!text) return null
  // LinkedIn caps About at 2,000 characters. Anything past our bound is not
  // stored clipped; it is not stored.
  return text.length <= MAX_SUMMARY ? text : null
}

export type AccountSearchParseResult = { accounts: ParsedAccount[]; skippedRows: number }

export function parseAccountSearch(html: string): AccountSearchParseResult {
  const $ = cheerio.load(html)
  const rows = $('[data-x-search-result="ACCOUNT"]')

  if (rows.length === 0) {
    throw new AccountListParseError('no account rows matched the validated account search layout')
  }

  const accounts: ParsedAccount[] = []
  let skippedRows = 0

  rows.each((index, element) => {
    const row = $(element)
    const anchor = row.find('a[data-anonymize="company-name"]').filter('[href*="/sales/company/"]').first()
    const name = clean(anchor.text())
    const link = companyLink(anchor.attr('href'))
    if (!name || !link) {
      skippedRows += 1
      return
    }

    const headcount = readHeadcount(row.find('[data-anonymize="company-size"]').first().text())
    const location = clean(row.find('[data-anonymize="location"]').first().text())

    const signals: string[] = []
    row.find('[data-control-name^="search_spotlight_"]').each((_, spot) => {
      const key = ($(spot).attr('data-control-name') ?? '').slice('search_spotlight_'.length)
      if (/^[a-z0-9_]{1,60}$/.test(key) && !signals.includes(key) && signals.length < MAX_SIGNALS) signals.push(key)
    })

    accounts.push({
      companyName: name,
      salesNavUrl: link.url,
      companyId: link.id,
      industry: clean(row.find('[data-anonymize="industry"]').first().text()),
      connectionPaths: null,
      alert: null,
      recommendation: null,
      sourceList: null,
      sourceRowIndex: index,
      pageKind: 'account_search',
      employeeCount: headcount.count,
      employeeCountRange: headcount.range,
      summary: readSummary(row.find('[data-anonymize="person-blurb"]').first().attr('title')),
      location: location && location.length <= MAX_LOCATION ? location : null,
      signals,
    })
  })

  if (accounts.length === 0) {
    throw new AccountListParseError('account search rows contained no usable company identities')
  }

  return { accounts, skippedRows }
}
