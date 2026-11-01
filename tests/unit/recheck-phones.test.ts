import { describe, expect, it } from 'vitest'

import { planPhoneRechecks, type SavedPhoneEvidence } from '@/scripts/recheck-saved-phones'

const COMPANY = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const PERSON = '33333333-3333-4333-8333-333333333333'

const evidence = (id: string, entityType: string, entityId: string, field: string, value: Record<string, unknown>): SavedPhoneEvidence =>
  ({ id, entityType, entityId, field, value })

describe('re-checking saved phones', () => {
  it('upgrades a company phone once a lead names its country, and its projection with it', () => {
    const plan = planPhoneRechecks(
      [evidence('e1', 'company', COMPANY, 'company_contact_phone', { phone: '(800) 555-0199', status: 'unverified' })],
      new Map([[COMPANY, null]]),
      [{ id: PERSON, companyId: COMPANY, location: 'Greater Phoenix Area' }],
    )
    expect(plan.upgraded).toEqual({ valid_toll_free: 1 })
    expect(plan.evidence[0].value).toMatchObject({ phone: '(800) 555-0199', status: 'valid_toll_free' })
    expect(plan.companies).toEqual([{ id: COMPANY, phone: '(800) 555-0199', status: 'valid_toll_free' }])
  })

  it('leaves a phone alone when no country can be read, and never touches one already judged', () => {
    const plan = planPhoneRechecks(
      [
        evidence('e1', 'company', COMPANY, 'company_contact_phone', { phone: '(800) 555-0199', status: 'publicly_found' }),
        evidence('e2', 'company', OTHER, 'company_contact_phone', { phone: '(800) 555-0199', status: 'valid_number' }),
      ],
      new Map(),
      [{ id: PERSON, companyId: COMPANY, location: 'Phoenix' }],
    )
    expect(plan.examined).toBe(1)
    expect(plan.stillUnchecked).toBe(1)
    expect(plan.evidence).toEqual([])
    expect(plan.companies).toEqual([])
  })

  it('never writes an invalid verdict — a repair does not drop saved numbers', () => {
    const plan = planPhoneRechecks(
      [evidence('e1', 'company', COMPANY, 'company_contact_phone', { phone: '+44 7700 900123', status: 'publicly_found' })],
      new Map([[COMPANY, 'London, England, United Kingdom']]),
      [],
    )
    expect(plan.readInvalid).toBe(1)
    expect(plan.evidence).toEqual([])
  })

  it("carries a person's verdict onto their status companion, keeping what it was found as", () => {
    const plan = planPhoneRechecks(
      [
        evidence('e1', 'person', PERSON, 'mobile_phone', { phone: '(800) 555-0199' }),
        evidence('e2', 'person', PERSON, 'phone_status', { status: 'unverified', foundAs: 'publicly_found' }),
      ],
      new Map(),
      [{ id: PERSON, companyId: null, location: 'Portland, Oregon Metropolitan Area' }],
    )
    expect(plan.evidence).toHaveLength(2)
    expect(plan.evidence[0].value).toMatchObject({ verification: { status: 'valid_toll_free' } })
    expect(plan.evidence[1].value).toEqual({ status: 'valid_toll_free', foundAs: 'publicly_found' })
    expect(plan.companies).toEqual([])
  })
})
