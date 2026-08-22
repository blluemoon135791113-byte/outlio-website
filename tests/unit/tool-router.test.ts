/**
 * Tool routing — the spec's acceptance criteria, asserted as task counts.
 *
 * Task counts are the right assertion because they are what turns into money.
 * A router that "works" but emits one task per lead instead of one per company
 * is a 5,000-call bill for 1,850 calls' worth of information.
 *
 * Covers acceptance Tests 1, 2, 5, 7 and 8 (spec §59).
 */
import { describe, expect, it } from 'vitest'

import { evidenceKey, type FieldKnowledge } from '@/lib/intelligence/evidence'
import { categoriesForFields, planToTasks } from '@/lib/intelligence/router'
import type {
  CompanyEntity,
  EvidenceRecord,
  PersonEntity,
  ResearchField,
} from '@/lib/intelligence/types'

function company(n: number): CompanyEntity {
  return {
    type: 'company',
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    name: `Company ${n}`,
    domain: `company-${n}.com`,
    linkedinUrl: null,
  }
}

function person(n: number, companyIndex: number): PersonEntity {
  return {
    type: 'person',
    id: `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    fullName: `Person ${n}`,
    linkedinUrl: null,
    jobTitle: 'Founder',
    companyName: `Company ${companyIndex}`,
    companyDomain: `company-${companyIndex}.com`,
    companyId: null,
  }
}

function fresh(entityId: string, field: ResearchField): [string, FieldKnowledge] {
  const record: EvidenceRecord = {
    id: 'e',
    entityType: 'company',
    entityId,
    field,
    value: { value: 'cached' },
    sourceProvider: 'cache',
    sourceUrl: null,
    sourceConfidence: 'high',
    confidence: 0.9,
    retrievedAt: new Date().toISOString(),
    expiresAt: null,
    researchRunId: null,
  }
  return [
    evidenceKey('company', entityId, field),
    { state: 'known', record, conflicting: [] },
  ]
}

describe('Test 1 — research runs per company, never per lead', () => {
  it('turns 1,000 leads across 200 companies into 200 funding tasks', () => {
    const companies = Array.from({ length: 200 }, (_, i) => company(i))
    const people = Array.from({ length: 1000 }, (_, i) => person(i, i % 200))

    const plan = planToTasks({
      companies,
      people,
      requiredFields: ['funding_round', 'funding_amount', 'funding_date'],
    })

    // 200 tasks, NOT 1,000 — and not 600 either: three funding fields batch
    // into one call per company.
    expect(plan.tasks).toHaveLength(200)
    expect(plan.companiesResearched).toBe(200)
    expect(plan.peopleResearched).toBe(0)
    expect(plan.tasks.every((task) => task.fields.length === 3)).toBe(true)
  })
})

describe('Test 7 — two leads at one company research it once', () => {
  it('emits a single tech-stack task', () => {
    const plan = planToTasks({
      companies: [company(1)],
      people: [person(1, 1), person(2, 1)],
      requiredFields: ['tech_stack'],
    })

    expect(plan.tasks).toHaveLength(1)
    expect(plan.tasks[0]!.category).toBe('tech_stack')
  })

  it('ignores a company repeated in the input', () => {
    const plan = planToTasks({
      companies: [company(1), company(1), company(1)],
      people: [],
      requiredFields: ['tech_stack'],
    })

    expect(plan.tasks).toHaveLength(1)
  })
})

describe('Test 5 — fresh data is reused, never re-bought', () => {
  it('emits no task when every field is already known', () => {
    const target = company(1)
    const plan = planToTasks({
      companies: [target],
      people: [],
      requiredFields: ['employee_count', 'industry'],
      knowledge: new Map([
        fresh(target.id, 'employee_count'),
        fresh(target.id, 'industry'),
      ]),
    })

    expect(plan.tasks).toHaveLength(0)
    expect(plan.cacheHits).toBe(2)
    expect(plan.fieldsToResearch).toBe(0)
  })

  it('researches only the missing field', () => {
    const target = company(1)
    const plan = planToTasks({
      companies: [target],
      people: [],
      requiredFields: ['employee_count', 'industry'],
      knowledge: new Map([fresh(target.id, 'employee_count')]),
    })

    expect(plan.tasks).toHaveLength(1)
    expect(plan.tasks[0]!.fields).toEqual(['industry'])
    expect(plan.cacheHits).toBe(1)
  })

  it('re-researches expired evidence', () => {
    const target = company(1)
    const plan = planToTasks({
      companies: [target],
      people: [],
      requiredFields: ['recent_news'],
      knowledge: new Map<string, FieldKnowledge>([
        [
          evidenceKey('company', target.id, 'recent_news'),
          { state: 'unknown', reason: 'expired' },
        ],
      ]),
    })

    expect(plan.tasks).toHaveLength(1)
  })

  it('only reuses evidence for the entity it belongs to', () => {
    const plan = planToTasks({
      companies: [company(1), company(2)],
      people: [],
      requiredFields: ['employee_count'],
      knowledge: new Map([fresh(company(1).id, 'employee_count')]),
    })

    expect(plan.tasks).toHaveLength(1)
    expect(plan.tasks[0]!.entity.id).toBe(company(2).id)
  })
})

describe('Test 2 — "give me emails" runs contact enrichment and nothing else', () => {
  it('never touches funding, tech stack, or web research', () => {
    const plan = planToTasks({
      companies: Array.from({ length: 50 }, (_, i) => company(i)),
      people: [person(1, 0), person(2, 0)],
      requiredFields: ['work_email'],
    })

    expect(plan.categories).toEqual(['contact_email'])
    // Person-level: one task per person, because an email belongs to a person.
    expect(plan.tasks).toHaveLength(2)
    expect(plan.companiesResearched).toBe(0)
  })
})

describe('Test 8 — a tech-stack question returns only tech-stack work', () => {
  it('routes HubSpot / Intercom / Salesforce to one category', () => {
    expect(categoriesForFields(['tech_stack'])).toEqual(['tech_stack'])

    const plan = planToTasks({
      companies: [company(1), company(2)],
      people: [person(1, 1)],
      requiredFields: ['tech_stack'],
    })

    expect(plan.categories).toEqual(['tech_stack'])
    expect(plan.tasks).toHaveLength(2)
  })
})

describe('mixed requests', () => {
  it('forwards filters to the provider task without widening the fields', () => {
    const plan = planToTasks({
      companies: [company(1)],
      people: [],
      requiredFields: ['funding_round'],
      filters: { funding_round: 'Series A', funded_after: '2026-08-17' },
    })

    expect(plan.tasks[0]?.filters).toEqual({
      funding_round: 'Series A',
      funded_after: '2026-08-17',
    })
    expect(plan.tasks[0]?.fields).toEqual(['funding_round'])
  })

  it('splits company and person fields onto the right entities', () => {
    const plan = planToTasks({
      companies: [company(1)],
      people: [person(1, 1), person(2, 1)],
      requiredFields: ['funding_amount', 'work_email', 'mobile_phone'],
    })

    // 1 funding task (company) + 2 email + 2 phone (person).
    expect(plan.tasks).toHaveLength(5)
    expect(new Set(plan.categories)).toEqual(
      new Set(['funding', 'contact_email', 'contact_phone']),
    )
    expect(plan.companiesResearched).toBe(1)
    expect(plan.peopleResearched).toBe(2)
  })

  it('does not batch fields from different categories into one call', () => {
    const plan = planToTasks({
      companies: [company(1)],
      people: [],
      requiredFields: ['funding_amount', 'tech_stack'],
    })

    expect(plan.tasks).toHaveLength(2)
  })

  it('de-duplicates a repeated field request', () => {
    const plan = planToTasks({
      companies: [company(1)],
      people: [],
      requiredFields: ['tech_stack', 'tech_stack', 'tech_stack'],
    })

    expect(plan.tasks).toHaveLength(1)
    expect(plan.tasks[0]!.fields).toEqual(['tech_stack'])
  })

  it('emits nothing for an empty request', () => {
    expect(planToTasks({ companies: [], people: [], requiredFields: [] }).tasks).toHaveLength(0)
    expect(
      planToTasks({ companies: [], people: [], requiredFields: ['tech_stack'] }).tasks,
    ).toHaveLength(0)
  })
})
