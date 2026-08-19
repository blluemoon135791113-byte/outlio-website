/**
 * Reading counts and people off a Sales Navigator company page.
 *
 * ⚠️ THESE SELECTORS ARE UNVALIDATED AGAINST A REAL PAGE. No company page has
 * been captured yet, so everything is read by SHAPE — a labelled number, a
 * `/sales/lead/` link — which degrades to null on a layout it does not
 * recognise. `docs/SELECTOR_MAP.md` §3 records what happened the last time a
 * selector was assumed instead of measured.
 */
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import { readCount, readPeople } from '@/extensions/adapters/salesnav-company'
import { memberId } from '@/lib/extension/company-observation'

function doc(body: string): Document {
  return new JSDOM(`<!doctype html><html><body>${body}</body></html>`).window.document
}

describe('readCount', () => {
  it('reads a number before its label', () => {
    expect(readCount('142 employees', /employees?/)).toBe(142)
    expect(readCount('7 decision makers', /decision makers?/)).toBe(7)
  })

  it('reads a number after its label', () => {
    expect(readCount('Decision makers (7)', /decision makers?/)).toBe(7)
    expect(readCount('Investors · 3', /investors?/)).toBe(3)
  })

  it('handles thousands separators and a plus', () => {
    expect(readCount('10,001 employees', /employees?/)).toBe(10001)
    expect(readCount('500+ employees', /employees?/)).toBe(500)
  })

  it('is matched on the LABEL, never on position', () => {
    /*
     * A company page is a stack of unlabelled counters whose order LinkedIn is
     * free to change. Reading "the second number" would silently start
     * returning the wrong one after any redesign.
     */
    const page = '3 investors 142 employees 7 decision makers'
    expect(readCount(page, /employees?/)).toBe(142)
    expect(readCount(page, /investors?/)).toBe(3)
    expect(readCount(page, /decision makers?/)).toBe(7)
  })

  it('returns NULL rather than 0 when the label is absent', () => {
    // "We did not find a count" and "this company has none" are different
    // claims, and 0 would assert the second.
    expect(readCount('142 employees', /investors?/)).toBeNull()
    expect(readCount('', /employees?/)).toBeNull()
  })
})

describe('readPeople', () => {
  it('reads named profile links', () => {
    const people = readPeople(
      doc(`
        <a href="/sales/lead/ACwAAA1Es_wBTEH,NAME_SEARCH,wk7z">Niels Brochner</a>
        <a href="/in/ACwAAAF8aVAB3vT37STZ">Shane Senha</a>
      `),
      'decision_maker',
    )

    expect(people.map((p) => p.name)).toEqual(['Niels Brochner', 'Shane Senha'])
    expect(people[0]!.salesNavUrl).toContain('/sales/lead/')
    expect(people[0]!.linkedinUrl).toBeNull()
    expect(people[1]!.linkedinUrl).toContain('/in/')
  })

  it('ignores links that are not profiles', () => {
    const people = readPeople(
      doc('<a href="/sales/company/1035">Acme</a><a href="https://acme.com">Website</a>'),
      'investor',
    )
    expect(people).toEqual([])
  })

  it('skips the avatar link that carries no name', () => {
    // Each person is linked twice: once as an image, once as text.
    const people = readPeople(
      doc(`
        <a href="/sales/lead/ACwAAA1Es_wBTEH"><img alt="photo"></a>
        <a href="/sales/lead/ACwAAA1Es_wBTEH">Niels Brochner</a>
      `),
      'decision_maker',
    )
    expect(people).toHaveLength(1)
    expect(people[0]!.name).toBe('Niels Brochner')
  })

  it('carries the role it was asked for', () => {
    const people = readPeople(doc('<a href="/in/ACwAAAF8aVAB3vT">Ada</a>'), 'investor')
    expect(people[0]!.role).toBe('investor')
  })
})

describe('memberId — the deduplication key', () => {
  it('finds the same id in both URL spellings', () => {
    /*
     * ⚠️ THE WHOLE POINT. A founder is frequently both a search result and
     * their own company's decision maker. The member id is the only part the
     * two URL forms share, so it is the only safe thing to match on — a name
     * renders differently on the two pages.
     */
    const a = memberId('https://www.linkedin.com/in/ACwAAAF8aVAB3vT37STZGQ6pK0Fb')
    const b = memberId('https://www.linkedin.com/sales/lead/ACwAAAF8aVAB3vT37STZGQ6pK0Fb,NAME_SEARCH,wk7z')

    expect(a).toBe('ACwAAAF8aVAB3vT37STZGQ6pK0Fb')
    expect(b).toBe('ACwAAAF8aVAB3vT37STZGQ6pK0Fb')
    expect(a).toBe(b)
  })

  it('returns null when there is no id to match on', () => {
    // Without one there is no way to tell this person from anyone else later,
    // so they are skipped rather than inserted as a possible duplicate.
    for (const url of [null, undefined, '', 'https://acme.com', 'https://www.linkedin.com/company/acme']) {
      expect(memberId(url), String(url)).toBeNull()
    }
  })
})
