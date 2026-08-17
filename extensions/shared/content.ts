/**
 * Content script for lead-results pages.
 *
 * Two jobs, and deliberately nothing else:
 *
 *   1. Answer the background worker's questions about this page.
 *   2. Say when the USER has navigated to a different results page.
 *
 * It never clicks, never pages, never opens a profile. Navigation is the
 * user's; this only notices that it happened.
 *
 * ---------------------------------------------------------------------------
 * WHY NAVIGATION DETECTION LOOKS LIKE THIS
 * ---------------------------------------------------------------------------
 *
 * Sales Navigator is a single-page app: moving to page 2 swaps the list in
 * place, with no document load. So `load` events are useless and we watch
 * three things instead:
 *
 *   - pushState / replaceState  (patched, because they emit no event)
 *   - popstate                  (back and forward)
 *   - a MutationObserver        (list swapped without a URL change)
 *
 * The observer is the expensive one, so it is scoped to the results container
 * rather than the document, debounced, and told to ignore attribute churn —
 * Ember rewrites attributes constantly and reacting to that would fire on
 * every keystroke. It only reports when the ROW SIGNATURE changes, which is
 * what stops one re-render from being captured twice.
 */
import { adapterFor } from '../adapters/salesnav'
import { isCompanyPage, readCompanyPage } from '../adapters/salesnav-company'
import type { ContentMessage, ContentReply } from '../core/types'

declare const chrome: {
  runtime: {
    onMessage: {
      addListener(
        fn: (
          message: ContentMessage,
          sender: unknown,
          respond: (reply: ContentReply) => void,
        ) => boolean | undefined,
      ): void
    }
    sendMessage(message: unknown): Promise<unknown>
  }
}

const DEBOUNCE_MS = 800

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let lastSignature = ''
let observer: MutationObserver | null = null

/**
 * A cheap fingerprint of what is currently listed.
 *
 * Row count plus the first and last profile links. Enough to tell page 2 from
 * page 3, cheap enough to run on every mutation burst, and — critically —
 * unchanged by a re-render of the same page, so a redraw is not mistaken for
 * navigation.
 */
function signature(): string {
  const rows = document.querySelectorAll('li.artdeco-list__item, tr[data-x--people-list--row]')
  const links = document.querySelectorAll<HTMLAnchorElement>('a[href*="/sales/lead/"]')
  const first = links[0]?.getAttribute('href')?.split(',')[0] ?? ''
  const last = links[links.length - 1]?.getAttribute('href')?.split(',')[0] ?? ''
  return `${rows.length}|${first}|${last}`
}

/**
 * Company pages the user has already opened in this tab.
 *
 * Sales Navigator is a SPA and re-renders constantly; without this, one visit
 * to a company page would report the same website on every mutation burst.
 */
const reportedCompanies = new Set<string>()

/**
 * Reports a website listed on a company page the USER opened.
 *
 * ⚠️ NOTHING HERE NAVIGATES. This fires only because the user is already on the
 * page. The extension does not open company pages and must never learn how —
 * see the header of `extensions/adapters/salesnav-company.ts`.
 */
function announceCompanyIfSeen(): void {
  const url = window.location.href
  if (!isCompanyPage(url)) return

  const observation = readCompanyPage(document, url)
  // No website on the page is not worth a message.
  if (!observation) return

  if (reportedCompanies.has(observation.companyId)) return
  reportedCompanies.add(observation.companyId)

  void chrome.runtime.sendMessage({
    type: 'COMPANY_SEEN',
    companyId: observation.companyId,
    companyName: observation.companyName,
    websiteUrl: observation.websiteUrl,
  })
}

function announceIfChanged(): void {
  announceCompanyIfSeen()

  const adapter = adapterFor(window.location.href)
  if (!adapter || !adapter.isReady()) return

  const next = signature()
  if (next === lastSignature) return
  lastSignature = next

  void chrome.runtime.sendMessage({
    type: 'PAGE_CHANGED',
    url: window.location.href,
    pageIdentifier: adapter.getPageIdentifier(),
  })
}

function schedule(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(announceIfChanged, DEBOUNCE_MS)
}

function watch(): void {
  if (observer) return

  // Scoped to the list, not the document: observing <body> on a SPA this busy
  // would fire constantly for no benefit.
  const target =
    document.querySelector('ol.artdeco-list')?.parentElement
    ?? document.querySelector('main')
    ?? document.body

  observer = new MutationObserver(schedule)
  observer.observe(target, {
    childList: true,
    subtree: true,
    // Attributes are Ember noise. Ignoring them removes most of the work.
    attributes: false,
    characterData: false,
  })

  const patch = (name: 'pushState' | 'replaceState') => {
    const original = history[name]
    history[name] = function patched(this: History, ...args: Parameters<History['pushState']>) {
      const result = original.apply(this, args)
      schedule()
      return result
    }
  }

  patch('pushState')
  patch('replaceState')
  window.addEventListener('popstate', schedule)
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  const adapter = adapterFor(window.location.href)

  if (message.type === 'IS_SUPPORTED') {
    respond({
      ok: true,
      supported: Boolean(adapter),
      ready: adapter ? adapter.isReady() : false,
      pageIdentifier: adapter ? adapter.getPageIdentifier() : null,
    })
    return true
  }

  if (message.type === 'CAPTURE_NOW') {
    if (!adapter) {
      respond({ ok: false, error: 'This page is not a supported results page.' })
      return true
    }

    if (!adapter.isReady()) {
      respond({ ok: false, error: 'The results are still loading. Try again in a moment.' })
      return true
    }

    adapter
      .capture({ includeCompanyWebsites: message.includeCompanyWebsites === true })
      .then((captured) => {
        // Adopt the signature we just sent, so the re-render that usually
        // follows a capture is not treated as a new page.
        lastSignature = signature()
        respond({ ok: true, captured })
      })
      .catch((e: unknown) => {
        respond({ ok: false, error: e instanceof Error ? e.message : 'Could not read this page.' })
      })

    return true // keep the channel open for the async reply
  }

  return undefined
})

/*
 * Watch results pages AND company pages. A company page has no results list, so
 * `adapterFor` returns null for it — checking only that would mean the observer
 * never starts and a company page visited mid-session goes unnoticed.
 */
if (adapterFor(window.location.href) || isCompanyPage(window.location.href)) {
  watch()
  lastSignature = signature()
  announceCompanyIfSeen()
}
