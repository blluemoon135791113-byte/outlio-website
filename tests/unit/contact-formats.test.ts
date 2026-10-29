/**
 * Contacts in the formats public pages actually use.
 *
 * Pinned: disguised addresses are decoded exactly as written and ordinary
 * prose is not mistaken for one; attribute-assembled addresses are read;
 * people come out of JSON-LD, microdata and hCard with their own details;
 * forums are recognised and split into posts by author; and a person's phone
 * is taken from a forum only from a post THEY wrote. Fabricated data only.
 */
import { describe, expect, it, vi } from 'vitest'

import type { SearchHit } from '@/lib/hubble/providers/types'
import type { PersonEntity } from '@/lib/intelligence/types'

vi.mock('server-only', () => ({}))

const read = async (html: string) =>
  (await import('@/lib/hubble/extract/readable')).extractReadable(html, 'https://forum.example/t/1')

const body = (inner: string) =>
  `<html><head><title>Page</title></head><body><main><p>${'Fabricated filler text for the page. '.repeat(10)}</p>${inner}</main></body></html>`

describe('disguised and assembled addresses', () => {
  it('decodes bracketed and spelled-out forms', async () => {
    const { decodeDisguisedEmails } = await import('@/lib/hubble/extract/contacts')
    expect(decodeDisguisedEmails('Mail jamie [at] fabricated [dot] example please')).toEqual(['jamie@fabricated.example'])
    expect(decodeDisguisedEmails('jamie(at)fabricated.example')).toEqual(['jamie@fabricated.example'])
    expect(decodeDisguisedEmails('write to jamie at fabricated dot example')).toEqual(['jamie@fabricated.example'])
  })

  it('does not read a site address in prose as a mailbox', async () => {
    const { decodeDisguisedEmails } = await import('@/lib/hubble/extract/contacts')
    expect(decodeDisguisedEmails('Find us at fabricated.example or visit our team at the office.')).toEqual([])
  })

  it('reads data-email and data-user/data-domain', async () => {
    const page = await read(body('<span data-email="team@fabricated.example"></span><a data-user="jamie" data-domain="fabricated.example">mail</a>'))
    expect(page.structured.emails).toEqual(expect.arrayContaining(['team@fabricated.example', 'jamie@fabricated.example']))
  })
})

describe('people a page describes', () => {
  it('reads Person entries from JSON-LD, microdata and hCard, each with its own details', async () => {
    const page = await read(`<html><head><script type="application/ld+json">
      {"@type":"Organization","founder":{"@type":"Person","name":"Jamie Rivera","email":"mailto:jamie@fabricated.example","jobTitle":"Founder"}}
      </script></head><body>
      <div itemscope itemtype="https://schema.org/Person"><span itemprop="name">Sam Ortiz</span><a itemprop="email" href="mailto:sam@fabricated.example">mail</a></div>
      <div class="h-card"><span class="p-name">Alex Moreno</span><a class="u-email" href="mailto:alex@fabricated.example">mail</a><span class="p-tel">+1 415 555 0132</span></div>
      </body></html>`)
    expect(page.structured.people).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Jamie Rivera', email: 'jamie@fabricated.example', title: 'Founder', source: 'json-ld' }),
      expect.objectContaining({ name: 'Sam Ortiz', email: 'sam@fabricated.example', source: 'microdata' }),
      expect.objectContaining({ name: 'Alex Moreno', email: 'alex@fabricated.example', phone: '+1 415 555 0132', source: 'hcard' }),
    ]))
    // A person's phone is theirs, not the page's switchboard.
    expect(page.structured.phones).not.toContain('+1 415 555 0132')
  })
})

describe('forums', () => {
  it('recognises the software and splits posts by author', async () => {
    const page = await read(`<html><head><meta name="generator" content="Discourse 3.2"></head><body>
      <div class="topic-post"><span class="username">Jamie Rivera</span><div class="cooked">Hi, I run Fabricated Labs. Call me on +1 415 555 0132.</div></div>
      <div class="topic-post"><span class="username">Sam Ortiz</span><div class="cooked">Thanks Jamie Rivera! My line is +1 415 555 0147.</div></div>
      </body></html>`)
    expect(page.structured.platform).toBe('discourse')
    expect(page.structured.posts.map((post) => post.author)).toEqual(['Jamie Rivera', 'Sam Ortiz'])
  })

  it("takes a phone only from the person's own post", async () => {
    const { authoredPostPhones } = await import('@/lib/intelligence/providers/search-contact')
    const person = {
      type: 'person', id: 'p', fullName: 'Jamie Rivera', linkedinUrl: null, location: null,
      jobTitle: 'Founder', companyName: 'Fabricated Labs', companyDomain: 'fabricated.example', companyId: null,
    } as PersonEntity
    const hit = { url: 'https://forum.example/t/1', title: 'Thread', snippet: null, publishedDate: null } as SearchHit
    const accepted = { verdict: 'match', score: 0.8, signals: ['name_exact', 'company'], reason: null } as never
    const posts = [
      { author: 'Sam Ortiz', text: 'Thanks Jamie Rivera! My line is +1 415 555 0147.' },
    ]
    expect(authoredPostPhones(person, posts, hit, accepted)).toEqual([])
    const own = [...posts, { author: 'Jamie Rivera', text: 'Call me on +1 415 555 0132.' }]
    expect(authoredPostPhones(person, own, hit, accepted)[0]?.value).toBe('+14155550132')
  })
})

describe('person cards in search results', () => {
  const person = {
    type: 'person', id: 'p', fullName: 'Jamie Rivera', linkedinUrl: null, location: null,
    jobTitle: 'Founder', companyName: 'Fabricated Labs', companyDomain: 'fabricated.example', companyId: null,
  } as PersonEntity
  const hit = { url: 'https://events.example/speakers', title: 'Speakers', snippet: null, publishedDate: null } as SearchHit
  const accepted = { verdict: 'match', score: 0.8, signals: ['name_exact', 'company'], reason: null } as never

  it("takes the card's email when it is at the employer, and refuses another domain", async () => {
    const { cardCandidates } = await import('@/lib/intelligence/providers/search-contact')
    const card = (email: string) => ({ name: 'Jamie Rivera', email, phone: null, title: null, source: 'json-ld' as const })
    expect(cardCandidates(person, [card('j.rivera@fabricated.example')], 'email', hit, accepted)[0]?.value)
      .toBe('j.rivera@fabricated.example')
    expect(cardCandidates(person, [card('jamie@gmail.com')], 'email', hit, accepted)).toEqual([])
    expect(cardCandidates(person, [{ ...card('x@fabricated.example'), name: 'Sam Ortiz' }], 'email', hit, accepted)).toEqual([])
  })

  it('refuses two different values for one name on one page', async () => {
    const { cardCandidates } = await import('@/lib/intelligence/providers/search-contact')
    const cards = ['+1 415 555 0132', '+1 415 555 0147'].map((phone) => ({ name: 'Jamie Rivera', email: null, phone, title: null, source: 'hcard' as const }))
    expect(cardCandidates(person, cards, 'phone', hit, accepted)).toEqual([])
  })
})

describe('the company team page', () => {
  it("files a team-page card's on-domain address for that person", async () => {
    const { cardEmailFor } = await import('@/lib/intelligence/providers/scout')
    const people = [
      { name: 'Jamie Rivera', email: 'jr@fabricated.example', phone: null, title: 'Founder', source: 'hcard' as const },
      { name: 'Sam Ortiz', email: 'sam@elsewhere.example', phone: null, title: null, source: 'hcard' as const },
    ]
    expect(cardEmailFor(people, 'Jamie Rivera', 'fabricated.example')).toBe('jr@fabricated.example')
    expect(cardEmailFor(people, 'Sam Ortiz', 'fabricated.example')).toBeNull()
  })

  it('picks linked team and press pages before guessed ones, on-site only', async () => {
    const { peoplePages } = await import('@/lib/intelligence/site-pages')
    expect(peoplePages('fabricated.example', [
      { url: 'https://fabricated.example/our-people', kind: 'team' },
      { url: 'https://news.other.example/press', kind: 'news' },
      { url: 'https://fabricated.example/press-kit', kind: 'news' },
    ])).toEqual([
      'https://fabricated.example/our-people',
      'https://fabricated.example/press-kit',
      'https://fabricated.example/team/',
    ])
  })
})
