/**
 * Waterfall execution and failure isolation.
 *
 * Covers acceptance Test 6 (spec §59): one provider fails, the fallback runs,
 * and if none succeed the field becomes `unknown` while the rest of the job
 * continues.
 *
 * The rule these tests defend: **a missing answer is never `false`.** "This
 * company does not use HubSpot" and "we could not find out" must stay
 * distinguishable all the way to the result table.
 */
import { describe, expect, it } from 'vitest'

import { executeTasks } from '@/lib/intelligence/execute'
import { createRegistry, parseProviderOrder } from '@/lib/intelligence/registry'
import { planToTasks } from '@/lib/intelligence/router'
import type { CompanyEntity, PersonEntity, ResearchTask } from '@/lib/intelligence/types'
import { eraseProviderType } from '@/lib/intelligence/types'
import { stubProvider } from '../stubs/intelligence-providers'

function company(n: number): CompanyEntity {
  return {
    type: 'company',
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    name: `Company ${n}`,
    domain: `company-${n}.com`,
    linkedinUrl: null,
  }
}

function person(n: number): PersonEntity {
  return {
    type: 'person',
    id: `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    fullName: `Person ${n}`,
    linkedinUrl: null,
    jobTitle: 'Founder',
    companyName: 'Company 1',
    companyDomain: 'company-1.com',
  }
}

function fundingTask(n = 1): ResearchTask {
  return {
    id: `funding:company:${company(n).id}`,
    category: 'funding',
    entity: company(n),
    fields: ['funding_round', 'funding_amount'],
  }
}

describe('Test 6 — a provider failure never fails the run', () => {
  it('falls through to the next provider in the category', async () => {
    const first = { calls: 0 }
    const second = { calls: 0 }

    const registry = createRegistry(
      [
        eraseProviderType(stubProvider({
          name: 'alpha',
          category: 'funding',
          behaviour: { kind: 'error' },
          counter: first,
        })),
        eraseProviderType(stubProvider({
          name: 'beta',
          category: 'funding',
          behaviour: { kind: 'answers', fields: ['funding_round', 'funding_amount'] },
          counter: second,
        })),
      ],
      { funding: ['alpha', 'beta'] },
    )

    const report = await executeTasks([fundingTask()], { registry })

    expect(first.calls).toBe(1)
    expect(second.calls).toBe(1)
    expect(report.evidence).toHaveLength(2)
    expect(report.results[0]!.unknownFields).toHaveLength(0)
    // Both attempts are recorded, including the failed one.
    expect(report.toolCalls.map((c) => c.status)).toEqual(['error', 'success'])
  })

  it('leaves the field unknown — not false — when every provider fails', async () => {
    const registry = createRegistry([
      eraseProviderType(stubProvider({ name: 'alpha', category: 'funding', behaviour: { kind: 'error' } })),
      eraseProviderType(stubProvider({ name: 'beta', category: 'funding', behaviour: { kind: 'error' } })),
    ])

    const report = await executeTasks([fundingTask()], { registry })

    expect(report.evidence).toHaveLength(0)
    expect(report.results[0]!.unknownFields.map((f) => f.field)).toEqual([
      'funding_round',
      'funding_amount',
    ])
    expect(report.results[0]!.unknownFields[0]!.reason).toBe('provider_unavailable')
  })

  it('continues the rest of the job when one task fails', async () => {
    const registry = createRegistry([
      eraseProviderType(stubProvider({
        name: 'funding-down',
        category: 'funding',
        behaviour: { kind: 'error' },
      })),
      eraseProviderType(stubProvider({
        name: 'tech-up',
        category: 'tech_stack',
        behaviour: { kind: 'answers', fields: ['tech_stack'] },
      })),
    ])

    const plan = planToTasks({
      companies: [company(1), company(2)],
      people: [],
      requiredFields: ['funding_amount', 'tech_stack'],
    })

    const report = await executeTasks(plan.tasks, { registry })

    // 4 tasks: funding and tech stack for each of two companies.
    expect(report.results).toHaveLength(4)
    // The tech-stack half succeeded regardless of the funding outage.
    expect(report.evidence).toHaveLength(2)
    expect(report.tasksUnresolved).toBe(2)
    expect(report.tasksCompleted).toBe(2)
  })

  it('reports not_found differently from unavailable', async () => {
    const registry = createRegistry([
      eraseProviderType(stubProvider({ name: 'alpha', category: 'funding', behaviour: { kind: 'not_found' } })),
    ])

    const report = await executeTasks([fundingTask()], { registry })

    expect(report.results[0]!.unknownFields[0]!.reason).toBe('not_found')
    expect(report.toolCalls[0]!.status).toBe('not_found')
  })

  it('marks a field unknown when no provider is configured at all', async () => {
    const report = await executeTasks([fundingTask()], { registry: createRegistry([]) })

    expect(report.results[0]!.unknownFields[0]!.reason).toBe('no_provider_configured')
    // Nothing was called, so nothing was charged.
    expect(report.toolCalls).toHaveLength(0)
    expect(report.estimatedCostMicros).toBe(0)
  })

  it('times out a hanging provider and moves on', async () => {
    const registry = createRegistry(
      [
        eraseProviderType(stubProvider({ name: 'slow', category: 'funding', behaviour: { kind: 'hang' } })),
        eraseProviderType(stubProvider({
          name: 'fast',
          category: 'funding',
          behaviour: { kind: 'answers', fields: ['funding_round', 'funding_amount'] },
        })),
      ],
      { funding: ['slow', 'fast'] },
    )

    const report = await executeTasks([fundingTask()], { registry, timeoutMs: 25 })

    expect(report.toolCalls[0]!.status).toBe('timeout')
    expect(report.toolCalls[0]!.errorCode).toBe('ERR_TIMEOUT')
    expect(report.evidence).toHaveLength(2)
  })

  it('never leaks a provider message into the recorded error', async () => {
    const registry = createRegistry([
      eraseProviderType(stubProvider({
        name: 'alpha',
        category: 'funding',
        behaviour: { kind: 'error', message: 'https://api.vendor.com?key=sk-secret-123' },
      })),
    ])

    const report = await executeTasks([fundingTask()], { registry })

    expect(report.toolCalls[0]!.errorCode).toBe('ERR_PROVIDER_UNAVAILABLE')
    expect(JSON.stringify(report.toolCalls)).not.toContain('sk-secret')
  })
})

describe('the waterfall stops paying once a field is answered', () => {
  it('never calls the second provider when the first answers everything', async () => {
    const second = { calls: 0 }

    const registry = createRegistry(
      [
        eraseProviderType(stubProvider({
          name: 'alpha',
          category: 'contact_email',
          behaviour: { kind: 'answers', fields: ['work_email'] },
        })),
        eraseProviderType(stubProvider({
          name: 'beta',
          category: 'contact_email',
          behaviour: { kind: 'answers', fields: ['work_email'] },
          counter: second,
        })),
      ],
      { contact_email: ['alpha', 'beta'] },
    )

    const report = await executeTasks(
      [
        {
          id: 't',
          category: 'contact_email',
          entity: person(1),
          fields: ['work_email'],
        },
      ],
      { registry },
    )

    expect(second.calls).toBe(0)
    expect(report.externalCallCount).toBe(1)
  })

  it('asks the next provider only for the fields still missing', async () => {
    const registry = createRegistry(
      [
        eraseProviderType(stubProvider({
          name: 'alpha',
          category: 'funding',
          behaviour: { kind: 'answers', fields: ['funding_round'] },
        })),
        eraseProviderType(stubProvider({
          name: 'beta',
          category: 'funding',
          behaviour: { kind: 'answers', fields: ['funding_round', 'funding_amount'] },
        })),
      ],
      { funding: ['alpha', 'beta'] },
    )

    const report = await executeTasks([fundingTask()], { registry })

    expect(report.evidence).toHaveLength(2)
    // The first provider's answer is kept; beta only supplied the gap.
    const round = report.evidence.find((e) => e.field === 'funding_round')
    expect(round!.sourceProvider).toBe('alpha')
    expect(report.tasksCompleted).toBe(1)
  })
})

describe('provider output is untrusted input', () => {
  it('discards evidence about a different entity', async () => {
    const registry = createRegistry([
      eraseProviderType(stubProvider({ name: 'confused', category: 'funding', behaviour: { kind: 'wrong_entity' } })),
    ])

    const report = await executeTasks([fundingTask()], { registry })

    expect(report.evidence).toHaveLength(0)
    expect(report.results[0]!.unknownFields).toHaveLength(2)
  })

  it('rejects malformed evidence rather than storing it', async () => {
    const registry = createRegistry([
      eraseProviderType(stubProvider({ name: 'broken', category: 'funding', behaviour: { kind: 'malformed' } })),
    ])

    const report = await executeTasks([fundingTask()], { registry })

    expect(report.evidence).toHaveLength(0)
    expect(report.toolCalls[0]!.status).toBe('not_found')
  })
})

describe('registry configuration', () => {
  it('parses a waterfall from an environment string', () => {
    expect(parseProviderOrder('contact_email=leadmagic>prospeo>apollo,funding=alpha')).toEqual({
      contact_email: ['leadmagic', 'prospeo', 'apollo'],
      funding: ['alpha'],
    })
  })

  it('ignores unknown categories and malformed entries', () => {
    expect(parseProviderOrder('nonsense=x,funding=,=y,funding=alpha')).toEqual({
      funding: ['alpha'],
    })
    expect(parseProviderOrder(undefined)).toEqual({})
  })

  it('puts unnamed providers after named ones instead of dropping them', () => {
    const registry = createRegistry(
      [
        eraseProviderType(stubProvider({ name: 'unnamed', category: 'funding', behaviour: { kind: 'not_found' } })),
        eraseProviderType(stubProvider({ name: 'named', category: 'funding', behaviour: { kind: 'not_found' } })),
      ],
      { funding: ['named'] },
    )

    expect(registry.forCategory('funding').map((p) => p.name)).toEqual(['named', 'unnamed'])
  })

  it('reports which categories are actually available', () => {
    const registry = createRegistry([
      eraseProviderType(stubProvider({ name: 'a', category: 'tech_stack', behaviour: { kind: 'not_found' } })),
    ])

    expect(registry.has('tech_stack')).toBe(true)
    expect(registry.has('funding')).toBe(false)
    expect(registry.availableCategories()).toEqual(['tech_stack'])
  })
})
