/** Passive Sales Navigator observation. Outside an explicit capture session we
 * register listeners only: no person/company field reads, snapshots or polling.
 * The document observer survives replaced lists/main elements; URL polling also
 * sees pushState from LinkedIn's MAIN world (content scripts are isolated). */
import { adapterFor, pageSignature } from '../adapters/salesnav'
import { isCompanyPage, readCompanyPage } from '../adapters/salesnav-company'
import { readSessionId } from '../core/storage'
import { snapshotUrl } from '../core/page-snapshot'
import type { ContentMessage, ContentReply } from '../core/types'

declare const chrome: {
  runtime: {
    onMessage: {
      addListener(fn: (message: ContentMessage, sender: unknown, respond: (reply: ContentReply) => void) => boolean | undefined): void
    }
    sendMessage(message: unknown): Promise<unknown>
  }
  storage: {
    onChanged: {
      addListener(fn: (changes: Record<string, { newValue?: unknown }>, area: string) => void): void
    }
  }
}

const DEBOUNCE_MS = 800
let sessionId: string | null = null
let sessionEpoch = 0
let storageRevision = 0
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let routeTimer: ReturnType<typeof setInterval> | null = null
let observer: MutationObserver | null = null
let lastSignature = ''
let observedUrl = window.location.href
const reportedCompanies = new Set<string>()

function setSession(next: string | null): void {
  if (next === sessionId) return
  sessionId = next
  sessionEpoch += 1
  lastSignature = ''
  reportedCompanies.clear()
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  debounceTimer = null
  observer?.disconnect()
  observer = null
  if (routeTimer !== null) clearInterval(routeTimer)
  routeTimer = null
  if (!sessionId) return

  observedUrl = window.location.href
  observer = new MutationObserver(schedule)
  observer.observe(document, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    // Ignore Ember IDs, classes and event churn; notice in-place row hydration.
    attributeFilter: ['href', 'data-anonymize', 'data-x-search-result', 'aria-current'],
  })
  routeTimer = setInterval(() => {
    if (observedUrl === window.location.href) return
    observedUrl = window.location.href
    schedule()
  }, 500)
  schedule() // A new session on the SAME page must be observed again.
}

/** Ignore a stale get() if storage.onChanged delivered a newer session while
 * it was in flight. Storage failures close the gate, never fail open. */
async function refreshSession(): Promise<void> {
  const revision = storageRevision
  try {
    const next = await readSessionId()
    if (revision === storageRevision) setSession(next || null)
  } catch {
    if (revision === storageRevision) setSession(null)
  }
}

function announceCompanyIfSeen(): void {
  if (!sessionId || !isCompanyPage(window.location.href)) return
  const observation = readCompanyPage(document, window.location.href)
  if (!observation) return
  const key = JSON.stringify(observation)
  if (reportedCompanies.has(key)) return
  reportedCompanies.add(key)
  const epoch = sessionEpoch
  void chrome.runtime.sendMessage({ type: 'COMPANY_SEEN', ...observation }).catch(() => {
    if (epoch === sessionEpoch) reportedCompanies.delete(key)
  })
}

async function announceIfChanged(): Promise<void> {
  if (!sessionId || document.visibilityState !== 'visible') return
  const epoch = sessionEpoch
  await refreshSession()
  if (!sessionId || epoch !== sessionEpoch || document.visibilityState !== 'visible') return
  announceCompanyIfSeen()
  const adapter = adapterFor(window.location.href)
  if (!adapter || !adapter.isReady()) {
    lastSignature = ''
    return
  }
  const next = pageSignature(adapter)
  if (next === lastSignature) return
  lastSignature = next
  void chrome.runtime.sendMessage({
    type: 'PAGE_CHANGED',
    url: snapshotUrl(window.location.href),
    pageIdentifier: adapter.getPageIdentifier(),
  }).catch(() => {
    if (epoch === sessionEpoch && lastSignature === next) lastSignature = ''
  })
}

function schedule(): void {
  if (!sessionId || document.visibilityState !== 'visible') return
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void announceIfChanged()
  }, DEBOUNCE_MS)
}

// Hook installation does not inspect the page. It runs even on /sales/home,
// so later SPA navigation into a list cannot leave capture permanently inert.
for (const name of ['pushState', 'replaceState'] as const) {
  const original = history[name]
  history[name] = function (this: History, ...args: Parameters<History['pushState']>) {
    const result = original.apply(this, args)
    observedUrl = window.location.href
    schedule()
    return result
  }
}
window.addEventListener('popstate', schedule)
window.addEventListener('hashchange', schedule)
// Starting in one tab must not import every dormant list tab. Observe a hidden
// document only when the user actually switches to it during the session.
document.addEventListener('visibilitychange', schedule)

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !Object.prototype.hasOwnProperty.call(changes, 'outlio.session')) return
  storageRevision += 1
  const next = changes['outlio.session']?.newValue
  setSession(typeof next === 'string' && next ? next : null)
})

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.type === 'IS_SUPPORTED') {
    const adapter = adapterFor(window.location.href)
    respond({
      ok: true,
      supported: Boolean(adapter),
      // Readiness checks element presence only, never person/company values.
      ready: adapter ? adapter.isReady() : false,
      pageIdentifier: adapter ? adapter.getPageIdentifier() : null,
    })
    return true
  }

  if (message.type !== 'CAPTURE_NOW') return undefined
  void (async () => {
    await refreshSession()
    if (!sessionId) throw new Error('Start a capture session before capturing this page.')
    if (document.visibilityState !== 'visible') throw new Error('TAB_NOT_VISIBLE')
    const epoch = sessionEpoch
    const url = window.location.href
    const adapter = adapterFor(url)
    if (!adapter) throw new Error('This page is not a supported results page.')
    if (!adapter.isReady()) throw new Error('The results are still loading. Try again in a moment.')
    const signature = pageSignature(adapter)
    const captured = await adapter.capture({ includeCompanyWebsites: message.includeCompanyWebsites === true })
    await refreshSession()
    if (!sessionId || epoch !== sessionEpoch) throw new Error('The capture session ended or changed. Try again in the active session.')
    if (url !== window.location.href) throw new Error('The page changed during capture. Try again.')
    // Do not read/adopt the NEW page's signature after hashing an old snapshot.
    lastSignature = signature
    respond({ ok: true, captured })
  })().catch((error: unknown) => {
    respond({ ok: false, error: error instanceof Error ? error.message : 'Could not read this page.' })
  })
  return true
})

void refreshSession()
