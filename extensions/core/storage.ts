/**
 * Credential and session storage.
 *
 * `chrome.storage.local` rather than `sync`: tokens are bound to one device by
 * design, and syncing them to every browser on the account would defeat the
 * whole point of per-device revocation.
 *
 * The `chrome` global exists under the same name in Firefox (MV3) and Safari,
 * so this file needs no per-browser branching. Only the manifest differs.
 */
import type { StoredAuth } from './types'

const AUTH_KEY = 'outlio.auth'
const SESSION_KEY = 'outlio.session'
const STATE_KEY = 'outlio.pairingState'

declare const chrome: {
  storage: {
    local: {
      get(keys: string[]): Promise<Record<string, unknown>>
      set(items: Record<string, unknown>): Promise<void>
      remove(keys: string[]): Promise<void>
    }
  }
}

export async function readAuth(): Promise<StoredAuth | null> {
  const bag = await chrome.storage.local.get([AUTH_KEY])
  const value = bag[AUTH_KEY] as StoredAuth | undefined

  if (!value?.accessToken || !value.refreshToken || !value.deviceId) return null
  return value
}

export async function writeAuth(auth: StoredAuth): Promise<void> {
  await chrome.storage.local.set({ [AUTH_KEY]: auth })
}

/**
 * Removes every credential.
 *
 * Called on DEVICE_REVOKED so a revoked install stops presenting a token it
 * already knows is dead, rather than retrying until the user notices.
 */
export async function clearAuth(): Promise<void> {
  await chrome.storage.local.remove([AUTH_KEY, SESSION_KEY])
}

export async function readSessionId(): Promise<string | null> {
  const bag = await chrome.storage.local.get([SESSION_KEY])
  const value = bag[SESSION_KEY]
  return typeof value === 'string' ? value : null
}

export async function writeSessionId(sessionId: string | null): Promise<void> {
  if (sessionId === null) {
    await chrome.storage.local.remove([SESSION_KEY])
    return
  }
  await chrome.storage.local.set({ [SESSION_KEY]: sessionId })
}

/**
 * The CSRF value for an in-flight pairing.
 *
 * Written before the connect tab opens and compared when the code comes back,
 * so a code from a page we did not initiate is rejected.
 */
export async function writePairingState(state: string): Promise<void> {
  await chrome.storage.local.set({ [STATE_KEY]: state })
}

export async function takePairingState(): Promise<string | null> {
  const bag = await chrome.storage.local.get([STATE_KEY])
  const value = bag[STATE_KEY]
  await chrome.storage.local.remove([STATE_KEY])
  return typeof value === 'string' ? value : null
}
