import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adapterFor, companyDetailsFrom, pageSignature } from '@/extensions/adapters/salesnav'
import { isCompanyPage } from '@/extensions/adapters/salesnav-company'
import { sanitizePageElement, snapshotUrl } from '@/extensions/core/page-snapshot'
import { parseSearchResults } from '@/lib/leads/parse'
import { parseAccountList } from '@/lib/companies/parse-account-list'
import { parseAccountSearch } from '@/lib/companies/parse-account-search'
import { detectSavedPageType } from '@/lib/leads/page-type'

// Fabricated fixtures only. JSDOM loads no resources and runs no page scripts.
let dom: JSDOM
function page(html: string, path: string) {
  dom = new JSDOM(html, { url: `https://www.linkedin.com${path}` })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('Node', dom.window.Node)
  vi.stubGlobal('MutationObserver', dom.window.MutationObserver)
  return dom.window.document
}
function fixture(name: string) { return readFileSync(`tests/fixtures/html/${name}.html`, 'utf8') }
const accountRow = (id: string) => `<tr data-x--account-hub--table-data-row><td><a data-anonymize="company-name" href="/sales/company/${id}">Company ${id}</a></td></tr>`

afterEach(() => { dom?.window.close(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('supported Sales Navigator route boundaries', () => {
  it.each([
    ['/sales/search/people', 'salesnav'], ['/sales/lists/people/123', 'salesnav'],
    ['/sales/people', 'salesnav'], ['/sales/lists/company/123', 'salesnav-account-list'],
    ['/sales/accounts', 'salesnav-account-list'], ['/sales/account-hub', 'salesnav-account-list'],
    ['/sales/search/company?page=2', 'salesnav-account-search'],
  ])('routes %s to %s', (path, id) => {
    expect(adapterFor(`https://www.linkedin.com${path}`)?.id).toBe(id)
  })
  it.each([
    'https://www.linkedin.com/sales/home', 'https://www.linkedin.com/sales/lead/fabricated-1',
    'https://www.linkedin.com/sales/company/123', 'https://www.linkedin.com/sales/search/peopleXYZ',
    'https://www.linkedin.com/sales/lists/companyXYZ', 'https://www.linkedin.com/sales/search/companyXYZ',
    'https://linkedin.com.example.com/sales/search/people', 'http://www.linkedin.com/sales/search/people',
    'https://name:secret@www.linkedin.com/sales/search/people', 'not a URL',
  ])('rejects %s', (url) => { expect(adapterFor(url)).toBeNull() })
  it('bounds company observation routes too', () => {
    expect(isCompanyPage('https://www.linkedin.com/sales/company/123')).toBe(true)
    expect(isCompanyPage('https://www.linkedin.com/sales/company/123no')).toBe(false)
    expect(isCompanyPage('https://example.com/sales/company/123')).toBe(false)
    expect(isCompanyPage('http://www.linkedin.com/sales/company/123')).toBe(false)
  })
})

describe('account and lead snapshots remain parseable', () => {
  it('captures saved Account Lists including recommendations and list provenance', async () => {
    page(fixture('account-list-valid'), '/sales/lists/company/123?page=2&_ntb=fabricated-secret')
    const adapter = adapterFor(window.location.href)!
    expect(adapter.isReady()).toBe(true)
    const captured = await adapter.capture()
    expect(captured.sourceType).toBe('salesnav_account_list')
    expect(captured.pageIdentifier).toBe('2')
    expect(captured.sourceUrl).not.toContain('fabricated-secret')
    expect(detectSavedPageType(captured.html)).toBe('account_list')
    const parsed = parseAccountList(captured.html)
    expect(parsed.listName).toBe('Priority accounts')
    expect(parsed.accounts).toHaveLength(2)
    expect(parsed.accounts[0]).toMatchObject({ companyId: '10001', recommendation: { fullName: 'Ada Example' } })
  })
  it('captures account SEARCH as accounts, preserving title, headcount and signals', async () => {
    page(fixture('account-search-valid'), '/sales/search/company')
    const adapter = adapterFor(window.location.href)!
    expect(adapter.isReady()).toBe(true)
    const captured = await adapter.capture()
    expect(captured.sourceType).toBe('salesnav_account_list')
    expect(detectSavedPageType(captured.html)).toBe('account_search')
    const result = parseAccountSearch(captured.html)
    expect(result.accounts).toHaveLength(3)
    expect(result.accounts[0]).toMatchObject({
      companyId: '100000001', employeeCount: 253,
      summary: 'Fabricated Widgets builds imaginary widgets for example.com.\nFounded in a test fixture, it has never existed.',
      signals: ['hiring_on_linkedin'],
    })
    expect(result.accounts[1]).toMatchObject({ employeeCountRange: '1.2K+', summary: null })
  })
  it.each(['valid-search-results', 'current-table-results'])('captures lead layout %s', async (name) => {
    page(fixture(name), '/sales/lists/people/123')
    const adapter = adapterFor(window.location.href)!
    expect(adapter.isReady()).toBe(true)
    const captured = await adapter.capture({ includeCompanyWebsites: false })
    expect(captured.sourceType).toBe('salesnav_lead_results')
    expect(captured.pageIdentifier).toBe('1') // API claim cannot accept null.
    const parsed = parseSearchResults(captured.html)
    expect(parsed.leads.length).toBeGreaterThan(0)
    expect(parsed.leads[0]!.jobTitle).toBeTruthy()
    expect(captured.html).not.toContain('NAME_SEARCH')
  })
  it('does not call an account shell ready', () => {
    page('<table data-x--account-hub--table><tr data-x--account-hub--table-data-row><td>Loading</td></tr></table>', '/sales/lists/company/1')
    expect(adapterFor(window.location.href)!.isReady()).toBe(false)
  })
})

describe('stable fingerprints and snapshot hashes', () => {
  it('detects middle account changes with no person links or row-count changes', () => {
    const doc = page(`<table data-x--account-hub--table>${['101', '102', '103'].map(accountRow).join('')}</table>`, '/sales/lists/company/1')
    const adapter = adapterFor(window.location.href)!
    const before = pageSignature(adapter)
    doc.querySelectorAll('a')[1]!.setAttribute('href', '/sales/company/104')
    expect(pageSignature(adapter)).not.toBe(before)
  })
  it('detects all lead identities, ignoring comma suffixes and tracking queries', () => {
    const doc = page(`<ol class="artdeco-list">${[1, 2, 3].map((id) => `<li class="artdeco-list__item"><a href="/sales/lead/fabricated-${id},NAME_SEARCH,token?_ntb=a"><span data-anonymize="person-name">Person ${id}</span></a></li>`).join('')}</ol>`, '/sales/search/people')
    const adapter = adapterFor(window.location.href)!
    const before = pageSignature(adapter)
    doc.querySelectorAll('a')[1]!.setAttribute('href', '/sales/lead/fabricated-2,OTHER,token?_ntb=b')
    expect(pageSignature(adapter)).toBe(before)
    doc.querySelectorAll('a')[1]!.setAttribute('href', '/sales/lead/fabricated-4')
    expect(pageSignature(adapter)).not.toBe(before)
  })
  it('detects account-search changes and page-only navigation', () => {
    const doc = page(fixture('account-search-valid'), '/sales/search/company?page=1')
    const adapter = adapterFor(window.location.href)!
    const first = pageSignature(adapter)
    doc.querySelector('[data-anonymize="company-name"]')!.setAttribute('href', '/sales/company/999')
    const changed = pageSignature(adapter)
    expect(changed).not.toBe(first)
    dom.reconfigure({ url: 'https://www.linkedin.com/sales/search/company?page=2' })
    expect(pageSignature(adapter)).not.toBe(changed)
  })
  it('hashes identically after Ember IDs, attribute ordering and tracking links churn', async () => {
    const doc = page(fixture('account-list-valid'), '/sales/lists/company/123')
    const adapter = adapterFor(window.location.href)!
    const first = await adapter.capture()
    doc.querySelectorAll('*').forEach((node, index) => {
      node.setAttribute('id', `ember${index}`)
      node.classList.add('_generated_css_hash', 'active')
      node.setAttribute('data-session-token', 'fabricated-secret')
      node.setAttribute('aria-label', 'volatile label')
      const href = node.getAttribute('href')
      if (href) node.setAttribute('href', `${href}?_ntb=volatile&csrfToken=secret`)
      const marker = node.getAttribute('data-anonymize')
      if (marker) { node.removeAttribute('data-anonymize'); node.setAttribute('data-anonymize', marker) }
    })
    expect((await adapter.capture()).contentHash).toBe(first.contentHash)
  })
})

describe('passive optional company details', () => {
  const leads = `<ol class="artdeco-list">${[101, 102, 103].map((id) => `<li class="artdeco-list__item"><a href="/sales/lead/fabricated-${id}"><span data-anonymize="person-name">Person ${id}</span></a><a data-anonymize="company-name" href="/sales/company/${id}">Company ${id}</a></li>`).join('')}</ol>`
  const card = (id: number, attrs = '') => `<div role="tooltip" ${attrs}><a data-anonymize="company-name" href="/sales/company/${id}">Company ${id}</a><span data-anonymize="industry">Software</span><span data-anonymize="company-size">2-10 employees</span><span data-anonymize="location">Example City, Example State</span><a data-anonymize="company-website" href="https://company-${id}.example.com/?token=fabricated-secret">Website</a></div>`
  it('never hovers, clicks, fetches or mutates the live DOM; only enriches the matching visible card', async () => {
    const doc = page(leads + card(101) + card(102, 'style="display:none"') + card(999), '/sales/search/people')
    const dispatch = vi.spyOn(dom.window.Element.prototype, 'dispatchEvent')
    const click = vi.spyOn(dom.window.HTMLElement.prototype, 'click')
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const before = doc.documentElement.outerHTML
    const captured = await adapterFor(window.location.href)!.capture({ includeCompanyWebsites: true })
    const result = parseSearchResults(captured.html)
    expect(result.leads[0]).toMatchObject({ companyIndustry: 'Software', companySize: '2-10 employees', companyWebsiteUrl: 'https://company-101.example.com/' })
    expect(result.leads.slice(1).every((lead) => lead.companyIndustry === null && lead.companyWebsiteUrl === null)).toBe(true)
    expect(dispatch).not.toHaveBeenCalled()
    expect(click).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(doc.documentElement.outerHTML).toBe(before)
  })
  it('leaves optional details unknown when disabled, even with a visible card', async () => {
    const doc = page(leads + card(101), '/sales/search/people')
    // Old extension versions wrote these onto the LIVE DOM. They are not a
    // fresh visible observation and must not leak into a later opted-out run.
    doc.querySelector('[data-anonymize="company-name"]')!.setAttribute('data-outlio-company-industry', 'Stale value')
    const result = parseSearchResults((await adapterFor(window.location.href)!.capture({ includeCompanyWebsites: false })).html)
    expect(result.leads.every((lead) => lead.companyIndustry === null)).toBe(true)
  })
  it('keeps the existing pure companyDetailsFrom helper', () => {
    const doc = page('<div><span>Software Development</span><span>Example City, State</span><span>2-10 employees</span></div>', '/sales/search/people')
    expect(companyDetailsFrom(doc)).toEqual({ industry: 'Software Development', size: '2-10 employees', headquarters: 'Example City, State' })
  })
})

describe('snapshot security', () => {
  it('drops credentials, forms, executable nodes/attributes and unsafe links without losing parser hooks', () => {
    const doc = page(`<main data-session='{"token":"secret-json"}' data-cookie="secret-cookie" onclick="secret-event" id="ember1">
      <script>secret-script</script><form><input value="secret-password"><textarea>secret-textarea</textarea></form>
      <template>secret-template</template><iframe srcdoc="secret-frame"></iframe><object data="secret-object"></object>
      <div hidden>secret-hidden</div><svg><script>secret-svg</script></svg><!-- secret-comment -->
      <div data-x-search-result="ACCOUNT" data-anonymize="person-blurb" title="Full fabricated About text">Preview</div>
      <a href="javascript:secret-code()" onmouseover="secret-handler" ping="https://example.com/secret-ping">Unsafe</a>
      <a href="https://user:secret-credential@example.com">Credentials</a>
      <a href="/sales/company/123?csrfToken=secret-csrf#secret-hash">Company</a>
      <button data-control-name="search_spotlight_hiring_on_linkedin" formaction="https://example.com/secret-form">Hiring</button>
      </main>`, '/sales/search/company')
    const cleaned = sanitizePageElement(doc.querySelector('main')!)!
    expect(cleaned.outerHTML).not.toContain('secret-')
    expect(cleaned.querySelectorAll('script, form, input, textarea, template, iframe, object, svg')).toHaveLength(0)
    expect(cleaned.querySelector('[data-x-search-result="ACCOUNT"]')?.getAttribute('title')).toBe('Full fabricated About text')
    expect(cleaned.querySelector('[data-control-name]')?.getAttribute('data-control-name')).toBe('search_spotlight_hiring_on_linkedin')
    expect(cleaned.querySelectorAll('a')[2]?.getAttribute('href')).toBe('https://www.linkedin.com/sales/company/123')
  })
  it('rejects URL credentials and strips lead session suffixes', () => {
    expect(snapshotUrl('https://user:password@example.com')).toBeNull()
    expect(snapshotUrl('data:text/html,secret')).toBeNull()
    expect(snapshotUrl('/sales/lead/fabricated-1,NAME_SEARCH,token?_ntb=secret#secret')).toBe('https://www.linkedin.com/sales/lead/fabricated-1')
  })
})
