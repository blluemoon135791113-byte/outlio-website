/**
 * The domain probe.
 *
 * The two rules that matter: a page is only evidence when it carries the
 * company's own name, and TWO verifying hosts mean we refuse rather than
 * guess — a wrong domain becomes the company's identity and can merge two
 * different companies into one row.
 */
import { describe, expect, it } from 'vitest'

import {
  candidateHosts,
  domainProbeProvider,
  servedDirectly,
  verifyPageMentionsCompany,
} from '@/lib/intelligence/providers/domain-probe'
import type { CompanyEntity, ResearchTask } from '@/lib/intelligence/types'

const COMPANY: CompanyEntity = {
  type: 'company',
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Fabricated Systems',
  domain: null,
  linkedinUrl: null,
}

function task(fields: ResearchTask['fields'], entity: CompanyEntity = COMPANY): ResearchTask {
  return {
    id: `company_profile:company:${entity.id}`,
    category: 'company_profile',
    entity,
    fields,
  }
}

describe('candidateHosts', () => {
  it('builds flat and hyphenated forms over a bounded TLD set', () => {
    expect(candidateHosts('Fabricated Systems')).toEqual([
      'fabricatedsystems.com',
      'fabricated-systems.com',
      'fabricatedsystems.io',
      'fabricated-systems.io',
    ])
  })

  it('gives a single-word name no hyphenated twin', () => {
    expect(candidateHosts('Acme')).toEqual(['acme.com', 'acme.co.uk'])
  })

  it('strips legal-form suffixes before building candidates', () => {
    // "Ltd" must not become part of the host.
    expect(candidateHosts('Fabricated Systems Ltd')[0]).toBe('fabricatedsystems.com')
  })

  it('returns nothing without a usable name', () => {
    expect(candidateHosts(null)).toEqual([])
    expect(candidateHosts('   ')).toEqual([])
  })
})

describe('verifyPageMentionsCompany', () => {
  const PAGE = `
    <html><head><title>Fabricated Systems — B2B lead research</title></head>
    <body><p>Welcome to Fabricated Systems, providers of honest pipelines.</p></body></html>
  `

  it('accepts the company speaking its own name', () => {
    expect(verifyPageMentionsCompany('Fabricated Systems', PAGE)).toBe(true)
  })

  it('matches across punctuation and spacing differences', () => {
    expect(verifyPageMentionsCompany('Fabricated Systems Ltd', PAGE)).toBe(true)
    expect(verifyPageMentionsCompany('fabricated, systems!', PAGE)).toBe(true)
  })

  it('REJECTS a parked or unrelated page', () => {
    expect(verifyPageMentionsCompany('Fabricated Systems', '<html><body>Buy this domain</body></html>')).toBe(false)
    expect(verifyPageMentionsCompany('Fabricated Systems', '')).toBe(false)
    expect(verifyPageMentionsCompany('Fabricated Systems', null)).toBe(false)
  })

  it('rejects a bare brand fragment as the needle', () => {
    // "Acme" alone appears in far too many unrelated pages to be identity.
    expect(verifyPageMentionsCompany('Acme', 'acme corp news roundup')).toBe(false)
  })

  it('rejects too-short names outright', () => {
    expect(verifyPageMentionsCompany('Aa', 'aaaa industries everywhere')).toBe(false)
  })
})

describe('servedDirectly — a redirect is not ownership', () => {
  it('counts a direct answer as the host speaking', () => {
    expect(servedDirectly('vercel.com', 'https://vercel.com/')).toBe(true)
  })

  it('counts a www-variant redirect as the same host', () => {
    expect(servedDirectly('acme.com', 'https://www.acme.com/home')).toBe(true)
    expect(servedDirectly('www.acme.com', 'https://acme.com/')).toBe(true)
  })

  it('REJECTS a candidate that merely redirected to another site', () => {
    // vercel.co.uk inheriting vercel.com's page must not become a second
    // verified identity — that manufactured ambiguity refused real sites.
    expect(servedDirectly('vercel.co.uk', 'https://vercel.com/')).toBe(false)
  })

  it('treats an unknown landing URL as direct', () => {
    expect(servedDirectly('vercel.com', null)).toBe(true)
    expect(servedDirectly('vercel.com', undefined)).toBe(true)
  })
})

describe('the domain-probe provider', () => {
  it('is free', async () => {
    await expect(domainProbeProvider.estimateCost(task(['company_domain']))).resolves.toBe(0)
  })

  it('handles domain tasks for companies with no captured website', () => {
    expect(domainProbeProvider.canHandle(task(['company_domain']))).toBe(true)
  })

  it('declines when the capture already has a domain, or the field was not asked', () => {
    expect(
      domainProbeProvider.canHandle(task(['company_domain'], { ...COMPANY, domain: 'fabricatedsystems.com' })),
    ).toBe(false)
    expect(domainProbeProvider.canHandle(task(['industry']))).toBe(false)
    expect(
      domainProbeProvider.canHandle({ ...task(['company_domain']), entity: { ...COMPANY, name: null } }),
    ).toBe(false)
    expect(
      domainProbeProvider.canHandle({
        ...task(['company_domain']),
        entity: { ...COMPANY, type: 'person' } as unknown as CompanyEntity,
      }),
    ).toBe(false)
  })

  it('emits nothing from a refused lookup', () => {
    expect(domainProbeProvider.normalize(null, task(['company_domain']))).toEqual([])
  })

  it('files verified domains at MEDIUM confidence with the probed URL as provenance', () => {
    const evidence = domainProbeProvider.normalize(
      { domain: 'fabricatedsystems.com', sourceUrl: 'https://fabricatedsystems.com/' },
      task(['company_domain']),
    )

    expect(evidence).toHaveLength(1)
    expect(evidence[0]).toMatchObject({
      field: 'company_domain',
      entityType: 'company',
      entityId: COMPANY.id,
      sourceProvider: 'domain-probe',
      sourceConfidence: 'medium',
      value: { domain: 'fabricatedsystems.com' },
    })
    expect(evidence[0]!.sourceUrl).toContain('https://')
  })
})
