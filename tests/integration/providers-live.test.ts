/**
 * LIVE provider smoke test — opt-in, never part of `npm test`.
 *
 * Every other suite runs against recorded responses. This one makes real calls
 * with the keys in `.env.local`, so it exists to answer one question:
 *
 *   "Are my credentials working, and what do these providers actually return
 *    for a real company?"
 *
 * Run it deliberately:
 *
 *   RUN_LIVE_PROVIDERS=1 npx vitest run tests/integration/providers-live.test.ts
 *
 * It spends real API credit (a few Tavily searches) and takes a minute or two,
 * mostly waiting on PageSpeed rendering a page.
 *
 * ⚠️ Assertions here are deliberately loose. A live third-party API is not a
 * stable fixture, and a smoke test that fails because a company's news cycle
 * was quiet this week teaches nothing. It checks the SHAPE of what comes back
 * and that credentials are accepted — correctness of parsing is proved in
 * `provider-extraction.test.ts` and `provider-registry.test.ts`, offline.
 */
import { describe, expect, it } from 'vitest'

import { executeTasks } from '@/lib/intelligence/execute'
import { resolveLlmProvider } from '@/lib/intelligence/llm/provider'
import { planQuery } from '@/lib/intelligence/planner'
import { buildLiveRegistry, providerReadiness } from '@/lib/intelligence/providers'
import type { CompanyEntity, ResearchTask } from '@/lib/intelligence/types'

const live = process.env.RUN_LIVE_PROVIDERS === '1'
const describeIf = live ? describe : describe.skip

if (!live) {
  console.warn(
    '[providers-live] SKIPPED. Set RUN_LIVE_PROVIDERS=1 to make real provider calls.',
  )
}

/**
 * A real, well-known company. Chosen because it is certain to exist in
 * Wikidata, has a website PageSpeed can render, and gets news coverage — so a
 * failure points at our code or credentials rather than at thin data.
 */
const SUBJECT: CompanyEntity = {
  type: 'company',
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Stripe',
  domain: null,
  linkedinUrl: null,
}

function task(category: ResearchTask['category'], fields: ResearchTask['fields']): ResearchTask {
  return { id: `${category}:smoke`, category, entity: SUBJECT, fields }
}

describeIf('live providers', () => {
  it('reports which providers are configured', () => {
    const readiness = providerReadiness()
    console.log('\nProvider readiness:')
    for (const provider of readiness) {
      console.log(`  ${provider.configured ? '✅' : '⚠️ '} ${provider.name} (${provider.category})`)
    }

    // Wikidata and GDELT need no key, so at least those must be usable.
    expect(readiness.some((provider) => provider.configured)).toBe(true)
  })

  it('finds a company domain, and prefers the stated fact over inference', async () => {
    const report = await executeTasks([task('company_profile', ['company_domain', 'industry'])], {
      registry: buildLiveRegistry(),
      timeoutMs: 30_000,
    })

    console.log('\ncompany_profile evidence:', JSON.stringify(report.evidence, null, 2))
    console.log('unknown:', report.results[0]?.unknownFields)

    const domain = report.evidence.find((item) => item.field === 'company_domain')
    expect(domain, 'no domain found for a company Wikidata definitely knows').toBeDefined()
    expect(domain!.value.domain).toBe('stripe.com')
    // Wikidata should have answered first, so discovery never had to run.
    expect(domain!.sourceProvider).toBe('wikidata')
  }, 120_000)

  it('returns news with a source URL on every claim', async () => {
    const report = await executeTasks([task('web_research', ['recent_news'])], {
      registry: buildLiveRegistry(),
      timeoutMs: 30_000,
    })

    console.log('\nweb_research evidence:', JSON.stringify(report.evidence, null, 2))

    // Coverage varies; what must hold is that anything returned is sourced.
    for (const item of report.evidence) {
      expect(item.sourceUrl, 'a claim arrived with no source URL').toBeTruthy()
      expect(item.sourceUrl!.startsWith('http')).toBe(true)
    }
  }, 120_000)

  it('never reports funding above MEDIUM confidence', async () => {
    const report = await executeTasks(
      [task('funding', ['funding_round', 'funding_amount', 'funding_date'])],
      { registry: buildLiveRegistry(), timeoutMs: 30_000 },
    )

    console.log('\nfunding evidence:', JSON.stringify(report.evidence, null, 2))

    for (const item of report.evidence) {
      // The invariant that must survive contact with real data: press-derived
      // funding is never presented as authoritative.
      expect(item.sourceConfidence).not.toBe('high')
      expect(item.sourceUrl).toBeTruthy()
    }
  }, 120_000)

  it('detects a tech stack from a live page', async () => {
    const withDomain: ResearchTask = {
      id: 'tech:smoke',
      category: 'tech_stack',
      entity: { ...SUBJECT, domain: 'stripe.com' },
      fields: ['tech_stack'],
    }

    const report = await executeTasks([withDomain], {
      registry: buildLiveRegistry(),
      // PageSpeed renders the page; it needs far longer than a JSON API.
      timeoutMs: 90_000,
    })

    console.log('\ntech_stack evidence:', JSON.stringify(report.evidence, null, 2))
    console.log('tool calls:', JSON.stringify(report.toolCalls, null, 2))

    // Lighthouse may legitimately detect nothing on a bespoke site. What must
    // never happen is a claim with no evidence behind it.
    for (const item of report.evidence) {
      expect(item.value.detected).toBeDefined()
      expect(item.sourceUrl).toBeTruthy()
    }
  }, 180_000)

  it('records a tool call for every attempt, with no secret in it', async () => {
    const report = await executeTasks([task('web_research', ['recent_news'])], {
      registry: buildLiveRegistry(),
      timeoutMs: 30_000,
    })

    expect(report.toolCalls.length).toBeGreaterThan(0)

    const serialized = JSON.stringify(report.toolCalls)
    for (const secret of [
      process.env.TAVILY_API_KEY,
      process.env.PAGESPEED_API_KEY,
      process.env.GITHUB_TOKEN,
    ]) {
      if (secret) expect(serialized).not.toContain(secret)
    }
  }, 120_000)
})

describeIf('live planner', () => {
  it('plans a specific question without asking for clarification', async () => {
    const llm = resolveLlmProvider()
    console.log(`\nLLM: ${llm.vendor} / ${llm.model} — configured: ${llm.isConfigured()}`)

    const outcome = await planQuery({
      question: 'Find Series A SaaS companies that raised more than $5M since January 2026.',
      llm,
    })

    console.log('plan outcome:', JSON.stringify(outcome, null, 2))

    // A question naming a round, a figure and a date needs no clarification.
    expect(outcome.status).toBe('planned')
    if (outcome.status !== 'planned') return
    expect(outcome.plan.requiredFields.length).toBeGreaterThan(0)
    // Whatever it chose must be a real, researchable field — the schema would
    // have rejected anything else before we got here.
    expect(outcome.plan.requiredFields).toContain('funding_amount')
  }, 90_000)

  it('asks what "recently" means', async () => {
    const outcome = await planQuery({
      question: 'Find recently funded companies.',
      llm: resolveLlmProvider(),
    })

    console.log('vague question outcome:', JSON.stringify(outcome, null, 2))

    // Models vary on how much they volunteer, so this is reported rather than
    // asserted — a planner that guesses a window is a product decision to
    // revisit, not a broken build.
    if (outcome.status === 'clarification_required') {
      expect(outcome.questions.length).toBeGreaterThan(0)
    } else {
      console.warn('  ⚠️  planner did not ask for clarification on a vague window')
    }
  }, 90_000)

  it('plans contact enrichment only for an email question', async () => {
    const outcome = await planQuery({
      question: 'Just give me the founders\' work email addresses.',
      llm: resolveLlmProvider(),
    })

    console.log('email question outcome:', JSON.stringify(outcome, null, 2))

    if (outcome.status !== 'planned') return
    // Spec acceptance Test 2: no funding, tech-stack, or web research.
    for (const field of outcome.plan.requiredFields) {
      expect(field.startsWith('work_') || field.startsWith('email_') || field.startsWith('mobile_') || field.startsWith('phone_')).toBe(true)
    }
  }, 90_000)
})
