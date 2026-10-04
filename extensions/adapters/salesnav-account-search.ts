/** Passive account SEARCH capture. The backend detects ACCOUNT cards from HTML;
 * the wire source remains salesnav_account_list, as for saved Account Lists. */
import type { CapturedPage, PageAdapter } from '../core/types'
import { sanitizePageElement, sha256Hex, snapshotUrl } from '../core/page-snapshot'

const ROW = '[data-x-search-result="ACCOUNT"]'
const IDENTITY = 'a[data-anonymize="company-name"][href*="/sales/company/"]'

export const salesNavAccountSearchAdapter: PageAdapter = {
  id: 'salesnav-account-search',
  sourceType: 'salesnav_account_list',

  supports(value: string): boolean {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' && !url.username && !url.password
        && /(^|\.)linkedin\.com$/i.test(url.hostname)
        && /^\/sales\/search\/company(?:\/|$)/i.test(url.pathname)
    } catch {
      return false
    }
  },

  isReady(): boolean {
    return Boolean(document.querySelector(`${ROW} ${IDENTITY}`))
  },

  getPageIdentifier(): string | null {
    const page = new URL(window.location.href).searchParams.get('page')
    if (page && /^\d{1,4}$/.test(page)) return page
    const text = document.querySelector('[aria-current="page"], [data-test-pagination-page-btn].active, .artdeco-pagination__indicator--number.active')?.textContent?.trim()
    return text && /^\d{1,4}$/.test(text) ? text : '1'
  },

  getPageName(): string {
    const name = document.querySelector('main h1, [role="main"] h1')?.textContent?.replace(/\s+/g, ' ').trim()
    return name && name.length <= 120 ? name : 'Sales Navigator account search'
  },

  async capture(): Promise<CapturedPage> {
    const rows = Array.from(document.querySelectorAll(ROW))
    if (!rows.some((row) => row.querySelector(IDENTITY))) throw new Error('the account results are still loading')
    // Only the cards, never surrounding filters, hidden inputs or page state.
    const cleaned = rows.map(sanitizePageElement).filter((row) => row !== null)
    const html = '<!doctype html><html><head><meta charset="utf-8"></head><body>'
      + cleaned.map((row) => row.outerHTML).join('') + '</body></html>'
    return {
      sourceType: 'salesnav_account_list',
      html,
      sourceUrl: snapshotUrl(window.location.href)!,
      pageName: salesNavAccountSearchAdapter.getPageName(),
      pageIdentifier: salesNavAccountSearchAdapter.getPageIdentifier(),
      contentHash: await sha256Hex(html),
    }
  },
}
