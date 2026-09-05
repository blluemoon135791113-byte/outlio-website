/**
 * The Scout provider.
 *
 * The three gates are the point: PUBLISHED (on the company's own site) stores
 * at high confidence, SMTP-verified-with-accept-all-control stores at medium,
 * and everything else — plausible patterns the server would not confirm, and
 * every address on a catch-all server — is refused. A guess that looks like a
 * contact detail is fabrication with a bounce attached.
 */
import { describe, expect, it } from 'vitest'

import { ALL_PROVIDERS } from '@/lib/intelligence/providers'
import {
  applyPattern,
  controlEmailFor,
  detectPattern,
  executeScout,
  extractEmails,
  generateCandidates,
  isHarvestableEmail,
  isPersonMailbox,
  scoutEvidence,
} from '@/lib/intelligence/providers/scout'
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
  companyId: '00000000-0000-4000-8000-000000000001',
}

describe('extractEmails — scraper noise is not an address', () => {
  it('harvests real addresses and deduplicates', () => {
    expect(
      extractEmails('Contact sam@acme.com or SAM@Acme.com, else sales@acme.com'),
    ).toEqual(['sam@acme.com', 'sales@acme.com'])
  })

  it('rejects framework and example noise', () => {
    for (const email of [
      'support@example.com',
      'user@test.com',
      'logo@gravatar.com',
      'x@w3.org',
    ]) {
      expect(isHarvestableEmail(email), email).toBe(false)
    }
  })

  it('rejects asset filenames wearing email clothes', () => {
    expect(isHarvestableEmail('sprite@2x.png')).toBe(false)
  })

  it('NEVER accepts the Outlio address as a lead contact', () => {
    // YouTube's player config echoes the request User-Agent into the page
    // body; without this guard our own contact address came home as a fact
    // about ThreatSpike.
    expect(isHarvestableEmail('contact@outlio.io')).toBe(false)
  })

  it('strips the reflected User-Agent echo before extraction', () => {
    const echoedPage =
      '<html>{"config":{"userAgent":"OutlioLeadEngine/1.0 (+https://outlio.io; business research; contact@outlio.io)"},"visitor":"x"}</html>'
    expect(extractEmails(echoedPage)).toEqual([])
  })
})

describe('isPersonMailbox — company inboxes are not person contacts', () => {
  it('accepts common mailbox forms that match the full name', () => {
    for (const email of [
      'fabricated.person@acme.com',
      'fabricatedperson@acme.com',
      'fperson@acme.com',
      'f.person@acme.com',
      'fabricated@acme.com',
    ]) {
      expect(isPersonMailbox(email, 'Fabricated Person'), email).toBe(true)
    }
  })

  it('rejects generic and other-person mailboxes', () => {
    for (const email of [
      'sales@acme.com',
      'info@acme.com',
      'sam.jones@acme.com',
    ]) {
      expect(isPersonMailbox(email, 'Fabricated Person'), email).toBe(false)
    }
  })

  it('never turns a generic mailbox into a match because of the lead name', () => {
    expect(isPersonMailbox('info@acme.com', 'Info Person')).toBe(false)
  })
})

describe('pattern detection — a wrong template makes a confident wrong candidate', () => {
  it('reads the dot-separated shapes', () => {
    expect(detectPattern('sam.jones')).toBe('first.last')
    expect(detectPattern('s.jones')).toBe('f.last')
  })

  it('refuses shapes it cannot read', () => {
    // `samjones` could be flast OR firstlast — one sample cannot tell.
    // A bare word is ambiguous between first/flast/firstlast — even 'sam'.
    expect(detectPattern('samjones')).toBeNull()
    expect(detectPattern('sam')).toBeNull()
    expect(detectPattern('sam1')).toBeNull()
    expect(detectPattern('sam..jones')).toBeNull()
    expect(detectPattern('s.')).toBeNull()
  })
})

describe('applyPattern', () => {
  it('applies every template', () => {
    expect(applyPattern('first.last', 'Sam', 'Jones', 'acme.com')).toBe('sam.jones@acme.com')
    expect(applyPattern('f.last', 'Sam', 'Jones', 'acme.com')).toBe('s.jones@acme.com')
    expect(applyPattern('flast', 'Sam', 'Jones', 'acme.com')).toBe('sjones@acme.com')
    expect(applyPattern('firstlast', 'Sam', 'Jones', 'acme.com')).toBe('samjones@acme.com')
    expect(applyPattern('first', 'Sam', 'Jones', 'acme.com')).toBe('sam@acme.com')
  })

  it('refuses names stripped to nothing', () => {
    expect(applyPattern('first.last', '!!!', '???', 'acme.com')).toBeNull()
  })
})

describe('generateCandidates', () => {
  it('orders conventions most-common first and caps the list', () => {
    expect(generateCandidates('Fabricated Person', 'acme.com', 3)).toEqual([
      'fabricated.person@acme.com',
      'fabricatedperson@acme.com',
      'fperson@acme.com',
    ])
  })

  it('needs both a full name and a domain', () => {
    expect(generateCandidates('Cher', 'acme.com')).toEqual([])
    expect(generateCandidates('Sam Jones', null)).toEqual([])
  })
})

describe('controlEmailFor — the catch-all tripwire', () => {
  it('uses a local part no mailbox plausibly holds', () => {
    expect(controlEmailFor('acme.com')).toMatch(/^zzznonexistent999@/)
  })
})

describe('executeScout', () => {
  const SITE_HTML =
    '<html><body>Mail: fabricated.person@fabricatedsystems.com · alt: info@fabricatedsystems.com</body></html>'

  /** One-argument verification seam matching the provider's smtpVerify option. */
  type Verify = (email: string) => Promise<{ probed: boolean; exists: boolean; acceptAll: boolean }>

  const verdict = (exists: boolean, acceptAll = false): Verify =>
    async (email) => ({ probed: true, exists, acceptAll, ...(email ? {} : {}) })

  function harvestFrom(pages: Record<string, string>) {
    return async (url: string) => pages[url] ?? null
  }

  it('publishes an on-domain address WITHOUT any SMTP probing', async () => {
    let verifications = 0
    const result = await executeScout(PERSON, {
      fetched: harvestFrom({
        'https://fabricatedsystems.com/': SITE_HTML,
        ...Object.fromEntries(
          ['/contact/', '/contact-us/', '/about/', '/about-us/'].map((p) => [`https://fabricatedsystems.com${p}`, null]),
        ),
      }),
      probeEnabled: true,
      smtpVerify: async (email) => {
        verifications += 1
        void email
        return { probed: true, exists: false, acceptAll: false }
      },
    })

    // The company published this person's mailbox; no mail server needs to agree.
    expect(result?.published).toBe('fabricated.person@fabricatedsystems.com')
    expect(result?.verified).toBeNull()
    expect(verifications).toBe(0)

    const evidence = scoutEvidence(result, PERSON)
    expect(evidence.find((item) => item.field === 'email_status')?.value).toMatchObject({
      status: 'publicly_found',
    })
  })

  it('stores an SMTP-confirmed pattern candidate at MEDIUM confidence', async () => {
    const result = await executeScout(PERSON, {
      fetched: harvestFrom({}),
      probeEnabled: true,
      smtpVerify: (email) =>
        email === 'fabricated.person@fabricatedsystems.com'
          ? Promise.resolve({ probed: true, exists: true, acceptAll: false })
          : Promise.resolve({ probed: true, exists: false, acceptAll: false }),
    })

    expect(result?.published).toBeNull()
    expect(result?.verified).toBe('fabricated.person@fabricatedsystems.com')

    const evidence = scoutEvidence(result, PERSON)
    expect(evidence.find((item) => item.field === 'work_email')?.value).toEqual({
      email: 'fabricated.person@fabricatedsystems.com',
    })
    expect(evidence.find((item) => item.field === 'work_email')?.sourceConfidence).toBe('medium')
  })

  it('REFUSES a catch-all server: its yes means nothing', async () => {
    const result = await executeScout(PERSON, {
      fetched: harvestFrom({}),
      probeEnabled: true,
      smtpVerify: verdict(true, true),
    })

    expect(result).toBeNull()
    expect(scoutEvidence(result, PERSON)).toEqual([])
  })

  it('stores NOTHING for an unconfirmed pattern', async () => {
    const result = await executeScout(PERSON, {
      fetched: harvestFrom({}),
      probeEnabled: true,
      smtpVerify: verdict(false),
    })

    expect(result).toBeNull()
  })

  it('never probes at all when SMTP verification is not enabled', async () => {
    let verifications = 0

    await executeScout(PERSON, {
      fetched: harvestFrom({}),
      probeEnabled: false,
      smtpVerify: async (email) => {
        verifications += 1
        void email
        return { probed: true, exists: true, acceptAll: false }
      },
    })

    expect(verifications).toBe(0)
  })

  it('returns nothing without a usable domain', async () => {
    const result = await executeScout(
      { ...PERSON, companyDomain: null },
      { fetched: harvestFrom({}) },
    )
    expect(result).toBeNull()
  })

  it('never probes or assigns a generic published inbox to the person', async () => {
    const asked: string[] = []

    await executeScout(
      { ...PERSON, fullName: 'Info Person' },
      {
        fetched: harvestFrom({ 'https://fabricatedsystems.com/': 'info@fabricatedsystems.com' }),
        probeEnabled: true,
        smtpVerify: async (email) => {
          asked.push(email)
          return { probed: true, exists: true, acceptAll: false }
        },
      },
    )

    // `info@` remains company evidence and never becomes a person candidate.
    expect(asked).not.toContain('info@fabricatedsystems.com')
  })
})

describe('the contact waterfall', () => {
  it('puts the free sources ahead of the gated paid pair', async () => {
    const { DEFAULT_PROVIDER_ORDER } = await import('@/lib/intelligence/providers')
    expect(DEFAULT_PROVIDER_ORDER.contact_email).toEqual([
      'scout',
      'social-scout',
      'search-contact-email',
      'prospeo-email',
      'apollo-email',
    ])
  })

  it('declines tasks without a captured or discovered domain', async () => {
    const scoutEmailProvider = ALL_PROVIDERS.find((provider) => provider.name === 'scout')!
    const task = {
      id: 'contact_email:smoke',
      category: 'contact_email' as const,
      entity: { ...PERSON, companyDomain: null },
      fields: ['work_email' as const],
    }
    expect(scoutEmailProvider.canHandle(task)).toBe(false)
    expect(scoutEmailProvider.estimateCost(task)).resolves.toBe(0)
  })
})
