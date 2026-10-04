/**
 * A lead's other profiles (0154): only a full address of the right site is
 * accepted — nothing is guessed from a handle, and nothing becomes a
 * `javascript:` href.
 */
import { describe, expect, it } from 'vitest'

import { parseSocialLink, socialLinksFromForm, socialLinkText } from '@/lib/crm/social-links'

const ok = (input: Parameters<typeof parseSocialLink>[0]) => {
  const result = parseSocialLink(input)
  if (!result.ok) throw new Error(result.error)
  return result.link
}
const refused = (input: Parameters<typeof parseSocialLink>[0]) => {
  const result = parseSocialLink(input)
  expect(result.ok).toBe(false)
  return result.ok ? '' : result.error
}

describe('parseSocialLink', () => {
  it('accepts each named site and keys it by host + path', () => {
    expect(ok({ kind: 'x', url: 'https://x.com/Pat' })).toEqual({
      kind: 'x',
      label: null,
      url: 'https://x.com/Pat',
      urlKey: 'x.com/pat',
    })
    expect(ok({ kind: 'x', url: 'twitter.com/pat' }).urlKey).toBe('twitter.com/pat')
    expect(ok({ kind: 'github', url: 'https://www.github.com/pat/' }).urlKey).toBe('github.com/pat')
    expect(ok({ kind: 'facebook', url: 'https://m.facebook.com/pat' }).kind).toBe('facebook')
    expect(ok({ kind: 'instagram', url: 'instagram.com/pat' }).url).toBe('https://instagram.com/pat')
  })

  it('a website or a labelled link takes any host', () => {
    expect(ok({ kind: 'website', url: 'pat.example.com' }).urlKey).toBe('pat.example.com')
    expect(ok({ kind: 'other', label: '  My   Blog ', url: 'https://blog.example.org/pat' }).label).toBe('My Blog')
  })

  it('a website keeps its query and path case in the key; a profile does not', () => {
    expect(ok({ kind: 'website', url: 'https://site.example.com/p?id=1#top' }).urlKey).toBe('site.example.com/p?id=1')
    expect(ok({ kind: 'website', url: 'https://Site.example.com/Docs' }).urlKey).toBe('site.example.com/Docs')
    expect(ok({ kind: 'github', url: 'https://github.com/Pat' }).urlKey).toBe('github.com/pat')
  })

  it('the 500-character limit applies to the stored, encoded address', () => {
    expect(refused({ kind: 'website', url: `https://example.com/${'é'.repeat(120)}` })).toMatch(/too long/)
  })

  it('a handle on its own is refused — turning it into an address would be a guess', () => {
    expect(refused({ kind: 'x', url: '@pat' })).toMatch(/full address/)
    expect(refused({ kind: 'github', url: 'pat' })).toMatch(/full address/)
  })

  it('a site home page is not a profile', () => {
    expect(refused({ kind: 'github', url: 'https://github.com/' })).toMatch(/profile address/)
  })

  it('the wrong site for the kind is refused', () => {
    expect(refused({ kind: 'github', url: 'https://gitlab.com/pat' })).toMatch(/not on GitHub/)
    // A look-alike host is not the site.
    expect(refused({ kind: 'x', url: 'https://notx.com/pat' })).toMatch(/not on X/)
  })

  it('never stores a non-web scheme', () => {
    expect(refused({ kind: 'website', url: 'javascript:alert(1)' })).toMatch(/https/)
    expect(refused({ kind: 'website', url: 'data:text/html,hi' })).toMatch(/https/)
    expect(refused({ kind: 'other', label: 'x', url: 'ftp://example.com/a' })).toMatch(/https/)
  })

  it('LinkedIn has its own fields', () => {
    expect(refused({ kind: 'website', url: 'https://www.linkedin.com/in/pat' })).toMatch(/own fields/)
  })

  it('"other" needs a label; labels are capped', () => {
    expect(refused({ kind: 'other', url: 'https://example.com/pat' })).toMatch(/label/)
    expect(refused({ kind: 'website', label: 'x'.repeat(41), url: 'https://example.com' })).toMatch(/40/)
  })

  it('an unknown kind, credentials in the URL, and spaces are refused', () => {
    refused({ kind: 'myspace', url: 'https://myspace.com/pat' })
    refused({ kind: 'website', url: 'https://user:pass@example.com' })
    refused({ kind: 'website', url: 'https://example.com/a b' })
  })
})

describe('socialLinksFromForm', () => {
  const form = (rows: [string, string, string][]) => {
    const f = new FormData()
    for (const [kind, label, url] of rows) {
      f.append('link_kind', kind)
      f.append('link_label', label)
      f.append('link_url', url)
    }
    return f
  }

  it('skips empty rows and keeps a repeated address once', () => {
    const result = socialLinksFromForm(
      form([
        ['github', '', 'github.com/pat'],
        ['x', '', ''],
        ['github', '', 'https://www.github.com/pat/'],
      ]),
    )
    expect(result).toMatchObject({ ok: true, links: [{ urlKey: 'github.com/pat' }] })
  })

  it('one bad row refuses the whole set', () => {
    expect(socialLinksFromForm(form([['github', '', 'github.com/pat'], ['x', '', '@pat']]))).toMatchObject({
      ok: false,
    })
  })

  it('misaligned fields are refused, not guessed at', () => {
    const f = form([['github', '', 'github.com/pat']])
    f.append('link_url', 'https://x.com/pat')
    expect(socialLinksFromForm(f).ok).toBe(false)
  })
})

it('a link reads as its label, else its kind', () => {
  expect(socialLinkText({ kind: 'github', label: null })).toBe('GitHub')
  expect(socialLinkText({ kind: 'other', label: 'Podcast' })).toBe('Podcast')
})
