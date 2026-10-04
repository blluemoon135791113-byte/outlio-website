/**
 * Role suggestions from job titles — build step 4.
 *
 * ⚠️ THE RULES UNDER TEST ARE THE SEEDED ONES, read out of migration 0144
 * itself. A test with its own copy of the keywords would pass whatever the
 * workspace actually starts with; this one fails if the seed and the
 * classifier ever disagree about the spec's examples.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { classifyTitle, tokens, type Classifier } from '@/lib/crm/lead-roles'

const SQL = readFileSync(join(__dirname, '..', '..', 'supabase/migrations/0144_crm_account_config.sql'), 'utf8')

/** The seeded (system_key, match_kind, keyword) triples, parsed from 0144. */
function seededRules(): { key: string; kind: 'title' | 'function'; keyword: string }[] {
  const block = SQL.slice(SQL.indexOf('insert into public.crm_lead_role_rules'), SQL.indexOf(') as v(system_key, match_kind, keyword)'))
  return [...block.matchAll(/\('([a-z_]+)',\s*'(title|function)',\s*'([^']+)'\)/g)].map((m) => ({
    key: m[1]!,
    kind: m[2] as 'title' | 'function',
    keyword: m[3]!,
  }))
}

const KEYS = ['champion', 'decision_maker', 'technical', 'other'] as const
const SEEDED: Classifier = {
  roles: KEYS.map((key) => ({ id: key, systemKey: key, isActive: true })),
  rules: seededRules().map((r) => ({ roleId: r.key, matchKind: r.kind, keyword: r.keyword })),
}

const roles = (title: string | null, classifier: Classifier = SEEDED) => classifyTitle(title, classifier).sort()

describe('the seed is what the test thinks it is', () => {
  it('parses all 31 seeded keywords', () => {
    expect(SEEDED.rules).toHaveLength(31)
  })
})

describe("the spec's examples, against the seeded rules", () => {
  it('Revenue Cycle Manager → Champion', () => {
    expect(roles('Revenue Cycle Manager')).toEqual(['champion'])
  })
  it('VP Revenue Cycle → Decision Maker', () => {
    expect(roles('VP Revenue Cycle')).toEqual(['decision_maker'])
  })
  it('CFO → Decision Maker', () => {
    expect(roles('CFO')).toEqual(['decision_maker'])
  })
  it('CIO → Technical', () => {
    expect(roles('CIO')).toEqual(['technical'])
  })
})

describe('the rule', () => {
  it('a lead can hold several roles', () => {
    expect(roles('Chief Information Officer, IT')).toEqual(['decision_maker', 'technical'])
  })

  it('Champion needs a relevant function, not just a manager title', () => {
    expect(roles('Office Manager')).toEqual(['other'])
    expect(roles('Claims Supervisor')).toEqual(['champion'])
    expect(roles('Pharmacy Benefits Coordinator')).toEqual(['champion'])
  })

  it('multi-word keywords match as a phrase', () => {
    expect(roles('Head of Billing')).toEqual(['decision_maker'])
    expect(roles('Head Nurse')).toEqual(['other'])
  })

  it('matches whole words — "IT" is not in "Itinerary" or "Security"', () => {
    expect(roles('Itinerary Planner')).toEqual(['other'])
    expect(roles('Security Analyst')).toEqual(['other'])
    expect(roles('Director of IT')).toEqual(['decision_maker', 'technical'])
  })

  it('ignores case, punctuation and accents', () => {
    expect(roles('vp, revenue-cycle')).toEqual(['decision_maker'])
    expect(tokens('Directór')).toEqual(['director'])
  })

  it('no title is no evidence — not "Other"', () => {
    expect(roles(null)).toEqual([])
    expect(roles('   ')).toEqual([])
  })
})

describe('the rules are data', () => {
  it('a disabled role is never suggested', () => {
    const off: Classifier = {
      ...SEEDED,
      roles: SEEDED.roles.map((r) => (r.id === 'decision_maker' ? { ...r, isActive: false } : r)),
    }
    expect(roles('CFO', off)).toEqual(['other'])
  })

  it('a keyword an admin adds takes effect', () => {
    const more: Classifier = { ...SEEDED, rules: [...SEEDED.rules, { roleId: 'decision_maker', matchKind: 'title', keyword: 'SVP' }] }
    expect(roles('SVP Operations')).toEqual(['other'])
    expect(roles('SVP Operations', more)).toEqual(['decision_maker'])
  })

  it('a renamed role is still matched by id, not by name', () => {
    const renamed: Classifier = {
      ...SEEDED,
      roles: SEEDED.roles.map((r) => (r.id === 'technical' ? { ...r, id: 'tech-renamed' } : r)),
      rules: SEEDED.rules.map((r) => (r.roleId === 'technical' ? { ...r, roleId: 'tech-renamed' } : r)),
    }
    expect(roles('CIO', renamed)).toEqual(['tech-renamed'])
  })

  it('with no "other" role enabled, an unmatched title gets nothing', () => {
    const noOther: Classifier = { ...SEEDED, roles: SEEDED.roles.filter((r) => r.systemKey !== 'other') }
    expect(roles('Office Manager', noOther)).toEqual([])
  })
})
