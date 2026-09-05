/**
 * The free providers: GitHub and Hacker News.
 *
 * Both cost nothing, and both share one hazard — **attribution**. A GitHub org
 * login and an HN story title are claimed by whoever got there first, so the
 * matching tests carry more weight than the parsing ones.
 */
import { describe, expect, it } from 'vitest'

import {
  candidateLogins,
  orgBelongsToCompany,
  summariseRepos,
} from '@/lib/intelligence/providers/github'
import { attributableStories } from '@/lib/intelligence/providers/hackernews'
import { DEFAULT_PROVIDER_ORDER } from '@/lib/intelligence/providers'

describe('orgBelongsToCompany — a login is not proof', () => {
  it('accepts an org whose display name is the company', () => {
    expect(
      orgBelongsToCompany({ login: 'acme', name: 'Acme Systems' }, { name: 'Acme Systems', domain: null }),
    ).toBe(true)
  })

  it('accepts an org linking back to the company domain', () => {
    expect(
      orgBelongsToCompany({ login: 'acme', name: 'ACME', blog: 'https://acme.com' }, { name: 'Different Ltd', domain: 'acme.com' }),
    ).toBe(true)
  })

  it('REFUSES a login that merely matches', () => {
    /*
     * github.com/acme may be a hobby project by someone unrelated. Attributing
     * their repositories to a company would be a confident, visible error.
     */
    expect(
      orgBelongsToCompany({ login: 'acme', name: 'Andy Chen Made Everything' }, { name: 'Acme Systems', domain: 'acme.com' }),
    ).toBe(false)
  })

  it('refuses when the blog points somewhere else entirely', () => {
    expect(
      orgBelongsToCompany({ login: 'acme', name: null, blog: 'https://someoneelse.dev' }, { name: 'Acme', domain: 'acme.com' }),
    ).toBe(false)
  })

  it('ignores legal-form differences in the display name', () => {
    expect(
      orgBelongsToCompany({ login: 'acme', name: 'Acme Systems, Inc.' }, { name: 'Acme Systems', domain: null }),
    ).toBe(true)
  })
})

describe('candidateLogins', () => {
  it('derives plausible logins from the name and domain', () => {
    const logins = candidateLogins({ name: 'Acme Systems', domain: 'acme.com' })
    expect(logins).toEqual(expect.arrayContaining(['acmesystems', 'acme-systems', 'acme']))
  })

  it('drops anything GitHub could not accept as a login', () => {
    const logins = candidateLogins({ name: 'A', domain: null })
    for (const login of logins) expect(login).toMatch(/^[a-z0-9][a-z0-9-]{0,38}$/i)
  })

  it('returns nothing usable for a company with no name or domain', () => {
    expect(candidateLogins({ name: null, domain: null })).toEqual([])
  })
})

describe('summariseRepos', () => {
  it('counts stars, languages and the most recent push', () => {
    const summary = summariseRepos([
      { stargazers_count: 100, language: 'TypeScript', pushed_at: '2026-01-01T00:00:00Z' },
      { stargazers_count: 50, language: 'Go', pushed_at: '2026-06-01T00:00:00Z' },
    ])

    expect(summary.totalStars).toBe(150)
    expect(summary.languages).toEqual(['TypeScript', 'Go'])
    expect(summary.lastPushedAt).toBe('2026-06-01T00:00:00Z')
  })

  it('EXCLUDES forks', () => {
    // A fork is somebody else's work; counting its stars overstates what the
    // company actually built.
    const summary = summariseRepos([
      { stargazers_count: 10, language: 'Go', fork: false },
      { stargazers_count: 90_000, language: 'C', fork: true },
    ])

    expect(summary.totalStars).toBe(10)
    expect(summary.languages).toEqual(['Go'])
  })

  it('handles an empty account', () => {
    expect(summariseRepos([])).toEqual({ totalStars: 0, languages: [], lastPushedAt: null })
  })
})

describe('attributableStories — a mention is not a launch', () => {
  const hits = [
    { objectID: '1', title: 'Show HN: Acme – a faster way to deploy', points: 240, num_comments: 90, created_at: '2026-05-01T00:00:00Z' },
    { objectID: '2', title: 'Acme raises $8M', points: 30, num_comments: 4, created_at: '2026-03-01T00:00:00Z' },
    { objectID: '3', title: 'Why I left Acmetric after two years', points: 500, num_comments: 200, created_at: '2026-06-01T00:00:00Z' },
  ]

  it('keeps stories about the company', () => {
    const stories = attributableStories('Acme', hits)
    expect(stories.map((story) => story.id)).toEqual(['1', '2'])
  })

  it('EXCLUDES a company that merely contains the name', () => {
    // "Acmetric" is not "Acme", and it is the highest-scoring story here.
    expect(attributableStories('Acme', hits).map((s) => s.id)).not.toContain('3')
  })

  it('marks a Show HN as a launch, and a news item as not', () => {
    const stories = attributableStories('Acme', hits)
    expect(stories.find((story) => story.id === '1')?.isLaunch).toBe(true)
    expect(stories.find((story) => story.id === '2')?.isLaunch).toBe(false)
  })

  it('returns newest first', () => {
    const stories = attributableStories('Acme', hits)
    expect(stories[0]!.id).toBe('1')
  })

  it('returns nothing without a usable company name', () => {
    expect(attributableStories(null, hits)).toEqual([])
    expect(attributableStories('   ', hits)).toEqual([])
  })

  it('falls back to the HN item URL when a story has none', () => {
    const [story] = attributableStories('Acme', [
      { objectID: '9', title: 'Acme ships v2', created_at: '2026-01-01T00:00:00Z' },
    ])
    expect(story!.url).toContain('news.ycombinator.com/item?id=9')
  })
})

describe('registration', () => {
  it('makes both the only provider in their category', () => {
    expect(DEFAULT_PROVIDER_ORDER.technical_presence).toEqual(['github'])
    expect(DEFAULT_PROVIDER_ORDER.product_activity).toEqual(['hackernews'])
  })

  it('puts free DNS detection ahead of paid PageSpeed', () => {
    expect(DEFAULT_PROVIDER_ORDER.tech_stack).toEqual(['dns-tech', 'pagespeed-tech'])
  })
})
