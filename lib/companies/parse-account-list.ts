/**
 * Sales Navigator Account Hub / saved Account List parser.
 *
 * Validated against a real saved Account Hub page on 2026-08-28. The page
 * rendered 25 rows anchored by `data-x--account-hub--table-data-row`, with one
 * `data-anonymize="company-name"` and one `data-anonymize="industry"` per row.
 * No network request is made here; this is a pure HTML parser.
 */
import * as cheerio from 'cheerio'

/**
 * A cheerio selection.
 *
 * ⚠️ DERIVED, NOT NAMED. cheerio 1.x stopped exporting `Element` — that type
 * now lives in `domhandler` — so `cheerio.Cheerio<cheerio.Element>` fails to
 * compile. Taking the API's own return type keeps this correct without adding
 * a dependency on cheerio's internal DOM package just to spell a parameter.
 */
type SelectedNodes = ReturnType<cheerio.CheerioAPI>

export type ParsedAccountRecommendation = {
  fullName: string
  salesNavUrl: string
  memberId: string
  jobTitle: string | null
  connectionDegree: string | null
}

export type ParsedAccount = {
  companyName: string
  salesNavUrl: string
  companyId: string
  industry: string | null
  connectionPaths: string | null
  alert: string | null
  recommendation: ParsedAccountRecommendation | null
  sourceRowIndex: number
}

export type AccountListParseResult = {
  listName: string | null
  accounts: ParsedAccount[]
  skippedRows: number
}

export class AccountListParseError extends Error {
  readonly code = 'ERR_FILE_FORMAT' as const

  constructor(message: string) {
    super(message)
    this.name = 'AccountListParseError'
  }
}

function clean(value: string | null | undefined): string | null {
  const result = value?.replace(/\s+/g, ' ').trim() ?? ''
  return result.length > 0 ? result : null
}

function absoluteLinkedInUrl(value: string | null | undefined): string | null {
  if (!value) return null

  try {
    const url = new URL(value, 'https://www.linkedin.com')
    const host = url.hostname.toLowerCase().replace(/\.+$/, '')
    if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return null
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function companyId(value: string | null): string | null {
  if (!value) return null
  try {
    const match = /^\/sales\/company\/(\d{1,20})(?:\/|$)/i.exec(new URL(value).pathname)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

function memberId(value: string | null): string | null {
  if (!value) return null
  try {
    const match = /^\/sales\/lead\/([A-Za-z0-9_-]{10,})(?:,|\/|$)/.exec(new URL(value).pathname)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

function meaningfulCellText(value: string | null): string | null {
  if (!value || /^(none|not available|—|-)$/i.test(value)) return null
  return value
}

function readListName($: cheerio.CheerioAPI): string | null {
  const snapshotName = clean($('[data-outlio-account-list-name]').first().attr('data-outlio-account-list-name'))
  if (snapshotName) return snapshotName

  const selected = clean($('[data-x--account-hub--selected-tab--account]').first().text())
  if (selected) return selected

  const title = clean($('title').first().text())
  if (!title) return null
  const head = title.split(/\s*\|\s*/)[0]?.trim() ?? ''
  return head && !/^sales navigator$/i.test(head) ? head : null
}

/** Parse the Account Hub table without reading Notes or any hidden page state. */
export function parseAccountList(html: string): AccountListParseResult {
  const $ = cheerio.load(html)
  const rows = $('[data-x--account-hub--table-data-row]')

  if (rows.length === 0) {
    throw new AccountListParseError('no account rows matched the validated Account Hub layout')
  }

  const columnIndex = new Map<string, number>()
  $('[data-x-accounts-dashboard-table-column-header]').each((index, element) => {
    const label = clean($(element).text())?.toLowerCase()
    if (label) columnIndex.set(label, index)
  })

  const cellText = (row: SelectedNodes, label: string): string | null => {
    const index = columnIndex.get(label)
    if (index === undefined) return null
    return meaningfulCellText(clean(row.children('td').eq(index).text()))
  }

  const accounts: ParsedAccount[] = []
  let skippedRows = 0

  rows.each((index, element) => {
    const row = $(element)
    const companyAnchor = row
      .find('[data-anonymize="company-name"]')
      .filter('a[href*="/sales/company/"]')
      .first()
    const name = clean(companyAnchor.text())
    const salesNavUrl = absoluteLinkedInUrl(companyAnchor.attr('href'))
    const id = companyId(salesNavUrl)

    if (!name || !salesNavUrl || !id) {
      skippedRows += 1
      return
    }

    const personAnchor = row
      .find('[data-anonymize="person-name"]')
      .filter('a[href*="/sales/lead/"]')
      .first()
    const personName = clean(personAnchor.text())
    const personUrl = absoluteLinkedInUrl(personAnchor.attr('href'))
    const personId = memberId(personUrl)
    const degreeMatch = /\b(1st|2nd|3rd)\b/i.exec(row.text())

    accounts.push({
      companyName: name,
      salesNavUrl,
      companyId: id,
      industry: clean(row.find('[data-anonymize="industry"]').first().text()),
      connectionPaths: cellText(row, 'connection paths'),
      alert: cellText(row, 'alerts'),
      recommendation:
        personName && personUrl && personId
          ? {
              fullName: personName,
              salesNavUrl: personUrl,
              memberId: personId,
              jobTitle: clean(row.find('[data-anonymize="job-title"]').first().text()),
              connectionDegree: degreeMatch?.[1]?.toLowerCase() ?? null,
            }
          : null,
      sourceRowIndex: index,
    })
  })

  if (accounts.length === 0) {
    throw new AccountListParseError('Account Hub rows contained no usable company identities')
  }

  return { listName: readListName($), accounts, skippedRows }
}
