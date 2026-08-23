/**
 * Typed links instead of a column per possible link.
 *
 * ⚠️ A COLUMN PER KIND WOULD BE ELEVEN COLUMNS OF WHICH NINE ARE EMPTY. A
 * company has three or four of these, not eleven — and that is the wall of
 * "Not found" this project already had to delete from the results panel,
 * rebuilt in the schema where it is harder to remove.
 */
import { describe, expect, it } from 'vitest'

import { classifyLink, linksByKind, presentKinds, LINK_KINDS } from '@/lib/companies/links'

describe('classifyLink', () => {
  it('types a link by HOST where the host is definitive', () => {
    expect(classifyLink('https://github.com/acme')?.kind).toBe('github')
    expect(classifyLink('https://x.com/acme')?.kind).toBe('x')
    expect(classifyLink('https://youtu.be/abc')?.kind).toBe('youtube')
    expect(classifyLink('https://apps.apple.com/app/x')?.kind).toBe('app_store')
    expect(classifyLink('https://www.crunchbase.com/organization/acme')?.kind).toBe('crunchbase')
  })

  it('types by PATH only when the host says nothing', () => {
    expect(classifyLink('https://acme.example/pricing')?.kind).toBe('pricing')
    expect(classifyLink('https://acme.example/careers')?.kind).toBe('careers')
    expect(classifyLink('https://acme.example/blog/post')?.kind).toBe('blog')
  })

  it("calls the company's own root its website", () => {
    expect(classifyLink('https://acme.example/', 'acme.example')?.kind).toBe('website')
    expect(classifyLink('https://acme.example/x', 'acme.example')?.kind).toBe('landing')
  })

  it('REFUSES a partner link on somebody else\'s site', () => {
    // A /partners page on a third party is a page that mentions partners,
    // not this company's partner link.
    expect(classifyLink('https://other.example/partners')?.kind).not.toBe('partner')
    expect(classifyLink('https://acme.example/partners', 'acme.example')?.kind).toBe('partner')
  })

  it('REJECTS shorteners and LinkedIn itself', () => {
    /*
     * ⚠️ A shortener resolves somewhere useful but tells us nothing on its
     * own, and stored as a company's link it is a dead reference the moment
     * the shortener expires.
     */
    for (const url of [
      'https://lnkd.in/abc',
      'https://bit.ly/abc',
      'https://t.co/abc',
      'https://www.linkedin.com/company/acme',
    ]) {
      expect(classifyLink(url), url).toBeNull()
    }
  })

  it('REJECTS non-http schemes', () => {
    // Stored and later rendered as a link.
    expect(classifyLink('javascript:alert(1)')).toBeNull()
    expect(classifyLink('data:text/html,x')).toBeNull()
  })
})

describe('presentKinds — columns derived from data, not declared', () => {
  it('returns only the kinds actually present', () => {
    const kinds = presentKinds([{ kind: 'github' }, { kind: 'pricing' }, { kind: 'github' }])
    expect(kinds).toEqual(['pricing', 'github'])
    expect(kinds).not.toContain('youtube')
  })

  it('keeps a STABLE order regardless of frequency', () => {
    /*
     * ⚠️ An import mapping built on the columns that appear must keep
     * working. Ordering by frequency would reshuffle the CSV every run.
     */
    const a = presentKinds([{ kind: 'github' }, { kind: 'website' }])
    const b = presentKinds([{ kind: 'website' }, { kind: 'github' }, { kind: 'github' }])
    expect(a).toEqual(b)
    expect(a.indexOf('website')).toBeLessThan(a.indexOf('github'))
  })

  it('is empty for no links, so no columns are created', () => {
    expect(presentKinds([])).toEqual([])
  })
})

describe('linksByKind', () => {
  it('takes the FIRST of each kind', () => {
    // A cell holding five URLs is a cell nobody can use; the rest stay
    // queryable in company_links.
    const out = linksByKind([
      { kind: 'product', url: 'https://a.example/product' },
      { kind: 'product', url: 'https://a.example/product-2' },
    ])
    expect(out.product).toBe('https://a.example/product')
  })

  it('ignores kinds outside the vocabulary', () => {
    expect(linksByKind([{ kind: 'nonsense', url: 'https://x.example' }])).toEqual({})
  })

  it('covers every declared kind with a label', async () => {
    const { LINK_LABEL } = await import('@/lib/companies/links')
    for (const kind of LINK_KINDS) expect(LINK_LABEL[kind]).toBeTruthy()
  })
})
