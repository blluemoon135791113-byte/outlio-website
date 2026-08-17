/**
 * Reading a company's website off its Sales Navigator page.
 *
 * The rejections carry the weight. A wrong website is worse than none: it gets
 * stored as company identity, matched against other companies, and eventually
 * pushed into someone's CRM as fact.
 */
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import {
  companyIdFromUrl,
  isCompanyPage,
  normaliseWebsite,
  readCompanyName,
  readCompanyPage,
  readCompanyWebsite,
} from '@/extensions/adapters/salesnav-company'

const PAGE = 'https://www.linkedin.com/sales/company/1035'

function doc(body: string): Document {
  return new JSDOM(`<!doctype html><html><body>${body}</body></html>`).window.document
}

describe('companyIdFromUrl', () => {
  it('reads the id from a company page', () => {
    expect(companyIdFromUrl(PAGE)).toBe('1035')
    expect(companyIdFromUrl(`${PAGE}/`)).toBe('1035')
    expect(companyIdFromUrl(`${PAGE}?_ntb=abc`)).toBe('1035')
  })

  it('is not a company page for anything else', () => {
    for (const url of [
      'https://www.linkedin.com/sales/search/people',
      'https://www.linkedin.com/sales/lead/456',
      'https://www.linkedin.com/company/acme',
      'https://example.com/sales/company/1035',
      'not a url',
    ]) {
      expect(companyIdFromUrl(url), url).toBeNull()
    }
  })

  it('REFUSES a lookalike host', () => {
    // `linkedin.com.evil.test` ends with the string but is not the domain.
    expect(companyIdFromUrl('https://linkedin.com.evil.test/sales/company/1035')).toBeNull()
  })

  it('backs isCompanyPage', () => {
    expect(isCompanyPage(PAGE)).toBe(true)
    expect(isCompanyPage('https://www.linkedin.com/sales/search/people')).toBe(false)
  })
})

describe('normaliseWebsite', () => {
  it('accepts an ordinary company site', () => {
    expect(normaliseWebsite('https://example.com')).toBe('https://example.com/')
    expect(normaliseWebsite('http://example.com/about')).toBe('http://example.com/about')
  })

  it('REJECTS javascript: and data:', () => {
    // This value is stored and later rendered as a link. Same refinement that
    // guards evidence source_url, for the same reason.
    for (const href of ['javascript:alert(1)', 'data:text/html,<script>x</script>', 'file:///etc/passwd']) {
      expect(normaliseWebsite(href), href).toBeNull()
    }
  })

  it('rejects LinkedIn itself and its shorteners', () => {
    for (const href of [
      'https://www.linkedin.com/company/acme',
      'https://lnkd.in/abc123',
      'https://media.licdn.com/x.png',
    ]) {
      expect(normaliseWebsite(href), href).toBeNull()
    }
  })

  it('rejects a generic shortener, which tells us nothing', () => {
    // Stored as a domain it would poison company identity matching.
    expect(normaliseWebsite('https://bit.ly/abc')).toBeNull()
    expect(normaliseWebsite('https://t.co/abc')).toBeNull()
  })

  it('rejects a hostname with no dot', () => {
    expect(normaliseWebsite('http://localhost/')).toBeNull()
  })

  it('rejects nothing at all', () => {
    expect(normaliseWebsite(null)).toBeNull()
    expect(normaliseWebsite(undefined)).toBeNull()
    expect(normaliseWebsite('')).toBeNull()
  })
})

describe('readCompanyWebsite', () => {
  it('prefers the labelled website field', () => {
    const document = doc(`
      <main>
        <section>
          <a href="https://www.linkedin.com/company/acme">LinkedIn</a>
          <a data-control-name="visit_company_website" href="https://acme.example">Website</a>
        </section>
      </main>
    `)

    expect(readCompanyWebsite(document, PAGE)).toBe('https://acme.example/')
  })

  it('reads a website rendered as text rather than a link', () => {
    const document = doc('<span data-anonymize="company-website">https://acme.example</span>')
    expect(readCompanyWebsite(document, PAGE)).toBe('https://acme.example/')
  })

  it('falls back to an external link in the company card', () => {
    const document = doc(`
      <main><section>
        <a href="/sales/company/1035">Acme</a>
        <a href="https://acme.example/about">acme.example</a>
      </section></main>
    `)

    expect(readCompanyWebsite(document, PAGE)).toBe('https://acme.example/about')
  })

  it('does NOT take an external link from elsewhere on the page', () => {
    /*
     * A link in a posted update or an employee's personal site is not the
     * company's website. Attributing one would be a confident wrong answer,
     * and the fallback is bounded to the company's own card to prevent it.
     */
    const document = doc(`
      <main><section><a href="/sales/company/1035">Acme</a></section></main>
      <aside><a href="https://someones-blog.example">A blog post</a></aside>
    `)

    expect(readCompanyWebsite(document, PAGE)).toBeNull()
  })

  it('returns null when the page lists no website', () => {
    expect(readCompanyWebsite(doc('<main><section><h1>Acme</h1></section></main>'), PAGE)).toBeNull()
  })
})

describe('readCompanyName', () => {
  it('reads the company name', () => {
    expect(readCompanyName(doc('<main><h1>  Acme   Systems </h1></main>'))).toBe('Acme Systems')
  })

  it('is null when absent', () => {
    expect(readCompanyName(doc('<main></main>'))).toBeNull()
  })
})

describe('readCompanyPage', () => {
  it('returns the observation worth sending', () => {
    const document = doc(`
      <main><section>
        <h1>Acme Systems</h1>
        <a data-control-name="visit_company_website" href="https://acme.example">Website</a>
      </section></main>
    `)

    expect(readCompanyPage(document, PAGE)).toEqual({
      companyId: '1035',
      companyName: 'Acme Systems',
      websiteUrl: 'https://acme.example/',
    })
  })

  it('sends NOTHING when there is no website', () => {
    /*
     * An empty observation would let a later read mistake "we saw nothing" for
     * "we looked and there is none" — and it would spend a request saying so.
     */
    const document = doc('<main><section><h1>Acme Systems</h1></section></main>')
    expect(readCompanyPage(document, PAGE)).toBeNull()
  })

  it('sends nothing from a page that is not a company page', () => {
    const document = doc('<a data-control-name="visit_company_website" href="https://acme.example">x</a>')
    expect(readCompanyPage(document, 'https://www.linkedin.com/sales/search/people')).toBeNull()
  })
})
