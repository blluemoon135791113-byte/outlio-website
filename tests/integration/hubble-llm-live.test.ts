/**
 * Opt-in launch smoke test for Hubble's exact synthesis contract.
 *
 * Unlike the planner smoke test, this sends a realistic evidence payload and
 * requires a cited, polished answer. It spends one small LLM request.
 *
 *   RUN_HUBBLE_LLM=1 npx vitest run tests/integration/hubble-llm-live.test.ts
 */
import { describe, expect, it } from 'vitest'

import { answerFromEvidence } from '@/lib/hubble/reason'
import type { ScoredChunk } from '@/lib/hubble/retrieve'

const live = process.env.RUN_HUBBLE_LLM === '1'
const describeIf = live ? describe : describe.skip

if (!live) {
  console.warn('[hubble-llm-live] SKIPPED. Set RUN_HUBBLE_LLM=1 to call the configured model.')
}

const evidence: ScoredChunk[] = [
  {
    pageId: 'acme-newsroom',
    url: 'https://acme.example/news/series-a',
    title: 'Acme announces Series A',
    ordinal: 0,
    score: 1,
    content:
      'On 14 August 2026, Acme announced a $12 million Series A financing round led by Northstar Ventures.',
  },
  {
    pageId: 'northstar-portfolio',
    url: 'https://northstar.example/portfolio/acme',
    title: 'Northstar welcomes Acme',
    ordinal: 0,
    score: 0.9,
    content:
      'Northstar Ventures led Acme’s $12 million Series A round, announced on 14 August 2026.',
  },
]

describeIf('live Hubble synthesis', () => {
  it('writes a specific, cited answer through the production model waterfall', async () => {
    const result = await answerFromEvidence(
      'When did Acme raise its Series A, how much was it, and who led it?',
      evidence,
      'Company: Acme',
      'acme.example',
      'Acme',
      Date.now() + 30_000,
      2,
    )

    console.log('\nHubble synthesis:', JSON.stringify(result.answer, null, 2))

    expect(result.answer.synthesis).toBe('completed')
    expect(result.answer.status).not.toBe('unknown')
    expect(result.answer.answer).toMatch(/12 million/i)
    expect(result.answer.answer).toMatch(/14 August 2026|August 14, 2026/i)
    expect(result.answer.answer).toMatch(/Northstar Ventures/i)
    expect(result.answer.sources.length).toBeGreaterThan(0)
  }, 60_000)
})
