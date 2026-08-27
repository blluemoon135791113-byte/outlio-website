import { describe, expect, it } from 'vitest'

import {
  bestIdentityMatch,
  canonicalLinkedInUrl,
  identityAccepted,
  resolveIdentity,
  type IdentitySubject,
} from '@/lib/intelligence/identity'
import { extractPublicEmail, extractPublicPhone } from '@/lib/intelligence/providers/search-contact'
import type { PersonEntity } from '@/lib/intelligence/types'

const ada: IdentitySubject = {
  fullName: 'Ada Lovelace',
  companyName: 'Acme Corp',
  companyDomain: 'acme.com',
  jobTitle: 'VP Engineering',
  linkedinUrl: 'https://www.linkedin.com/in/adalovelace/',
  location: 'London',
}

describe('the invariant: a name alone is never a match', () => {
  it('REFUSES a page that only agrees on the name', () => {
    /*
     * ⚠️ THE CONTAMINATION CASE. A search for `"Ada Lovelace" email` returns a
     * real, published, correct address belonging to a DIFFERENT Ada Lovelace.
     * Filed against this lead it is indistinguishable from a genuine find.
     */
    const match = resolveIdentity(ada, {
      text: 'Ada Lovelace — contact ada@unrelated.example',
      url: 'https://directory.example/people/ada-lovelace',
    })

    expect(match.verdict).not.toBe('match')
    expect(identityAccepted(match)).toBe(false)
    expect(match.reason).toContain('namesake')
  })

  it('still refuses when every NON-employer signal agrees', () => {
    // Job title and city are shared by thousands of people. Piling them up
    // must never substitute for knowing where someone works.
    const match = resolveIdentity(ada, {
      text: 'Ada Lovelace, VP Engineering, based in London',
      url: 'https://directory.example/ada',
    })

    expect(match.signals).toEqual(expect.arrayContaining(['job_title', 'location']))
    expect(match.verdict).toBe('weak')
    expect(identityAccepted(match)).toBe(false)
  })

  it('caps the score of an undistinguished candidate', () => {
    const match = resolveIdentity(ada, {
      text: 'Ada Lovelace VP Engineering London',
      url: 'https://directory.example/ada',
    })
    // Tuning a weight upward must not quietly promote a namesake.
    expect(match.score).toBeLessThan(0.7)
  })
})

describe('employer signals distinguish namesakes', () => {
  it('accepts a page served BY the employer', () => {
    const match = resolveIdentity(ada, {
      text: 'Ada Lovelace, VP Engineering',
      url: 'https://acme.com/team/ada',
    })

    expect(match.verdict).toBe('match')
    expect(match.signals).toContain('employer_domain')
  })

  it('accepts a subdomain of the employer', () => {
    const match = resolveIdentity(ada, {
      text: 'Ada Lovelace',
      url: 'https://careers.acme.com/ada',
    })
    expect(match.verdict).toBe('match')
  })

  it('is not fooled by a lookalike host', () => {
    // `notacme.com` ends with `acme.com`. A naive suffix check accepts it.
    const match = resolveIdentity(ada, {
      text: 'Ada Lovelace',
      url: 'https://notacme.com/ada',
    })
    expect(match.verdict).not.toBe('match')
  })

  it('accepts the employer named in the text, on a third-party page', () => {
    const match = resolveIdentity(ada, {
      text: 'Ada Lovelace of Acme Corp will speak at the conference',
      url: 'https://conference.example/speakers',
    })

    expect(match.verdict).toBe('match')
    expect(match.signals).toContain('employer_name')
  })

  it('matches an employer written with different punctuation', () => {
    // "Acme Corp", "AcmeCorp" and "Acme-Corp" are one employer.
    const match = resolveIdentity(ada, {
      text: 'Ada Lovelace joined Acme-Corp last year',
      url: 'https://news.example/1',
    })
    expect(match.signals).toContain('employer_name')
  })
})

describe('location is a live signal, not just plumbing', () => {
  it('tips a borderline candidate over the line', () => {
    /*
     * A scattered name plus an employer NAME lands just under the bar. The
     * lead's captured city is what settles it — which is only possible because
     * `PersonEntity` now carries `location`. It was in `extracted_leads` from
     * the first parser and nothing ever loaded it.
     */
    const observation = {
      text: 'Ada (formerly Byron) Lovelace, Acme Corp, London office',
      url: 'https://conference.example/speakers',
    }

    const withLocation = resolveIdentity(ada, observation)
    const withoutLocation = resolveIdentity({ ...ada, location: null }, observation)

    expect(withoutLocation.verdict).toBe('weak')
    expect(withLocation.verdict).toBe('match')
    expect(withLocation.signals).toContain('location')
  })

  it('cannot carry a match on its own', () => {
    // Still bound by the invariant: a city distinguishes nobody.
    const match = resolveIdentity(ada, {
      text: 'Ada Lovelace, London',
      url: 'https://directory.example/ada',
    })
    expect(identityAccepted(match)).toBe(false)
  })
})

describe('LinkedIn URL is decisive', () => {
  it('matches on profile equality alone, ignoring everything else', () => {
    const match = resolveIdentity(ada, {
      text: 'no name here at all',
      url: 'https://uk.linkedin.com/in/adalovelace?trk=public',
    })

    expect(match.verdict).toBe('match')
    expect(match.signals).toEqual(['linkedin_url'])
  })

  it('REFUSES a different profile even when name and employer agree', () => {
    /*
     * The one case where we can be certain two records are different people.
     * Saying so is worth more than any amount of name agreement.
     */
    const match = resolveIdentity(ada, {
      text: 'Ada Lovelace, Acme Corp',
      candidate: { linkedinUrl: 'https://www.linkedin.com/in/ada-lovelace-2' },
      url: 'https://acme.com/team',
    })

    expect(match.verdict).toBe('no_match')
    expect(match.reason).toContain('different LinkedIn profile')
  })

  it('canonicalises locale, query and trailing slash away', () => {
    expect(canonicalLinkedInUrl('https://uk.linkedin.com/in/Ada-Lovelace/?trk=x')).toBe(
      'linkedin.com/in/ada-lovelace',
    )
  })

  it('treats a Sales Navigator lead URL as the same identity space', () => {
    expect(canonicalLinkedInUrl('https://www.linkedin.com/sales/lead/abc123')).toBe(
      'linkedin.com/in/abc123',
    )
  })

  it('refuses a COMPANY page as a person identity', () => {
    // A company page says nothing about which employee is being discussed.
    expect(canonicalLinkedInUrl('https://www.linkedin.com/company/acme')).toBeNull()
    expect(canonicalLinkedInUrl('https://example.com/in/ada')).toBeNull()
    expect(canonicalLinkedInUrl('not a url')).toBeNull()
  })
})

describe('degenerate input', () => {
  it('refuses when the subject has no name', () => {
    const match = resolveIdentity({ ...ada, fullName: null }, { text: 'Acme Corp', url: 'https://acme.com' })
    expect(match.verdict).toBe('no_match')
    expect(match.reason).toContain('no name')
  })

  it('refuses when the name is absent from the observation', () => {
    const match = resolveIdentity(ada, { text: 'Grace Hopper, Acme Corp', url: 'https://acme.com/team' })
    expect(match.verdict).toBe('no_match')
    expect(match.reason).toContain('name not present')
  })

  it('does not treat an unparseable URL as a mismatch', () => {
    // Absence of a signal is not evidence against.
    const match = resolveIdentity(ada, { text: 'Ada Lovelace of Acme Corp', url: 'javascript:void(0)' })
    expect(match.verdict).toBe('match')
  })

  it('scores a contiguous name above scattered tokens', () => {
    const exact = resolveIdentity(ada, { text: 'Ada Lovelace, Acme Corp', url: 'https://x.example' })
    const scattered = resolveIdentity(ada, { text: 'Ada (formerly Byron) Lovelace, Acme Corp', url: 'https://x.example' })

    expect(exact.signals).toContain('name_exact')
    expect(scattered.signals).toContain('name_tokens')
    expect(exact.score).toBeGreaterThan(scattered.score)
  })
})

describe('bestIdentityMatch', () => {
  it('takes the strongest observation, not the first', () => {
    const best = bestIdentityMatch(ada, [
      { text: 'Ada Lovelace', url: 'https://directory.example/a' },
      { text: 'Ada Lovelace, VP Engineering', url: 'https://acme.com/team' },
    ])

    expect(best.verdict).toBe('match')
    expect(best.signals).toContain('employer_domain')
  })

  it('cannot launder two namesake pages into a match', () => {
    const best = bestIdentityMatch(ada, [
      { text: 'Ada Lovelace', url: 'https://directory.example/a' },
      { text: 'Ada Lovelace', url: 'https://other.example/b' },
    ])
    expect(identityAccepted(best)).toBe(false)
  })

  it('reports no observations honestly', () => {
    expect(bestIdentityMatch(ada, []).reason).toBe('no observations')
  })
})

describe('contact discovery is gated by the resolver', () => {
  const person: PersonEntity = {
    type: 'person',
    id: '11111111-1111-4111-8111-111111111111',
    fullName: 'Ada Lovelace',
    linkedinUrl: null,
    jobTitle: 'VP Engineering',
    location: 'London',
    companyName: 'Acme Corp',
    companyDomain: 'acme.com',
    companyId: null,
  }

  it('refuses a namesake PHONE on a page with no employer signal', () => {
    /*
     * Phone is where the gate is visible on its own. An email carries its
     * employer in the address, so a name-only page holding an on-domain
     * address is already distinguished; a phone number carries nothing.
     */
    const finding = extractPublicPhone(person, [
      {
        url: 'https://directory.example/ada-lovelace',
        title: 'Ada Lovelace',
        snippet: 'Ada Lovelace — call +44 20 7946 0958',
        publishedDate: null,
      },
    ])

    expect(finding).toBeNull()
  })

  it('accepts the same phone once the page names the employer', () => {
    const finding = extractPublicPhone(person, [
      {
        url: 'https://directory.example/ada-lovelace',
        title: 'Ada Lovelace',
        snippet: 'Ada Lovelace, Acme Corp — call +44 20 7946 0958',
        publishedDate: null,
      },
    ])

    expect(finding?.value).toBe('+442079460958')
  })

  it('refuses a namesake email at a third-party domain', () => {
    const finding = extractPublicEmail(person, [
      {
        url: 'https://directory.example/ada-lovelace',
        title: 'Ada Lovelace',
        snippet: 'Reach Ada Lovelace at ada.lovelace@othercorp.example',
        publishedDate: null,
      },
    ])

    expect(finding).toBeNull()
  })

  it('DELIBERATELY accepts a name-only page carrying an on-domain address', () => {
    /*
     * The address itself names the employer, which is what distinguishes this
     * Ada from her namesakes. Recorded as a test rather than left implicit,
     * because it is the one place identity is established partly from the
     * value being extracted.
     */
    const finding = extractPublicEmail(person, [
      {
        url: 'https://directory.example/ada-lovelace',
        title: 'Ada Lovelace',
        snippet: 'Reach Ada Lovelace at ada.lovelace@acme.com',
        publishedDate: null,
      },
    ])

    expect(finding?.value).toBe('ada.lovelace@acme.com')
  })

  it('accepts the same address from the employer’s own site, and records identity', () => {
    const finding = extractPublicEmail(person, [
      {
        url: 'https://acme.com/team/ada',
        title: 'Ada Lovelace — Acme Corp',
        snippet: 'Ada Lovelace, VP Engineering. ada.lovelace@acme.com',
        publishedDate: null,
      },
    ])

    expect(finding?.value).toBe('ada.lovelace@acme.com')
    expect(finding?.identityScore).toBeGreaterThan(0.7)
  })

  it('never reports a confidence above its identity certainty', () => {
    const finding = extractPublicEmail(person, [
      {
        url: 'https://conference.example/speakers',
        title: 'Speakers',
        snippet: 'Ada Lovelace of Acme Corp — ada.lovelace@acme.com',
        publishedDate: null,
      },
    ])

    expect(finding).not.toBeNull()
    expect(finding!.confidence).toBeLessThanOrEqual(finding!.identityScore)
  })
})
