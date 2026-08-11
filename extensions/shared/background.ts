/**
 * Background service worker — the extension's brain.
 *
 * Owns tokens, session state and the toolbar badge. The popup holds no state
 * of its own: it asks for a snapshot and renders it. That matters because a
 * popup is destroyed every time it closes, and an MV3 worker is evicted when
 * idle, so ANYTHING that must survive lives in chrome.storage rather than in
 * a variable.
 *
 * The capture loop is entirely user-driven. This worker reacts to two things:
 * a button the user pressed, and a page change the user caused. It never
 * initiates navigation.
 */
import {
  ApiError,
  type ExtensionMessage,
  type ExtensionState,
  type SessionTotals,
} from '../core/types'
import {
  API_BASE,
  exchangePairingCode,
  fetchMe,
  finishSession,
  sendPage,
  startSession,
} from '../core/api'
import {
  clearAuth,
  readAuth,
  readSessionId,
  takePairingState,
  writePairingState,
  writeSessionId,
} from '../core/storage'

declare const chrome: {
  runtime: {
    onMessage: {
      addListener(
        fn: (
          message: ExtensionMessage,
          sender: { tab?: { id?: number } },
          respond: (reply: unknown) => void,
        ) => boolean | undefined,
      ): void
    }
    lastError?: { message?: string }
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

/** Transient, popup-facing status. Deliberately not persisted. */
let lastError: { message: string; retryable: boolean } | null = null
let busy = false

async function setBadge(active: boolean): Promise<void> {
  await chrome.action.setBadgeText({ text: active ? 'ON' : '' })
  if (active) {
    await chrome.action.setBadgeBackgroundColor({ color: '#6b4eff' })
  }
}

async function activeTab(): Promise<{ id?: number; url?: string } | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab ?? null
}

/** Asks the content script about the current tab. Absent script = unsupported. */
async function pageStatus(): Promise<{ supported: boolean; ready: boolean }> {
  const tab = await activeTab()
  if (!tab?.id) return { supported: false, ready: false }

  try {
    const reply = (await chrome.tabs.sendMessage(tab.id, { type: 'IS_SUPPORTED' })) as {
      supported?: boolean
      ready?: boolean
    }
    return { supported: reply?.supported === true, ready: reply?.ready === true }
  } catch {
    // No content script on this tab: not a supported page.
    return { supported: false, ready: false }
  }
}

function messageForError(e: unknown): { message: string; retryable: boolean } {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'SUBSCRIPTION_REQUIRED':
        return { message: 'Your subscription is inactive.', retryable: false }
      case 'EXTENSION_DISABLED':
        return { message: 'Extension access is disabled for this account.', retryable: false }
      case 'DEVICE_REVOKED':
      case 'UNAUTHENTICATED':
        return { message: 'This browser was disconnected. Connect again.', retryable: false }
      case 'ERR_LIMIT_REACHED':
        return { message: 'You are out of extraction credits this month.', retryable: false }
      case 'RATE_LIMITED':
        return { message: 'Too many pages too quickly. Wait a moment.', retryable: true }
      case 'NETWORK':
        return { message: 'No connection. Your session is still active.', retryable: true }
      default:
        return { message: 'Something went wrong sending that page.', retryable: true }
    }
  }
  return { message: e instanceof Error ? e.message : 'Unexpected error.', retryable: true }
}

/** Builds the whole popup view in one round trip. */
async function currentState(): Promise<ExtensionState> {
  if (lastError) return { kind: 'error', ...lastError }
  if (busy) {
    const sessionId = await readSessionId()
    if (sessionId) {
      return {
        kind: 'processing',
        account: { email: null, plan: null, deviceLabel: 'This browser' },
        session: {
          id: sessionId,
          pagesProcessed: 0,
          leadsFound: 0,
          leadsImported: 0,
          duplicatesSkipped: 0,
        },
      }
    }
  }

  if (!(await readAuth())) return { kind: 'not_connected' }

  let me: Awaited<ReturnType<typeof fetchMe>>
  try {
    me = await fetchMe()
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.code === 'SUBSCRIPTION_REQUIRED') {
        return { kind: 'no_subscription', message: 'Active subscription required.' }
      }
      if (e.code === 'EXTENSION_DISABLED') {
        return { kind: 'disabled', message: 'Extension access is disabled for this account.' }
      }
      if (e.code === 'DEVICE_REVOKED' || e.code === 'UNAUTHENTICATED') {
        await clearAuth()
        return { kind: 'not_connected' }
      }
    }
    const { message, retryable } = messageForError(e)
    return { kind: 'error', message, retryable }
  }

  const account = {
    email: me.email,
    plan: me.plan,
    deviceLabel: me.device.label,
  }

  const { supported } = await pageStatus()

  if (me.activeSession) {
    await writeSessionId(me.activeSession.id)
    await setBadge(true)
    return { kind: 'capturing', account, session: me.activeSession, supported }
  }

  await writeSessionId(null)
  await setBadge(false)
  return { kind: 'ready', account, supported }
}

/** Captures the active tab and posts it. Duplicates are a normal outcome. */
async function captureActivePage(): Promise<void> {
  const sessionId = await readSessionId()
  if (!sessionId || busy) return

  const tab = await activeTab()
  if (!tab?.id) return

  busy = true
  try {
    const reply = (await chrome.tabs.sendMessage(tab.id, { type: 'CAPTURE_NOW' })) as
      | { ok: true; captured: { html: string; sourceUrl: string; pageIdentifier: string | null; contentHash: string } }
      | { ok: false; error: string }

    if (!reply?.ok) {
      // Not fatal: the user may simply have opened a non-results tab.
      return
    }

    await sendPage({
      sessionId,
      html: reply.captured.html,
      sourceUrl: reply.captured.sourceUrl,
      pageIdentifier: reply.captured.pageIdentifier,
      contentHash: reply.captured.contentHash,
    })

    lastError = null
  } catch (e) {
    lastError = messageForError(e)

    // A dead session should not keep retrying against a closed id.
    if (e instanceof ApiError && (e.code === 'SESSION_CLOSED' || e.code === 'SESSION_NOT_FOUND')) {
      await writeSessionId(null)
      await setBadge(false)
    }
  } finally {
    busy = false
  }
}

async function connect(): Promise<void> {
  const state = crypto.randomUUID()
  await writePairingState(state)

  const params = new URLSearchParams({
    state,
    browser: 'Chrome',
    platform: navigator.platform || 'Unknown',
  })

  await chrome.tabs.create({ url: `${API_BASE}/extension/connect?${params.toString()}` })
}

async function start(): Promise<SessionTotals | null> {
  try {
    const session = await startSession()
    await writeSessionId(session.id)
    await setBadge(true)
    lastError = null
    // Capture whatever is already open, so the first page is not skipped.
    await captureActivePage()
    return session
  } catch (e) {
    lastError = messageForError(e)
    return null
  }
}

async function finish(): Promise<SessionTotals | null> {
  const sessionId = await readSessionId()
  if (!sessionId) return null

  try {
    const totals = await finishSession(sessionId)
    await writeSessionId(null)
    await setBadge(false)
    lastError = null
    return totals
  } catch (e) {
    lastError = messageForError(e)
    return null
  }
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  ;(async () => {
    switch (message.type) {
      case 'GET_STATE':
        respond(await currentState())
        return

      case 'CONNECT':
        await connect()
        respond({ ok: true })
        return

      case 'START_CAPTURE':
        respond({ ok: Boolean(await start()) })
        return

      case 'FINISH_CAPTURE': {
        const totals = await finish()
        respond(totals ? { ok: true, totals } : { ok: false })
        return
      }

      case 'RETRY':
        lastError = null
        respond(await currentState())
        return

      case 'OPEN_DASHBOARD':
        await chrome.tabs.create({ url: `${API_BASE}/dashboard` })
        respond({ ok: true })
        return

      case 'PAGE_CHANGED':
        // The user moved. Capture only while a session is running — outside
        // one this is ignored entirely and nothing is read.
        if (await readSessionId()) await captureActivePage()
        respond({ ok: true })
        return

      case 'PAIRING_CODE': {
        const expected = await takePairingState()
        if (!expected || expected !== message.state) {
          lastError = { message: 'That connection did not match this browser.', retryable: false }
          respond({ ok: false })
          return
        }

        try {
          await exchangePairingCode(message.code, message.state)
          lastError = null
          respond({ ok: true })
        } catch (e) {
          lastError = messageForError(e)
          respond({ ok: false })
        }
        return
      }

      default:
        respond({ ok: false })
    }
  })()

  return true // async responses
})
