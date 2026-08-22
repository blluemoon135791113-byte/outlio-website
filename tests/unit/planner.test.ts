/**
 * The natural-language planner.
 *
 * Every case uses a stub model, so these tests are about what happens when a
 * model returns something plausible but wrong — which is the failure mode that
 * matters, since the model's output decides what the customer is charged for.
 *
 * Covers spec acceptance Tests 2, 3 and 4.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  applyClarifications,
  buildSystemPrompt,
  planQuery,
  usesProtectedCharacteristic,
} from '@/lib/intelligence/planner'
import type { LLMProvider, LlmResult } from '@/lib/intelligence/llm/provider'
import { RESEARCH_FIELDS } from '@/lib/intelligence/types'

/** A model that returns whatever it is told to, one reply per call. */
function stubLlm(replies: LlmResult[], onRequest?: (request: unknown) => void): LLMProvider {
  let index = 0
  return {
    vendor: 'gemini',
    model: 'stub',
    isConfigured: () => true,
    generateJson: async (request) => {
      onRequest?.(request)
      return replies[Math.min(index++, replies.length - 1)]!
    },
  }
}

function replied(json: unknown): LlmResult {
  return { ok: true, json, vendor: 'gemini', model: 'stub' }
}

describe('planQuery — happy paths', () => {
  it('preserves an explicit round and date window the model dropped', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-22T12:00:00.000Z'))
    try {
      const llm = stubLlm([
        replied({
          requiredFields: ['funding_round', 'funding_date'],
          filters: { timeframe: 'Past 7 days' },
          clarificationRequired: false,
        }),
      ])

      const outcome = await planQuery({
        question: 'Find companies that received their Series A this week.',
        llm,
      })

      expect(outcome.status).toBe('planned')
      if (outcome.status !== 'planned') return
      expect(outcome.plan.filters).toMatchObject({
        funding_round: 'Series A',
        funded_after: '2026-08-17',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('turns "more than one investor" into an executable count filter', async () => {
    const calls = vi.fn()
    const llm = stubLlm([
      replied({ requiredFields: ['funding_investors'], filters: {}, clarificationRequired: false }),
    ], calls)

    const outcome = await planQuery({
      question: 'Find me companies with more than one investor.',
      llm,
    })

    expect(outcome.status).toBe('planned')
    if (outcome.status !== 'planned') return
    expect(outcome.plan.filters.minimum_investor_count).toBe(2)
    expect(outcome.plan.requiredFields).toContain('funding_investors')
    expect(calls).not.toHaveBeenCalled()
  })

  it('turns the spec §6 example into a funding plan', async () => {
    const llm = stubLlm([
      replied({
        entityScope: 'companies',
        requiredFields: ['funding_round', 'funding_amount', 'funding_date'],
        outputFields: ['person_name', 'company_name', 'funding_amount', 'funding_date'],
        filters: {
          funding_round: 'Series A',
          minimum_funding_amount_usd: 5_000_000,
          funding_date_window_months: 18,
        },
        clarificationRequired: false,
      }),
    ])

    const outcome = await planQuery({
      question:
        'Find founders whose SaaS companies raised a Series A over $5M during the last 18 months.',
      llm,
    })

    expect(outcome.status).toBe('planned')
    if (outcome.status !== 'planned') return
    expect(outcome.plan.requiredFields).toEqual([
      'funding_round',
      'funding_amount',
      'funding_date',
      'business_model',
    ])
    expect(outcome.plan.filters.business_model).toBe('SaaS')
    expect(outcome.plan.filters.minimum_funding_amount_usd).toBe(5_000_000)
  })

  it('Test 3 — asks what "recently" means', async () => {
    const llm = stubLlm([
      replied({
        requiredFields: ['funding_round', 'funding_date'],
        clarificationRequired: true,
        clarificationQuestions: [
          {
            id: 'funding_window',
            question: 'What should count as recently funded?',
            options: ['3 months', '6 months', '12 months', '18 months'],
          },
        ],
      }),
    ])

    const outcome = await planQuery({ question: 'Find recently funded companies.', llm })

    expect(outcome.status).toBe('clarification_required')
    if (outcome.status !== 'clarification_required') return
    expect(outcome.questions[0]!.options).toContain('12 months')
  })

  it('Test 4 — a specific question executes without clarification', async () => {
    const llm = stubLlm([
      replied({
        requiredFields: ['funding_round', 'funding_date'],
        filters: { funding_round: 'Series A', funded_after: '2026-01-01' },
        clarificationRequired: false,
      }),
    ])

    const outcome = await planQuery({
      question: 'Find Series A companies funded after January 1, 2026.',
      llm,
    })

    expect(outcome.status).toBe('planned')
  })

  it('Test 2 — "give me emails" plans contact work only', async () => {
    const llm = stubLlm([
      replied({ requiredFields: ['work_email'], clarificationRequired: false }),
    ])

    const outcome = await planQuery({ question: 'Give me founder emails.', llm })

    expect(outcome.status).toBe('planned')
    if (outcome.status !== 'planned') return
    expect(outcome.plan.requiredFields).toEqual(['work_email'])
  })

  it('does not let a model widen an explicit work-email-only request', async () => {
    const llm = stubLlm([
      replied({
        entityScope: 'people',
        requiredFields: ['person_seniority', 'work_email'],
        clarificationRequired: false,
      }),
    ])

    const outcome = await planQuery({
      question: "Just give me the founders' work email addresses.",
      llm,
    })

    expect(outcome.status).toBe('planned')
    if (outcome.status !== 'planned') return
    expect(outcome.plan.requiredFields).toEqual(['work_email'])
    expect(outcome.vendor).toBe('deterministic')
  })

  it('preserves SaaS and SDR hiring constraints even when the model drops them', async () => {
    const llm = stubLlm([
      replied({ requiredFields: ['hiring_signals'], filters: {}, clarificationRequired: false }),
    ])

    const outcome = await planQuery({ question: 'Find SaaS leads hiring SDRs', llm })

    expect(outcome.status).toBe('planned')
    if (outcome.status !== 'planned') return
    expect(outcome.plan.requiredFields).toEqual(['hiring_signals', 'business_model'])
    expect(outcome.plan.filters).toMatchObject({
      business_model: 'SaaS',
      hiring_roles: ['sdr'],
    })
  })
})

describe('planQuery — the model is not trusted', () => {
  it('REJECTS a hallucinated field, then accepts a corrected retry', async () => {
    const llm = stubLlm([
      replied({ requiredFields: ['ceo_star_sign'], clarificationRequired: false }),
      replied({ requiredFields: ['industry'], clarificationRequired: false }),
    ])

    const outcome = await planQuery({ question: 'What industry are they in?', llm })

    expect(outcome.status).toBe('planned')
    if (outcome.status !== 'planned') return
    expect(outcome.plan.requiredFields).toEqual(['industry'])
  })

  it('fails rather than executing when the model never returns a valid plan', async () => {
    const llm = stubLlm([
      replied({ requiredFields: ['nonsense'], clarificationRequired: false }),
      replied({ requiredFields: [], clarificationRequired: false }),
    ])

    const outcome = await planQuery({ question: 'Anything.', llm })

    // Nothing runs, nothing is charged.
    expect(outcome.status).toBe('failed')
  })

  it('fails on prose instead of trying to interpret it', async () => {
    const llm = stubLlm([
      { ok: false, code: 'unparseable', detail: 'completion was not JSON' },
      { ok: false, code: 'unparseable', detail: 'completion was not JSON' },
    ])

    expect((await planQuery({ question: 'Find companies.', llm })).status).toBe('failed')
  })

  it('fails cleanly when the model is unreachable', async () => {
    const llm = stubLlm([{ ok: false, code: 'unavailable', detail: 'ERR_TIMEOUT from host' }])
    const outcome = await planQuery({ question: 'Find companies.', llm })

    expect(outcome.status).toBe('failed')
    if (outcome.status !== 'failed') return
    // The reason is safe to show a user: no host, no code, no vendor detail.
    expect(outcome.reason).not.toContain('ERR_TIMEOUT')
  })

  it('does not retry when no model is configured', async () => {
    const calls = vi.fn()
    const llm: LLMProvider = {
      vendor: 'gemini',
      model: 'stub',
      isConfigured: () => true,
      generateJson: async () => {
        calls()
        return { ok: false, code: 'not_configured', detail: 'no key' }
      },
    }

    await planQuery({ question: 'Find companies.', llm })
    expect(calls).toHaveBeenCalledTimes(1)
  })

  it('treats a clarification request with no questions as executable', async () => {
    // Otherwise the run would wait forever on a question nobody can answer.
    const llm = stubLlm([
      replied({
        requiredFields: ['industry'],
        clarificationRequired: true,
        clarificationQuestions: [],
      }),
    ])

    const outcome = await planQuery({ question: 'What industry?', llm })
    expect(outcome.status).toBe('planned')
  })
})

describe('planQuery — refusals and input limits', () => {
  it('refuses qualification on protected characteristics before the model sees it', async () => {
    const calls = vi.fn()
    const llm = stubLlm([replied({ requiredFields: ['industry'], clarificationRequired: false })], calls)

    const outcome = await planQuery({ question: 'Find me founders by religion.', llm })

    expect(outcome.status).toBe('refused')
    // The model is never asked. This is not a judgement call to delegate.
    expect(calls).not.toHaveBeenCalled()
  })

  it('flags the characteristics named in spec §44', () => {
    for (const term of [
      'race',
      'ethnicity',
      'religion',
      'sexual orientation',
      'disability',
      'political opinion',
      'trade union',
    ]) {
      expect(usesProtectedCharacteristic(`companies filtered by ${term}`), term).toBe(true)
    }
  })

  it('does not flag ordinary business questions', () => {
    for (const question of [
      'Which companies use HubSpot and Intercom but not Salesforce?',
      'Find agencies with more than 20 employees',
      'Show me companies that recently announced funding',
      'Which companies are hiring SDRs right now?',
    ]) {
      expect(usesProtectedCharacteristic(question), question).toBe(false)
    }
  })

  it('rejects an empty or oversized question without calling the model', async () => {
    const calls = vi.fn()
    const llm = stubLlm([replied({ requiredFields: ['industry'], clarificationRequired: false })], calls)

    expect((await planQuery({ question: '   ', llm })).status).toBe('failed')
    expect((await planQuery({ question: 'x'.repeat(2001), llm })).status).toBe('failed')
    expect(calls).not.toHaveBeenCalled()
  })
})

describe('the prompt', () => {
  it('lists every researchable field so the model cannot invent one', () => {
    const prompt = buildSystemPrompt()
    for (const field of RESEARCH_FIELDS) {
      expect(prompt, `${field} is missing from the catalog`).toContain(field)
    }
  })

  it('tells the model it must not state facts', () => {
    expect(buildSystemPrompt()).toContain('Never state a fact')
  })

  it('contains no lead data — the model never sees prospects', async () => {
    let captured: { system: string; user: string } | null = null
    const llm = stubLlm(
      [replied({ requiredFields: ['industry'], clarificationRequired: false })],
      (request) => {
        captured = request as { system: string; user: string }
      },
    )

    await planQuery({ question: 'What industry are these companies in?', llm })

    expect(captured).not.toBeNull()
    const sent = `${captured!.system} ${captured!.user}`
    // Only the catalog, the rules, and the question. Nothing from the database.
    expect(sent).not.toContain('@')
    expect(sent).not.toContain('linkedin.com')
  })
})

describe('applyClarifications', () => {
  it('folds answers into filters and unblocks the plan', () => {
    const plan = {
      entityScope: 'companies' as const,
      requiredFields: ['funding_date' as const],
      outputFields: [],
      filters: { funding_round: 'Series A' },
      clarificationRequired: true,
      clarificationQuestions: [{ id: 'funding_window', question: 'How recent?', options: [] }],
    }

    const updated = applyClarifications(plan, { funding_window: '12 months' })

    expect(updated.clarificationRequired).toBe(false)
    expect(updated.clarificationQuestions).toEqual([])
    expect(updated.filters).toEqual({
      funding_round: 'Series A',
      funding_window: '12 months',
    })
  })

  it('ignores blank answers rather than storing empty criteria', () => {
    const plan = {
      entityScope: 'companies' as const,
      requiredFields: ['funding_date' as const],
      outputFields: [],
      filters: {},
      clarificationRequired: true,
      clarificationQuestions: [],
    }

    expect(applyClarifications(plan, { funding_window: '  ' }).filters).toEqual({})
  })
})
