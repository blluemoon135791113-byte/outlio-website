/**
 * Social Scout.
 *
 * The chain is the point: the company's own site declares its social
 * accounts; those public profiles then state their own contact details.
 * LinkedIn is DISCOVERED and recorded, but NEVER fetched — no request this
 * provider makes can touch linkedin.com. And nothing unverifiable is stored:
 * only addresses the company or its own profiles publish.
 */
import { describe, expect, it } from 'vitest'

import {
  executeSocialScout,
  extractBioLinks,
  extractSocialLinks,
  isCompanyLinkedInUrl,
  isFetchableProfileUrl,
  parseProfileSignals,
  socialScoutEvidence,
} from '@/lib/intelligence/providers/social-scout'
import type { PersonEntity } from '@/lib/intelligence/types'

const PERSON: PersonEntity = {
  type: 'person',
  id: '10000000-0000-4000-8000-000000000001',
  fullName: 'Fabricated Person',
  linkedinUrl: null,
  location: null,
  jobTitle: 'Founder',
  companyName: 'Fabricated Systems',
  companyDomain: 'fabricatedsystems.com',
  companyId: '00000000-0000-4000-8000-000000000002',
}

describe('extractSocialLinks', () => {
  const SITE = `
    <a href="https://x.com/fabricated">X</a>
    <a href="https://www.instagram.com/fabricated.systems/">IG</a>
    <a href="https://tiktok.com/@fabricated?lang=en">TT</a>
    <a href="https://youtube.com/@fabricatedsystems">YT</a>
    <a href="https://linkedin.com/company/fabricated-systems">LI</a>
    <a href="https://github.com/fabricated">GH</a>
    <a href="https://twitter.com/share?url=x">share</a>
  `

  it('discovers one handle per platform', () => {
    const links = extractSocialLinks(SITE)
    expect(links.x).toBe('https://x.com/fabricated')
    expect(links.instagram).toBe('https://www.instagram.com/fabricated.systems')
    expect(links.tiktok).toBe('https://tiktok.com/@fabricated')
    expect(links.youtube).toBe('https://youtube.com/@fabricatedsystems')
    expect(links.github).toBe('https://github.com/fabricated')
  })

  it('records LinkedIn as a stated address, like any other platform', () => {
    expect(extractSocialLinks(SITE).linkedin).toBe(
      'https://linkedin.com/company/fabricated-systems',
    )
  })

  it('ignores share/intent links that are not accounts', () => {
    expect(extractSocialLinks(SITE).x).not.toContain('share')
  })

  it('returns nothing for empty pages', () => {
    expect(extractSocialLinks(null)).toEqual({})
    expect(extractSocialLinks('<html></html>')).toEqual({})
  })
})

describe('extractBioLinks', () => {
  it('finds bio-link directories', () => {
    expect(
      extractBioLinks('<p>More: linktr.ee/fabricated and https://beacons.ai/fab</p>'),
    ).toEqual(['https://linktr.ee/fabricated', 'https://beacons.ai/fab'])
  })
})

describe('parseProfileSignals — tolerant of markup churn', () => {
  it('reads emails out of og:description meta content', () => {
    const html =
      '<meta property="og:description" content="Business: hello@fabricated.io · 12k followers" />'
    expect(parseProfileSignals(html).emails).toEqual(['hello@fabricated.io'])
  })

  it('reads attribute order the other way round too', () => {
    const html = '<meta content="ping@fab.co" property="og:description" />'
    expect(parseProfileSignals(html).emails).toEqual(['ping@fab.co'])
  })

  it('returns nothing for logged-out walls and empty pages', () => {
    expect(parseProfileSignals(null).emails).toEqual([])
    expect(parseProfileSignals('Just a moment...').emails).toEqual([])
  })
})

describe('isFetchableProfileUrl — the hard boundary', () => {
  it('NEVER allows linkedin.com, in any form', () => {
    for (const url of [
      'https://linkedin.com/company/acme',
      'https://www.linkedin.com/in/someone',
      'http://fr.linkedin.com/in/x',
    ]) {
      expect(isFetchableProfileUrl(url), url).toBe(false)
    }
  })

  it('allows every other discovered profile', () => {
    expect(isFetchableProfileUrl('https://www.instagram.com/acme')).toBe(true)
    expect(isFetchableProfileUrl('https://tiktok.com/@acme')).toBe(true)
  })
})

describe('isCompanyLinkedInUrl — a person is not the company', () => {
  it('accepts only company-page forms', () => {
    expect(isCompanyLinkedInUrl('https://linkedin.com/company/acme')).toBe(true)
    expect(isCompanyLinkedInUrl('https://linkedin.com/sales/company/3010019')).toBe(true)
  })

  it('REJECTS employee profiles featured on a company site', () => {
    // Botify's site linked a team member's /in/ profile; filed as the
    // company's page it would be a wrong answer that looks right.
    expect(isCompanyLinkedInUrl('https://www.linkedin.com/in/charlotte-corbaz-4b9376b5')).toBe(false)
  })
})

describe('executeSocialScout', () => {
  function fetchedFrom(pages: Record<string, string>) {
    return async (url: string) => pages[url] ?? null
  }

  const HOME = `
    <html><body>
      <a href="https://www.instagram.com/fabricated.systems/">Instagram</a>
      <a href="https://tiktok.com/@fabricated">TikTok</a>
      <a href="https://linkedin.com/company/fabricated-systems">LinkedIn</a>
    </body></html>`

  const IG_PAGE =
    '<meta property="og:description" content="45.2k Followers — B2B pipelines · contact fabricated.person@fabricatedsystems.com" />'
  const TIKTOK_PAGE = '<html>Just an app wall.</html>'

  it('chains discovery into enrichment and files both facts', async () => {
    const output = await executeSocialScout(PERSON, {
      fetched: fetchedFrom({
        // Keys match the URLs exactly as discovery constructs them.
        'https://fabricatedsystems.com/': HOME,
        'https://www.instagram.com/fabricated.systems': IG_PAGE,
        'https://tiktok.com/@fabricated': TIKTOK_PAGE,
      }),
    })

    expect(output?.publishedEmail).toBe('fabricated.person@fabricatedsystems.com')
    // TikTok answered with an app wall: absent, not fabricated.
    // LinkedIn was discovered on the site...
    expect(output?.socials.linkedin).toContain('linkedin.com/company/fabricated-systems')

    const evidence = socialScoutEvidence(output, PERSON)

    // ...and filed against the company WITHOUT ever being fetched.
    const socials = evidence.find((item) => item.field === 'social_profiles')
    expect(socials?.entityType).toBe('company')
    expect(socials?.entityId).toBe(PERSON.companyId)
    expect(socials?.value).toMatchObject({
      instagram: 'https://www.instagram.com/fabricated.systems',
      linkedin: 'https://linkedin.com/company/fabricated-systems',
    })

    const email = evidence.find((item) => item.field === 'work_email')
    expect(email?.sourceConfidence).toBe('high')
    expect(email?.value).toEqual({ email: 'fabricated.person@fabricatedsystems.com' })
    expect(evidence.find((item) => item.field === 'email_status')?.value).toMatchObject({
      status: 'publicly_found',
    })
  }, 10_000)

  it('does not attach a generic or stranger mailbox to the person', async () => {
    const output = await executeSocialScout(PERSON, {
      fetched: fetchedFrom({
        'https://fabricatedsystems.com/':
          '<a href="https://instagram.com/fabricated.systems">IG</a> sales@fabricatedsystems.com',
        'https://instagram.com/fabricated.systems':
          '<meta property="og:description" content="dm randomperson@example.org" />',
      }),
    })

    expect(output?.publishedEmail).toBeNull()
    expect(output?.socials.instagram).toBe('https://instagram.com/fabricated.systems')
    expect(socialScoutEvidence(output, PERSON).some((item) => item.field === 'work_email')).toBe(false)
  })

  it('returns nothing when the site is dead and no page answers', async () => {
    const result = await executeSocialScout(PERSON, { fetched: async () => null })
    expect(result).toBeNull()
    expect(socialScoutEvidence(result, PERSON)).toEqual([])
  })

  it('returns nothing without a domain at all', async () => {
    const result = await executeSocialScout({ ...PERSON, companyDomain: null }, {})
    expect(result).toBeNull()
  })
})

describe('companyScout — company-scoped discovery', () => {
  const COMPANY = {
    type: 'company' as const,
    id: '00000000-0000-4000-8000-000000000002',
    name: 'Fabricated Systems',
    domain: 'fabricatedsystems.com',
    linkedinUrl: null,
  }

  function task(fields: readonly string[]) {
    return {
      id: 'company_profile:smoke',
      category: 'company_profile' as const,
      entity: COMPANY,
      fields: fields as never[],
    }
  }

  it('is free and answers its fields for a named company', async () => {
    const { companyScoutProvider } = await import('@/lib/intelligence/providers/social-scout')
    await expect(companyScoutProvider.estimateCost(task(['company_linkedin']))).resolves.toBe(0)
    expect(companyScoutProvider.canHandle(task(['company_linkedin', 'social_profiles']))).toBe(true)
    expect(companyScoutProvider.canHandle(task(['industry']))).toBe(false)
    expect(
      companyScoutProvider.canHandle({ ...task(['company_linkedin']), entity: { ...COMPANY, name: null } }),
    ).toBe(false)
  })

  it('files LinkedIn FIRST-CLASS and the rest as socials, against the company', async () => {
    const { executeCompanyScout, companyScoutEvidence } = await import('@/lib/intelligence/providers/social-scout')

    const output = await executeCompanyScout(COMPANY, {
      fetched: async (url) =>
        url === 'https://fabricatedsystems.com/'
          ? '<a href="https://linkedin.com/company/fabricated-systems">LI</a><a href="https://x.com/fabricated">X</a>'
          : null,
    })

    expect(output?.domain).toBe('fabricatedsystems.com')
    const evidence = companyScoutEvidence(output, COMPANY)

    const linkedin = evidence.find((item) => item.field === 'company_linkedin')
    expect(linkedin?.value).toEqual({ value: 'https://linkedin.com/company/fabricated-systems' })
    expect(linkedin?.sourceConfidence).toBe('high')

    // The LinkedIn handle is promoted to its own field, so the socials blob
    // carries the rest without duplicating it.
    const socials = evidence.find((item) => item.field === 'social_profiles')
    expect(socials?.value).toEqual({ x: 'https://x.com/fabricated' })
  })

  it('emits nothing when the site publishes no social accounts', async () => {
    const { executeCompanyScout } = await import('@/lib/intelligence/providers/social-scout')
    const output = await executeCompanyScout(COMPANY, {
      fetched: async (url) => (url === 'https://fabricatedsystems.com/' ? '<html>no links</html>' : null),
    })
    expect(output).toBeNull()
  })
})
