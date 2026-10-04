/** Session/capture coordinator. No LinkedIn navigation; tokens stay here. */
import { ApiError, type CapturedPage, type ExtensionMessage, type ExtensionState, type SessionTotals } from '../core/types'
import { API_BASE, exchangePairingCode, fetchMe, finishSession, sendCompanyObservation, sendPage, startSession } from '../core/api'
import { clearAuth, readAuth, readCaptureOptions, readSessionId, takePairingState, writePairingState, writeCaptureOptions, writeSessionId } from '../core/storage'
import { configurePanel } from './panel'

type Sender = { tab?: { id?: number; url?: string }; url?: string }
declare const chrome: {
  runtime: {
    getURL(path: string): string
    onMessage: { addListener(fn: (message: ExtensionMessage, sender: Sender, respond: (reply: unknown) => void) => boolean | undefined): void }
  }
  tabs: {
    query(q: { active: boolean; currentWindow: boolean }): Promise<Array<{ id?: number; url?: string }>>
    sendMessage(tabId: number, message: unknown): Promise<unknown>
    create(props: { url: string }): Promise<unknown>
  }
  action: {
    setBadgeText(details: { text: string }): Promise<void>
    setBadgeBackgroundColor(details: { color: string }): Promise<void>
  }
}

configurePanel()
let lastError: { message: string; retryable: boolean } | null = null
let captureFlight: Promise<void> | null = null
let lifecycleBusy = false
const pendingTabs = new Set<number>()
let lastSession: SessionTotals | null = null
let meCache: { at: number; value: Awaited<ReturnType<typeof fetchMe>> } | null = null
let meFlight: ReturnType<typeof fetchMe> | null = null
let identityRevision = 0
function invalidateIdentity() {
  identityRevision += 1
  meCache = null
  meFlight = null
}
async function me() {
  if (meCache && Date.now() - meCache.at < 5_000) return meCache.value
  if (!meFlight) {
    const revision = identityRevision
    const flight = fetchMe().then((value) => {
      if (revision === identityRevision) meCache = { at: Date.now(), value }
      return value
    }).finally(() => { if (meFlight === flight) meFlight = null })
    meFlight = flight
  }
  return meFlight
}

async function setBadge(active: boolean) {
  await chrome.action.setBadgeText({ text: active ? 'ON' : '' })
  if (active) await chrome.action.setBadgeBackgroundColor({ color: '#2563eb' })
}
async function activeTab() { return (await chrome.tabs.query({ active: true, currentWindow: true }))[0] ?? null }
async function pageStatus(tabId?: number) {
  const tab = tabId === undefined ? await activeTab() : { id: tabId }
  if (tab?.id === undefined) return { supported: false, ready: false }
  try {
    const reply = await chrome.tabs.sendMessage(tab.id, { type: 'IS_SUPPORTED' }) as { supported?: boolean; ready?: boolean }
    return { supported: reply?.supported === true, ready: reply?.ready === true }
  } catch { return { supported: false, ready: false } }
}
function messageForError(error: unknown): { message: string; retryable: boolean } {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'SUBSCRIPTION_REQUIRED': return { message: 'Your subscription is inactive.', retryable: false }
      case 'EXTENSION_DISABLED': return { message: 'Extension access is disabled for this account.', retryable: false }
      case 'DEVICE_REVOKED':
      case 'UNAUTHENTICATED': return { message: 'This browser was disconnected. Connect again.', retryable: false }
      case 'ERR_LIMIT_REACHED': return { message: 'You are out of extraction credits this month.', retryable: false }
      case 'RATE_LIMITED': return { message: 'Too many requests. Wait a moment, then retry this page.', retryable: true }
      case 'NETWORK': return { message: 'Cannot reach Outlio. Check your connection, then retry this page.', retryable: true }
      case 'SESSION_CLOSED':
      case 'SESSION_NOT_FOUND': return { message: 'This capture session has ended. Start a new session.', retryable: true }
      default: return { message: 'Outlio could not accept this page. Retry or check the dashboard.', retryable: true }
    }
  }
  return { message: 'Could not read this tab. Refresh your Sales Navigator tab after installing or updating the extension.', retryable: true }
}
async function currentState(tabId?: number): Promise<ExtensionState> {
  const localSession = await readSessionId()
  if (lastError) return { kind: 'error', ...lastError, sessionActive: Boolean(localSession) }
  if (!(await readAuth())) return { kind: 'not_connected' }
  let identity: Awaited<ReturnType<typeof fetchMe>>
  try { identity = await me() } catch (error) {
    if (error instanceof ApiError) {
      if (['DEVICE_REVOKED', 'UNAUTHENTICATED'].includes(error.code)) {
        await clearAuth(); await setBadge(false); return { kind: 'not_connected' }
      }
      if (error.code === 'SUBSCRIPTION_REQUIRED') return { kind: 'no_subscription', message: 'Active subscription required.' }
      if (error.code === 'EXTENSION_DISABLED') return { kind: 'disabled', message: 'Extension access is disabled for this account.' }
    }
    return { kind: 'error', ...messageForError(error), sessionActive: Boolean(localSession) }
  }
  if (await readSessionId() !== localSession) return currentState()
  if (!identity.canCapture) {
    await writeSessionId(null); await setBadge(false)
    return { kind: 'disabled', message: 'Extension capture is not available for this account.' }
  }
  const account = { email: identity.email, plan: identity.plan, deviceLabel: identity.device.label }
  const page = await pageStatus(tabId)
  // Never silently adopt another browser's server session. Only Start writes
  // a local session; that local consent is what enables this content script.
  if (localSession && identity.activeSession?.id === localSession) {
    lastSession = identity.activeSession
    return captureFlight
      ? { kind: 'processing', account, session: identity.activeSession }
      : { kind: 'capturing', account, session: identity.activeSession, ...page }
  }
  if (localSession) { await writeSessionId(null); await setBadge(false) }
  return { kind: 'ready', account, ...page }
}

async function captureTab(tabId: number, sessionId: string) {
  try {
    const options = await readCaptureOptions()
    const reply = await chrome.tabs.sendMessage(tabId, { type: 'CAPTURE_NOW', includeCompanyWebsites: options.includeCompanyWebsites }) as
      | { ok: true; captured: CapturedPage } | { ok: false; error: string }
    if (!reply?.ok) {
      if (reply?.error === 'TAB_NOT_VISIBLE') return
      lastError = { message: 'The list is still loading or empty. Keep it open, then choose Capture this page.', retryable: true }
      return
    }
    // Stop/reconnect can happen while the DOM settles. Do not send afterward.
    if (await readSessionId() !== sessionId) return
    await sendPage({ sessionId, ...reply.captured })
    lastError = null
    invalidateIdentity()
  } catch (error) {
    lastError = messageForError(error)
    if (error instanceof ApiError && ['SESSION_CLOSED', 'SESSION_NOT_FOUND', 'DEVICE_REVOKED', 'UNAUTHENTICATED'].includes(error.code)) {
      await writeSessionId(null); await setBadge(false)
    }
  }
}
async function capture(tabId?: number) {
  const id = tabId ?? (await activeTab())?.id
  if (id === undefined || !(await readSessionId())) return
  pendingTabs.add(id)
  if (!captureFlight) {
    captureFlight = (async () => {
      // A page change during an upload queues another snapshot rather than
      // vanishing behind a busy flag. Always capture the sender tab, not a
      // different currently active tab.
      while (pendingTabs.size) {
        const next = pendingTabs.values().next().value!
        pendingTabs.delete(next)
        const sessionId = await readSessionId()
        if (!sessionId) { pendingTabs.clear(); break }
        await captureTab(next, sessionId)
      }
    })().finally(() => { captureFlight = null })
  }
  await captureFlight
}

async function connect() {
  const state = crypto.randomUUID()
  await writePairingState(state)
  const browser = /Firefox\//.test(navigator.userAgent) ? 'Firefox' : 'Chrome'
  await chrome.tabs.create({ url: `${API_BASE}/extension/connect?${new URLSearchParams({ state, browser, platform: navigator.platform || 'Unknown' })}` })
}
async function start(message: Extract<ExtensionMessage, { type: 'START_CAPTURE' }>, tabId?: number) {
  if (lifecycleBusy) return false
  lifecycleBusy = true
  try {
    const page = await pageStatus(tabId)
    if (!page.supported || !page.ready) {
      lastError = { message: 'Open a loaded Sales Navigator lead or account list first. Refresh the tab if you just updated Outlio.', retryable: true }
      return false
    }
    await writeCaptureOptions({ includeCompanyWebsites: message.includeCompanyWebsites === true })
    lastSession = await startSession(message.dedupeMode ?? 'remove_exact')
    await writeSessionId(lastSession.id)
    await setBadge(true)
    lastError = null; invalidateIdentity()
    await capture(tabId)
    return true
  } catch (error) { lastError = messageForError(error); return false }
  finally { lifecycleBusy = false }
}
async function finish() {
  if (lifecycleBusy) return null
  lifecycleBusy = true
  try {
    const sessionId = await readSessionId()
    if (!sessionId) return null
    // Stop local observation immediately; then drain an already-sent request
    // before asking the server to close the session.
    await writeSessionId(null); pendingTabs.clear(); await setBadge(false)
    await captureFlight
    const totals = await finishSession(sessionId)
    lastSession = totals; lastError = null; invalidateIdentity()
    return totals
  } catch (error) { lastError = messageForError(error); return null }
  finally { lifecycleBusy = false }
}
function isSalesTab(sender: Sender) {
  try { const url = new URL(sender.url ?? sender.tab?.url ?? ''); return sender.tab?.id !== undefined && url.origin === 'https://www.linkedin.com' && url.pathname.startsWith('/sales/') } catch { return false }
}
function isConnectTab(sender: Sender) {
  try { const url = new URL(sender.url ?? ''); return url.origin === API_BASE && url.pathname === '/extension/connect' } catch { return false }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // The in-page modal is an extension-owned content-script surface. It may
  // use the same commands as the native panel, but only from LinkedIn /sales.
  const ownPage = sender.url?.startsWith(chrome.runtime.getURL('')) === true
  const contentScriptMessage = ['PAGE_CHANGED', 'COMPANY_SEEN', 'PAIRING_CODE'].includes(message.type)
  const inPageControl = ['GET_STATE', 'CONNECT', 'START_CAPTURE', 'FINISH_CAPTURE', 'CAPTURE_PAGE', 'RETRY', 'OPEN_DASHBOARD'].includes(message.type)
  if (sender.tab && !ownPage && !contentScriptMessage && (!inPageControl || !isSalesTab(sender))) { respond({ ok: false }); return false }
  void (async () => {
    switch (message.type) {
      case 'GET_STATE': return respond(await currentState(sender.tab?.id))
      case 'CONNECT': await connect(); return respond({ ok: true })
      case 'START_CAPTURE': return respond({ ok: await start(message, sender.tab?.id) })
      case 'CAPTURE_PAGE': await capture(sender.tab?.id); return respond(await currentState(sender.tab?.id))
      case 'FINISH_CAPTURE': { const totals = await finish(); return respond(totals ? { ok: true, totals } : { ok: false }) }
      case 'RETRY': lastError = null; invalidateIdentity(); if (await readSessionId()) await capture(sender.tab?.id); return respond(await currentState(sender.tab?.id))
      case 'OPEN_DASHBOARD': await chrome.tabs.create({ url: `${API_BASE}/dashboard/jobs` }); return respond({ ok: true })
      case 'PAGE_CHANGED': if (isSalesTab(sender) && await readSessionId()) await capture(sender.tab!.id); return respond({ ok: true })
      case 'COMPANY_SEEN':
        if (isSalesTab(sender) && await readSessionId()) {
          const { type: _type, ...observation } = message
          try { await sendCompanyObservation(observation) } catch { /* Optional observation cannot break capture. */ }
        }
        return respond({ ok: true })
      case 'PAIRING_CODE': {
        if (!isConnectTab(sender)) return respond({ ok: false })
        const expected = await takePairingState()
        if (!expected || expected !== message.state) {
          lastError = { message: 'That connection expired or did not match. Choose Connect account again.', retryable: false }
          return respond({ ok: false })
        }
        await writeSessionId(null); pendingTabs.clear(); await setBadge(false)
        await captureFlight
        await exchangePairingCode(message.code, message.state)
        lastError = null; invalidateIdentity()
        return respond({ ok: true })
      }
      default: return respond({ ok: false })
    }
  })().catch((error) => { lastError = messageForError(error); respond({ ok: false, error: lastError.message }) })
  return true
})
