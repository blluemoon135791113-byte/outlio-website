import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContentMessage, ContentReply } from '@/extensions/core/types'

const SESSION = 'outlio.session'
const leads = (id = 'fabricated-1') => `<main><ol class="artdeco-list"><li class="artdeco-list__item"><a href="/sales/lead/${id}"><span data-anonymize="person-name">Example Person</span></a></li></ol></main>`
const accounts = (id = '10001') => `<main><table data-x--account-hub--table><tr data-x--account-hub--table-data-row><td><a data-anonymize="company-name" href="/sales/company/${id}">Example Company</a></td></tr></table></main>`
const search = (id = '10001') => `<main><div data-x-search-result="ACCOUNT"><a data-anonymize="company-name" href="/sales/company/${id}">Example Company</a></div></main>`
const company = '<main><h1>Example Company</h1><a data-control-name="visit_company_website" href="https://company.example.com">Website</a></main>'
let dom: JSDOM
let savedSession: string | null
let messageListener: (message: ContentMessage, sender: unknown, reply: (value: ContentReply) => void) => unknown
let storageListener: (changes: Record<string, { newValue?: unknown }>, area: string) => void
let sendMessage: ReturnType<typeof vi.fn>
let storageGet: ReturnType<typeof vi.fn>

beforeEach(() => { vi.useFakeTimers(); vi.resetModules() })
afterEach(() => {
  storageListener?.({ [SESSION]: {} }, 'local')
  dom?.window.close()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function boot(html: string, path: string, session: string | null = null, initialRead?: Promise<Record<string, unknown>>) {
  savedSession = session
  dom = new JSDOM(html, { url: `https://www.linkedin.com${path}`, pretendToBeVisual: true })
  for (const key of ['window', 'document', 'history', 'Node', 'MutationObserver'] as const) vi.stubGlobal(key, dom.window[key])
  sendMessage = vi.fn().mockResolvedValue({ ok: true })
  storageGet = vi.fn().mockImplementation(async () => ({ [SESSION]: savedSession }))
  if (initialRead) storageGet.mockImplementationOnce(() => initialRead)
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage,
      onMessage: { addListener: (fn: typeof messageListener) => { messageListener = fn } },
    },
    storage: {
      local: { get: storageGet },
      onChanged: { addListener: (fn: typeof storageListener) => { storageListener = fn } },
    },
  })
  const adapters = await import('@/extensions/adapters/salesnav')
  const companies = await import('@/extensions/adapters/salesnav-company')
  const signature = vi.spyOn(adapters, 'pageSignature')
  const readCompany = vi.spyOn(companies, 'readCompanyPage')
  await import('@/extensions/shared/content')
  await Promise.resolve()
  return { adapters, signature, readCompany }
}
function setSession(value: string | null) {
  savedSession = value
  storageListener({ [SESSION]: { newValue: value ?? undefined } }, 'local')
}
function request(message: ContentMessage): Promise<ContentReply> {
  return new Promise((resolve) => { messageListener(message, {}, resolve) })
}
async function settle(ms = 850) {
  await Promise.resolve() // deliver native MutationObserver microtasks first
  await vi.advanceTimersByTimeAsync(ms)
}
function messages(type: string) { return sendMessage.mock.calls.filter(([message]) => message.type === type) }
function replaceBody(html: string) {
  // Test data only; no saved/customer HTML is ever rendered by production code.
  const fresh = new JSDOM(html)
  document.body.replaceChildren(...Array.from(fresh.window.document.body.childNodes).map((node) => document.importNode(node, true)))
  fresh.window.close()
}

describe('explicit-session privacy gate', () => {
  it('does not read lead/company values at startup or during navigation outside a session', async () => {
    const { signature, readCompany } = await boot(leads(), '/sales/search/people')
    const name = document.querySelector('[data-anonymize="person-name"]')!
    const text = vi.spyOn(name, 'textContent', 'get')
    expect(await request({ type: 'IS_SUPPORTED' })).toMatchObject({ ok: true, supported: true, ready: true })
    expect(await request({ type: 'CAPTURE_NOW' })).toMatchObject({ ok: false, error: expect.stringContaining('session') })
    await settle()
    history.pushState({}, '', '/sales/company/10001')
    replaceBody(company)
    await settle()
    expect(signature).not.toHaveBeenCalled()
    expect(readCompany).not.toHaveBeenCalled()
    expect(text).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(storageGet.mock.calls.every(([keys]) => JSON.stringify(keys) === JSON.stringify([SESSION]))).toBe(true)
  })
  it('does not capture dormant list tabs until the user views them', async () => {
    const { signature } = await boot(accounts(), '/sales/lists/company/1')
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    setSession('session-1')
    await settle()
    expect(signature).not.toHaveBeenCalled()
    expect(messages('PAGE_CHANGED')).toHaveLength(0)
    expect(await request({ type: 'CAPTURE_NOW' })).toMatchObject({ ok: false, error: 'TAB_NOT_VISIBLE' })
    visibility.mockReturnValue('visible')
    document.dispatchEvent(new dom.window.Event('visibilitychange'))
    await settle()
    expect(messages('PAGE_CHANGED')).toHaveLength(1)
  })
  it('announces a currently-open page on start and again for a new same-page session', async () => {
    await boot(accounts(), '/sales/lists/company/1')
    setSession('session-1')
    await settle()
    expect(messages('PAGE_CHANGED')).toHaveLength(1)
    setSession(null)
    document.querySelector('a')!.setAttribute('href', '/sales/company/10002')
    await settle()
    expect(messages('PAGE_CHANGED')).toHaveLength(1)
    setSession('session-2')
    await settle()
    expect(messages('PAGE_CHANGED')).toHaveLength(2)
    expect(await request({ type: 'CAPTURE_NOW' })).toMatchObject({ ok: true, captured: { sourceType: 'salesnav_account_list' } })
    setSession(null)
    setSession('session-3')
    await settle()
    expect(messages('PAGE_CHANGED')).toHaveLength(3)
  })
  it('cancels pending announcements when stopped and ignores other storage areas', async () => {
    const { signature } = await boot(leads(), '/sales/search/people')
    storageListener({ [SESSION]: { newValue: 'wrong-area' } }, 'sync')
    await settle()
    expect(signature).not.toHaveBeenCalled()
    setSession('session-1')
    await settle(200)
    setSession(null)
    await settle()
    expect(signature).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })
  it('fails closed if storage cannot confirm the session', async () => {
    const { signature } = await boot(leads(), '/sales/search/people', 'session-1')
    storageGet.mockRejectedValue(new Error('storage unavailable'))
    expect(await request({ type: 'CAPTURE_NOW' })).toMatchObject({ ok: false })
    await settle()
    expect(signature).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })
  it('does not resurrect a stale session when an initial storage read races its removal', async () => {
    let resolve!: (value: Record<string, unknown>) => void
    const pending = new Promise<Record<string, unknown>>((done) => { resolve = done })
    const { signature } = await boot(leads(), '/sales/search/people', null, pending)
    setSession(null)
    resolve({ [SESSION]: 'stale-session' })
    await settle()
    expect(signature).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })
  it.each([null, 'session-2'])('discards an in-flight capture when the session becomes %s', async (next) => {
    const { adapters, signature } = await boot(leads(), '/sales/search/people', 'session-1')
    const adapter = adapters.adapterFor(window.location.href)!
    const captured = await adapter.capture()
    let resolve!: (value: typeof captured) => void
    vi.spyOn(adapter, 'capture').mockImplementation(() => new Promise((done) => { resolve = done }))
    const response = request({ type: 'CAPTURE_NOW' })
    await settle(0)
    expect(resolve).toBeTypeOf('function')
    setSession(next)
    signature.mockClear()
    resolve(captured)
    expect(await response).toMatchObject({ ok: false, error: expect.stringContaining('session') })
    expect(signature).not.toHaveBeenCalled()
  })
})

describe('passive SPA changes', () => {
  it('observes navigation from initial sales home and complete main/container replacement', async () => {
    await boot('<main>Home</main>', '/sales/home', 'session-1')
    await settle()
    expect(messages('PAGE_CHANGED')).toHaveLength(0)
    history.pushState({}, '', '/sales/lists/company/1')
    replaceBody(accounts('10001'))
    await settle()
    expect(messages('PAGE_CHANGED')).toHaveLength(1)
    replaceBody(accounts('10002'))
    await settle()
    expect(messages('PAGE_CHANGED')).toHaveLength(2)
    history.pushState({}, '', '/sales/search/people')
    replaceBody(leads())
    await settle()
    expect(messages('PAGE_CHANGED')).toHaveLength(3)
  })
  it.each([
    ['/sales/lists/company/1', accounts], ['/sales/search/company', search], ['/sales/search/people', leads],
  ])('captures in-place row identity changes, not identical redraws on %s', async (path, html) => {
    await boot(html('10001'), path, 'session-1')
    await settle()
    expect(messages('PAGE_CHANGED')).toHaveLength(1)
    replaceBody(html('10001'))
    await settle()
    expect(messages('PAGE_CHANGED')).toHaveLength(1)
    const anchor = document.querySelector('a')!
    anchor.setAttribute('href', anchor.getAttribute('href')!.replace('10001', '10002'))
    await settle()
    expect(messages('PAGE_CHANGED')).toHaveLength(2)
  })
  it('detects MAIN-world URL changes even when isolated-world history hooks see nothing', async () => {
    await boot(accounts(), '/sales/lists/company/1?page=1', 'session-1')
    await settle()
    dom.reconfigure({ url: 'https://www.linkedin.com/sales/lists/company/1?page=2' })
    await settle(1400)
    expect(messages('PAGE_CHANGED')).toHaveLength(2)
    expect(messages('PAGE_CHANGED')[1]![0].pageIdentifier).toBe('2')
  })
  it('rejects a snapshot if navigation happens while hashing it', async () => {
    const { adapters } = await boot(leads(), '/sales/search/people', 'session-1')
    const adapter = adapters.adapterFor(window.location.href)!
    const captured = await adapter.capture()
    let resolve!: (value: typeof captured) => void
    vi.spyOn(adapter, 'capture').mockImplementation(() => new Promise((done) => { resolve = done }))
    const response = request({ type: 'CAPTURE_NOW' })
    await settle(0)
    history.pushState({}, '', '/sales/search/company')
    resolve(captured)
    expect(await response).toMatchObject({ ok: false, error: expect.stringContaining('page changed') })
  })
})

describe('company observations', () => {
  it('reads only during a session, deduplicates rerenders, resets on session restart', async () => {
    const { readCompany } = await boot(company, '/sales/company/10001')
    await settle()
    expect(readCompany).not.toHaveBeenCalled()
    setSession('session-1')
    await settle()
    expect(messages('COMPANY_SEEN')).toHaveLength(1)
    expect(messages('COMPANY_SEEN')[0]![0]).toMatchObject({ companyId: '10001', websiteUrl: 'https://company.example.com/' })
    replaceBody(company)
    await settle()
    expect(messages('COMPANY_SEEN')).toHaveLength(1)
    setSession(null)
    readCompany.mockClear()
    replaceBody(company)
    await settle()
    expect(readCompany).not.toHaveBeenCalled()
    setSession('session-2')
    await settle()
    expect(messages('COMPANY_SEEN')).toHaveLength(2)
  })
})
