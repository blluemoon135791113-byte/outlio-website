/**
 * The GLEIF adapter.
 *
 * The identity gate is the important part. An LEI record binds official facts
 * to ONE legal entity, so two candidate registrations under one normalized
 * name are ambiguous and refused — the cost of an empty cell is lower than
 * attaching another company's status to a lead.
 */
import { describe, expect, it } from 'vitest'

import {
  extractGleifFacts,
  formatGleifAddress,
  gleifProvider,
  pickGleifRecord,
  type GleifSearchItem,
} from '@/lib/intelligence/providers/gleif'
import type { CompanyEntity, ResearchTask } from '@/lib/intelligence/types'

const COMPANY: CompanyEntity = {
  type: 'company',
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Fabricated Systems Ltd',
  domain: null,
  linkedinUrl: null,
}

function record(options: {
  id?: string
  lei?: string
  name?: string
  status?: string
  jurisdiction?: string
  legalForm?: unknown
}): GleifSearchItem {
  return {
    id: options.id ?? options.lei ?? '54930084UKLVMY22DS16',
    attributes: {
      lei: options.lei ?? '54930084UKLVMY22DS16',
      entity: {
        legalName: { name: options.name ?? 'Fabricated Systems Ltd' },
        status: options.status,
        jurisdiction: options.jurisdiction,
        legalForm: options.legalForm,
      },
      registration: { status: 'ISSUED' },
    },
  }
}

describe('pickGleifRecord', () => {
  it('accepts the single exact normalized match', () => {
    const match = pickGleifRecord('Fabricated Systems Ltd', [
      record({}),
    ])

    expect(match?.attributes?.lei).toBe('54930084UKLVMY22DS16')
  })

  it('REFUSES when two registrations share one legal name', () => {
    const match = pickGleifRecord('Fabricated Systems Ltd', [
      record({ id: '11111111111111111111', name: 'Fabricated Systems Ltd' }),
      record({ id: '22222222222222222222', name: 'FABRICATED SYSTEMS LTD' }),
    ])

    expect(match).toBeNull()
  })

  it('accepts a match that differs only by legal-form suffix', () => {
    // "Acme Inc" and "Acme" are the same company; stripping trailing legal
    // forms before comparing is the shared normalization contract.
    const match = pickGleifRecord('Fabricated Systems', [record({})])
    expect(match?.attributes?.lei).toBe('54930084UKLVMY22DS16')
  })

  it('refuses a different company name', () => {
    // A substantive word difference is a different entity, suffix rules aside.
    const match = pickGleifRecord('Unrelated Fabrications', [
      record({ name: 'Fabricated Systems Ltd' }),
    ])

    expect(match).toBeNull()
  })

  it('refuses a blank or missing company name', () => {
    expect(pickGleifRecord(null, [record({})])).toBeNull()
    expect(pickGleifRecord('', [record({})])).toBeNull()
  })
})

describe('extractGleifFacts', () => {
  it('projects the record defensively', () => {
    const facts = extractGleifFacts(record({
      status: 'ACTIVE',
      jurisdiction: 'GG',
      legalForm: 'Private Limited Company',
    }))

    expect(facts).toMatchObject({
      lei: '54930084UKLVMY22DS16',
      legalName: 'Fabricated Systems Ltd',
      entityStatus: 'ACTIVE',
      jurisdiction: 'GG',
      legalForm: 'Private Limited Company',
    })
  })

  it('reads the legal form in either API shape', () => {
    const asString = extractGleifFacts(record({ legalForm: 'Limited Liability Company' }))
    expect(asString?.legalForm).toBe('Limited Liability Company')

    const asPair = extractGleifFacts(record({ legalForm: { id: 'H0PO', other: null } }))
    // Falls back to the official registry code when no plain-language form exists.
    expect(asPair?.legalForm).toBe('H0PO')
  })

  it('rejects a malformed LEI and an id/payload disagreement', () => {
    expect(extractGleifFacts(record({ lei: 'not-an-lei' }))).toBeNull()

    const tampered = record({})
    tampered.id = '99999999999999999999'
    // A disagreement between the resource id and the payload LEI is a malformed
    // response, not a fact about the company.
    expect(extractGleifFacts(tampered)).toBeNull()
  })
})

describe('formatGleifAddress', () => {
  it('joins address lines with the named parts, without duplication', () => {
    expect(formatGleifAddress({
      addressLines: ['12 Fabricated House', 'Test Street'],
      city: 'St Peter Port',
      region: null,
      postalCode: 'GY1 1AA',
      country: 'Guernsey',
    })).toBe('12 Fabricated House, Test Street, St Peter Port, GY1 1AA, Guernsey')
  })

  it('accepts a plain-string address line and returns null for nothing', () => {
    expect(formatGleifAddress({ addressLines: ['PO Box 123'], country: 'BVI' })).toBe(
      'PO Box 123, BVI',
    )
    expect(formatGleifAddress(null)).toBeNull()
    expect(formatGleifAddress({})).toBeNull()
  })
})

describe('the gleif provider', () => {
  function task(fields: ResearchTask['fields']): ResearchTask {
    return {
      id: `company_profile:company:${COMPANY.id}`,
      category: 'company_profile',
      entity: COMPANY,
      fields,
    }
  }

  it('is free', async () => {
    await expect(gleifProvider.estimateCost(task(['lei_number']))).resolves.toBe(0)
  })

  it('handles company tasks that ask for fields it answers', () => {
    expect(gleifProvider.canHandle(task(['lei_number']))).toBe(true)
    expect(gleifProvider.canHandle(task(['company_status', 'jurisdiction']))).toBe(true)
  })

  it('declines tasks it could not answer', () => {
    expect(gleifProvider.canHandle(task(['industry']))).toBe(false)
    expect(gleifProvider.canHandle(task(['funding_round']))).toBe(false)
    expect(
      gleifProvider.canHandle({ ...task(['lei_number']), entity: { ...COMPANY, name: null } }),
    ).toBe(false)
    expect(
      gleifProvider.canHandle({
        ...task(['lei_number']),
        entity: { ...COMPANY, type: 'person' } as unknown as CompanyEntity,
      }),
    ).toBe(false)
  })

  it('files evidence against the company with an official source URL', () => {
    const evidence = gleifProvider.normalize(
      {
        lei: '54930084UKLVMY22DS16',
        legalName: 'Fabricated Systems Ltd',
        entityStatus: 'ACTIVE',
        jurisdiction: 'GG',
        legalForm: 'Private Limited Company',
        registeredOffice: 'St Peter Port, Guernsey',
      },
      task(['lei_number']),
    )

    expect(evidence.find((item) => item.field === 'lei_number')?.value).toEqual({
      value: '54930084UKLVMY22DS16',
    })
    for (const item of evidence) {
      expect(item.entityType).toBe('company')
      expect(item.entityId).toBe(COMPANY.id)
      expect(item.sourceConfidence).toBe('high')
      expect(item.sourceUrl).toContain('/lei-records/')
    }
  })

  it('emits nothing from a refused lookup', () => {
    expect(gleifProvider.normalize(null, task(['lei_number']))).toEqual([])
  })
})
