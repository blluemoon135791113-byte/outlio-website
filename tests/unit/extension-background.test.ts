import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtensionMessage } from '../../extensions/core/types'

const api = vi.hoisted(() => ({
  fetchMe: vi.fn(), startSession: vi.fn(), finishSession: vi.fn(), sendPage: vi.fn(),
  sendCompanyObservation: vi.fn(), exchangePairingCode: vi.fn(),
}))
vi.mock('../../extensions/core/api', async (original) => ({ ...await original<typeof import('../../extensions/core/api')>(), ...api }))

const session = { id: 'fixture-session', pagesProcessed: 0, leadsFound: 0, leadsImported: 0, duplicatesSkipped: 0 }
const captured = { html: '<html>fixture</html>', sourceUrl: 'https://www.linkedin.com/sales/lists/company/1', sourceType: 'salesnav_account_list', pageName: 'Accounts', pageIdentifier: '1', contentHash: 'fixture-hash' }
type Sender = { url?: string; tab?: { id: number } }
let listener: (message: ExtensionMessage, sender: Sender, respond: (reply: unknown) => void) => unknown
let bag: Record<string, unknown>
let tabMessage: ReturnType<typeof vi.fn>
let createTab: ReturnType<typeof vi.fn>
function dispatch(message: ExtensionMessage, sender: Sender = {}) {
  return new Promise<Record<string, unknown>>((resolve) => listener(message, sender, resolve as (reply: unknown) => void))
}
const pageChanged = { type: 'PAGE_CHANGED' as const, url: captured.sourceUrl, pageIdentifier: '1' }
const salesSender = (id = 7) => ({ tab: { id }, url: 'https://www.linkedin.com/sales/lists/company/1' })
function defer() { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r }); return { promise, resolve } }

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks()
  bag = { 'outlio.auth': { accessToken: 'fixture', refreshToken: 'fixture', deviceId: 'fixture' } }
  api.fetchMe.mockResolvedValue({ canCapture: true, email: 'fixture@example.test', plan: 'Test', device: { id: 'fixture', label: 'Test' }, activeSession: session })
  api.startSession.mockResolvedValue(session)
  api.finishSession.mockResolvedValue(session)
  api.sendPage.mockResolvedValue({ success: true, queued: true, duplicate: false })
  api.sendCompanyObservation.mockResolvedValue({ leadsUpdated: 0 })
  tabMessage = vi.fn(async (_id, message) => message.type === 'IS_SUPPORTED' ? { supported: true, ready: true } : { ok: true, captured })
  createTab = vi.fn(async () => ({}))
  vi.stubGlobal('chrome', {
    runtime: { getURL: (path: string) => `chrome-extension://fixture/${path}`, onMessage: { addListener: (fn: typeof listener) => { listener = fn } } },
    tabs: { query: vi.fn(async () => [{ id: 7 }]), sendMessage: tabMessage, create: createTab },
    action: { setBadgeText: vi.fn(async () => {}), setBadgeBackgroundColor: vi.fn(async () => {}), setPopup: vi.fn(async () => {}) },
    sidePanel: { setPanelBehavior: vi.fn(async () => {}) },
    storage: { local: {
      get: vi.fn(async () => ({ ...bag })),
      set: vi.fn(async (items) => { Object.assign(bag, items) }),
      remove: vi.fn(async (keys: string[]) => keys.forEach((key) => { delete bag[key] })),
    } },
  })
  await import('../../extensions/shared/background')
})
afterEach(() => { vi.unstubAllGlobals() })

describe('extension background sessions', () => {
  it('does not adopt another device session just by opening the panel', async () => {
    expect(await dispatch({ type: 'GET_STATE' })).toMatchObject({ kind: 'ready', supported: true, ready: true })
    expect(bag['outlio.session']).toBeUndefined()
    await dispatch(pageChanged, salesSender())
    expect(api.sendPage).not.toHaveBeenCalled()
  })
  it('ignores an old identity poll that finishes after Start capture', async () => {
    const blocked = defer()
    api.fetchMe.mockImplementationOnce(async () => {
      await blocked.promise
      return { canCapture: true, email: 'fixture@example.test', plan: 'Test', device: { id: 'fixture', label: 'Test' }, activeSession: null }
    })
    const stalePoll = dispatch({ type: 'GET_STATE' })
    await vi.waitFor(() => expect(api.fetchMe).toHaveBeenCalledTimes(1))
    await dispatch({ type: 'START_CAPTURE' })
    blocked.resolve()
    expect(await stalePoll).toMatchObject({ kind: 'capturing', session })
    expect(bag['outlio.session']).toBe(session.id)
  })
  it('honors a server denial instead of presenting local capture controls', async () => {
    bag['outlio.session'] = session.id
    api.fetchMe.mockResolvedValueOnce({ canCapture: false })
    expect(await dispatch({ type: 'GET_STATE' })).toMatchObject({ kind: 'disabled' })
    expect(bag['outlio.session']).toBeUndefined()
  })
  it('does not turn switching away from a tab into a capture error', async () => {
    bag['outlio.session'] = session.id
    tabMessage.mockResolvedValueOnce({ ok: false, error: 'TAB_NOT_VISIBLE' })
    await dispatch(pageChanged, salesSender())
    expect(api.sendPage).not.toHaveBeenCalled()
    expect(await dispatch({ type: 'GET_STATE' })).toMatchObject({ kind: 'capturing' })
  })
  it('requires loaded rows before starting and saving local consent', async () => {
    tabMessage.mockResolvedValue({ supported: true, ready: false })
    expect(await dispatch({ type: 'START_CAPTURE' })).toEqual({ ok: false })
    expect(api.startSession).not.toHaveBeenCalled()
    expect(bag['outlio.session']).toBeUndefined()
  })
  it('starts explicitly and sends the account snapshot through the shared API', async () => {
    expect(await dispatch({ type: 'START_CAPTURE', dedupeMode: 'review', includeCompanyWebsites: true })).toEqual({ ok: true })
    expect(api.startSession).toHaveBeenCalledWith('review')
    expect(bag['outlio.session']).toBe(session.id)
    expect(api.sendPage).toHaveBeenCalledWith({ ...captured, sessionId: session.id })
    expect(tabMessage).toHaveBeenCalledWith(7, { type: 'CAPTURE_NOW', includeCompanyWebsites: true })
  })
  it('captures the tab reporting a page change rather than an unrelated active tab', async () => {
    bag['outlio.session'] = session.id
    await dispatch(pageChanged, salesSender(42))
    expect(tabMessage).toHaveBeenCalledWith(42, expect.objectContaining({ type: 'CAPTURE_NOW' }))
  })
  it('queues a page change arriving during an upload instead of dropping it', async () => {
    bag['outlio.session'] = session.id
    const blocked = defer()
    api.sendPage.mockImplementationOnce(() => blocked.promise)
    const first = dispatch(pageChanged, salesSender(7))
    await vi.waitFor(() => expect(api.sendPage).toHaveBeenCalledTimes(1))
    const second = dispatch(pageChanged, salesSender(42))
    blocked.resolve()
    await Promise.all([first, second])
    expect(api.sendPage).toHaveBeenCalledTimes(2)
    expect(tabMessage).toHaveBeenLastCalledWith(42, expect.objectContaining({ type: 'CAPTURE_NOW' }))
  })
  it('stops locally before draining a request and closing the server session', async () => {
    bag['outlio.session'] = session.id
    const blocked = defer()
    api.sendPage.mockImplementationOnce(() => blocked.promise)
    const capture = dispatch(pageChanged, salesSender())
    await vi.waitFor(() => expect(api.sendPage).toHaveBeenCalledTimes(1))
    const finish = dispatch({ type: 'FINISH_CAPTURE' })
    await vi.waitFor(() => expect(bag['outlio.session']).toBeUndefined())
    expect(api.finishSession).not.toHaveBeenCalled()
    blocked.resolve()
    await Promise.all([capture, finish])
    expect(api.finishSession).toHaveBeenCalledWith(session.id)
    await dispatch({ type: 'GET_STATE' })
    expect(bag['outlio.session']).toBeUndefined()
  })
  it('does not send a snapshot if Finish was chosen while the tab was responding', async () => {
    bag['outlio.session'] = session.id
    const blocked = defer()
    tabMessage.mockImplementationOnce(async () => { await blocked.promise; return { ok: true, captured } })
    const capture = dispatch(pageChanged, salesSender())
    await vi.waitFor(() => expect(tabMessage).toHaveBeenCalled())
    const finish = dispatch({ type: 'FINISH_CAPTURE' })
    await vi.waitFor(() => expect(bag['outlio.session']).toBeUndefined())
    blocked.resolve()
    await Promise.all([capture, finish])
    expect(api.sendPage).not.toHaveBeenCalled()
  })
  it('offers retryable errors without hanging the message port', async () => {
    api.startSession.mockRejectedValueOnce(new Error('offline'))
    expect(await dispatch({ type: 'START_CAPTURE' })).toEqual({ ok: false })
    expect(await dispatch({ type: 'GET_STATE' })).toMatchObject({ kind: 'error', retryable: true })
  })
  it('allows in-page controls on Sales Navigator and refuses commands from other web pages', async () => {
    bag['outlio.session'] = session.id
    expect(await dispatch({ type: 'GET_STATE' }, salesSender())).toMatchObject({ kind: 'capturing' })
    expect(await dispatch({ type: 'GET_STATE' }, { tab: { id: 42 }, url: 'https://example.test/' })).toEqual({ ok: false })
    await dispatch(pageChanged, { tab: { id: 42 }, url: 'https://example.test/' })
    expect(api.sendPage).not.toHaveBeenCalled()
  })
  it('accepts its own UI when the browser supplies a tab in the sender', async () => {
    expect(await dispatch({ type: 'GET_STATE' }, { tab: { id: 12 }, url: 'chrome-extension://fixture/panel.html' })).toMatchObject({ kind: 'ready' })
    expect(await dispatch({ type: 'GET_STATE' }, { tab: { id: 12 }, url: 'chrome-extension://other/panel.html' })).toEqual({ ok: false })
  })
  it('connects on the product host and authenticates the pairing sender + state', async () => {
    await dispatch({ type: 'CONNECT' })
    expect(createTab).toHaveBeenCalledWith({ url: expect.stringMatching(/^https:\/\/app\.outlio\.io\/extension\/connect\?/) })
    const state = bag['outlio.pairingState'] as string
    expect(await dispatch({ type: 'PAIRING_CODE', code: 'fixture-code', state }, { url: 'https://example.test/extension/connect', tab: { id: 1 } })).toEqual({ ok: false })
    expect(api.exchangePairingCode).not.toHaveBeenCalled()
    expect(await dispatch({ type: 'PAIRING_CODE', code: 'fixture-code', state }, { url: 'https://app.outlio.io/extension/connect', tab: { id: 1 } })).toEqual({ ok: true })
    expect(api.exchangePairingCode).toHaveBeenCalledWith('fixture-code', state)
  })
})
