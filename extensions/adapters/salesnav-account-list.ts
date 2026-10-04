/**
 * Sales Navigator saved Account List / Account Hub adapter.
 *
 * It reads only the table the user opened. It never pages, scrolls, clicks,
 * opens a company, or contacts LinkedIn itself.
 */
import type { CapturedPage, PageAdapter } from '../core/types'
import { sanitizePageElement, sha256Hex, snapshotUrl } from '../core/page-snapshot'

const TABLE = '[data-x--account-hub--table]'
const ROW = '[data-x--account-hub--table-data-row]'

function clean(value: string | null | undefined): string | null {
  const result = value?.replace(/\s+/g, ' ').trim() ?? ''
  return result.length > 0 ? result : null
}

export const salesNavAccountListAdapter: PageAdapter = {
  id: 'salesnav-account-list',
  sourceType: 'salesnav_account_list',

  supports(url: string): boolean {
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !/(^|\.)linkedin\.com$/i.test(parsed.hostname)) return false
      return /^\/sales\/(lists\/company|accounts?|account-hub)(?:\/|$)/i.test(parsed.pathname)
    } catch {
      return false
    }
  },

  isReady(): boolean {
    return Boolean(document.querySelector(`${TABLE} ${ROW} a[data-anonymize="company-name"][href*="/sales/company/"]`))
  },

  getPageIdentifier(): string | null {
    const fromUrl = new URL(window.location.href).searchParams.get('page')
    if (fromUrl && /^\d{1,4}$/.test(fromUrl)) return fromUrl
    const text = document.querySelector('[aria-current="page"], [data-test-pagination-page-btn].active, .artdeco-pagination__indicator--number.active')?.textContent?.trim()
    return text && /^\d{1,4}$/.test(text) ? text : '1'
  },

  getPageName(): string {
    const selected = clean(
      document.querySelector('[data-x--account-hub--selected-tab--account]')?.textContent,
    )
    if (selected && selected.length <= 120) return selected

    const title = document.title.split(/\s*\|\s*/)[0]?.trim()
    return title && title.length <= 120 ? title : 'Sales Navigator account list'
  },

  async capture(): Promise<CapturedPage> {
    const table = document.querySelector(TABLE)
    if (!table || table.querySelectorAll(ROW).length === 0) {
      throw new Error('the account list is still loading')
    }

    const cleaned = sanitizePageElement(table)
    if (!cleaned) throw new Error('the account table could not be read')
    cleaned.setAttribute('data-outlio-account-list-name', salesNavAccountListAdapter.getPageName())

    const html =
      '<!doctype html><html><head><meta charset="utf-8"></head><body>'
      + cleaned.outerHTML
      + '</body></html>'

    return {
      sourceType: 'salesnav_account_list',
      html,
      sourceUrl: snapshotUrl(window.location.href)!,
      pageName: salesNavAccountListAdapter.getPageName(),
      pageIdentifier: salesNavAccountListAdapter.getPageIdentifier(),
      contentHash: await sha256Hex(html),
    }
  },
}
