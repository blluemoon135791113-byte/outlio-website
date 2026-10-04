/**
 * Account identity: two LinkedIn addresses kept apart, and the duplicate
 * report used by manual add and import (approved order: Sales Navigator id →
 * public page → domain → name; a conflict is reported, never resolved).
 */
import { describe, expect, it } from 'vitest'

import {
  classifyCompanyMatches,
  resolveCrmCompanyIdentity,
  type CompanyMatchRow,
} from '@/lib/crm/repository'

const row = (over: Partial<CompanyMatchRow> & { id: string }): CompanyMatchRow => ({
  name: null,
  normalized_name: null,
  normalized_domain: null,
  normalized_linkedin_url: null,
  normalized_sales_navigator_url: null,
  ...over,
})

describe('resolveCrmCompanyIdentity', () => {
  it('files each address by what it is, not by which field it came in', () => {
    const id = resolveCrmCompanyIdentity({
      name: 'Acme Health',
      linkedInUrl: 'https://www.linkedin.com/sales/company/1234?_ntb=x',
      salesNavigatorUrl: 'https://www.LinkedIn.com/company/Acme-Health/',
    })
    expect(id.normalizedSalesNavigatorUrl).toBe('linkedin.com/sales/company/1234')
    expect(id.normalizedLinkedInUrl).toBe('linkedin.com/company/acme-health')
  })

  it('keeps both when both are given in the right fields', () => {
    const id = resolveCrmCompanyIdentity({
      linkedInUrl: 'linkedin.com/company/acme',
      salesNavigatorUrl: 'https://www.linkedin.com/sales/company/55',
    })
    expect(id.normalizedLinkedInUrl).toBe('linkedin.com/company/acme')
    expect(id.normalizedSalesNavigatorUrl).toBe('linkedin.com/sales/company/55')
  })

  it('ignores casing and trailing slashes in either', () => {
    const a = resolveCrmCompanyIdentity({ linkedInUrl: 'https://www.linkedin.com/company/ACME/' })
    const b = resolveCrmCompanyIdentity({ linkedInUrl: 'linkedin.com/company/acme' })
    expect(a.normalizedLinkedInUrl).toBe(b.normalizedLinkedInUrl)
  })

  it('never derives one address from the other', () => {
    const id = resolveCrmCompanyIdentity({ linkedInUrl: 'https://www.linkedin.com/company/acme' })
    expect(id.normalizedSalesNavigatorUrl).toBeNull()
  })
})

describe('classifyCompanyMatches', () => {
  const identity = resolveCrmCompanyIdentity({
    name: 'Acme Health, Inc.',
    websiteUrl: 'https://www.acme.example.com',
    linkedInUrl: 'linkedin.com/company/acme',
    salesNavigatorUrl: 'linkedin.com/sales/company/1234',
  })

  it('orders certain matches Navigator → public page → domain', () => {
    const report = classifyCompanyMatches(identity, [
      row({ id: 'by-domain', normalized_domain: identity.normalizedDomain }),
      row({ id: 'by-nav', normalized_sales_navigator_url: 'linkedin.com/sales/company/1234' }),
      row({ id: 'by-li', normalized_linkedin_url: 'linkedin.com/company/acme' }),
    ])
    expect(report.exact.map((m) => [m.id, m.matchedBy])).toEqual([
      ['by-nav', 'sales_navigator'],
      ['by-li', 'linkedin'],
      ['by-domain', 'domain'],
    ])
  })

  it('is a CONFLICT when two different accounts match on different keys', () => {
    const report = classifyCompanyMatches(identity, [
      row({ id: 'acme', normalized_sales_navigator_url: 'linkedin.com/sales/company/1234' }),
      row({ id: 'globex', normalized_domain: identity.normalizedDomain }),
    ])
    expect(report.conflict).toBe(true)
  })

  it('is NOT a conflict when every key points at the same account', () => {
    const report = classifyCompanyMatches(identity, [
      row({
        id: 'acme',
        normalized_sales_navigator_url: 'linkedin.com/sales/company/1234',
        normalized_domain: identity.normalizedDomain,
        normalized_name: identity.normalizedName,
      }),
    ])
    expect(report).toMatchObject({ conflict: false, possible: [] })
    expect(report.exact.map((m) => m.id)).toEqual(['acme'])
  })

  it('a name-only match is POSSIBLE, never exact', () => {
    const report = classifyCompanyMatches(identity, [
      row({ id: 'same-name', normalized_name: identity.normalizedName }),
    ])
    expect(report.exact).toEqual([])
    expect(report.possible).toEqual([
      { id: 'same-name', name: null, matchedBy: 'name', hasStrongIdentity: false },
    ])
  })

  it('reports whether the name match has a strong identity of its own', () => {
    const report = classifyCompanyMatches(identity, [
      row({ id: 'other', normalized_name: identity.normalizedName, normalized_domain: 'other.example.com' }),
    ])
    expect(report.possible[0]!.hasStrongIdentity).toBe(true)
  })

  it('still recognises a Navigator id left in the LinkedIn column during the 0145 transition', () => {
    const report = classifyCompanyMatches(identity, [
      row({ id: 'old', normalized_linkedin_url: 'linkedin.com/sales/company/1234' }),
    ])
    expect(report.exact).toEqual([
      { id: 'old', name: null, matchedBy: 'sales_navigator', hasStrongIdentity: true },
    ])
  })

  it('the same case-and-slash differences that collapse identity collapse matches', () => {
    const typed = resolveCrmCompanyIdentity({ name: 'X', linkedInUrl: 'https://www.LinkedIn.com/company/ACME/' })
    const report = classifyCompanyMatches(typed, [
      row({ id: 'acme', normalized_linkedin_url: 'linkedin.com/company/acme' }),
    ])
    expect(report.exact.map((m) => m.id)).toEqual(['acme'])
  })
})
