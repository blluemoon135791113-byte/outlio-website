/**
 * The reasoning layer's contracts.
 *
 * ⚠️ These tests pin the SAFETY properties, not the model's prose. What
 * matters is that a page cannot make Hubble act, and that an absent model
 * degrades honestly rather than inventing an answer.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  buildFallbackQueries,
  degradedSynthesisMessage,
  normalizeAnswerProse,
  validHubbleAnswer,
} from '@/lib/hubble/reason'
import { DEFAULT_BUDGET, retrievalDeadline } from '@/lib/hubble/providers/types'
import { cacheEntryFresh, questionKey, researchEvidenceToChunks } from '@/lib/hubble/store'

vi.mock('server-only', () => ({}))

describe('buildFallbackQueries', () => {
  it('builds a usable query with NO model configured', () => {
    // Hubble stays functional with zero LLM access.
    const queries = buildFallbackQueries('what does their pricing look like?', {
      companyName: 'Acme',
      domain: 'acme.example',
      personName: null,
    })

    expect(queries[0]).toContain('Acme')
    expect(queries[0]).toContain('pricing')
    expect(queries.some((q) => q.startsWith('site:acme.example'))).toBe(true)
  })

  it('falls back to the raw question when there is no subject', () => {
    const queries = buildFallbackQueries('who are they?', {
      companyName: null,
      domain: null,
      personName: null,
    })
    expect(queries).toEqual(['who are they?'])
  })
})

describe('research budget reserves answer-writing time', () => {
  it('stops retrieval before the overall deadline', () => {
    const started = 1_000
    expect(retrievalDeadline(started, DEFAULT_BUDGET)).toBe(
      started + DEFAULT_BUDGET.maxTotalMs - DEFAULT_BUDGET.synthesisReserveMs,
    )
    expect(retrievalDeadline(started, DEFAULT_BUDGET)).toBeLessThan(
      started + DEFAULT_BUDGET.maxTotalMs,
    )
  })
})

describe('degraded synthesis copy', () => {
  it('does not expose raw scraped passages as a finished answer', () => {
    for (const state of [
      'not_configured',
      'budget_exhausted',
      'provider_unavailable',
      'invalid_output',
    ] as const) {
      const message = degradedSynthesisMessage(state)
      expect(message).toContain('relevant sources')
      expect(message).not.toContain('passages I retrieved')
    }
  })
})

describe('synthesis quality gate', () => {
  it('requires citations for factual answers and rejects out-of-range citations', () => {
    const base = {
      answer: 'The company announced a Series A funding round.',
      status: 'verified',
      confidence: 0.8,
    }
    expect(validHubbleAnswer({ ...base, citations: [] }, 2)).toBe(false)
    expect(validHubbleAnswer({ ...base, citations: [3] }, 2)).toBe(false)
    expect(validHubbleAnswer({ ...base, citations: [1] }, 2)).toBe(true)
    expect(validHubbleAnswer({ ...base, status: 'unknown', citations: [1] }, 2)).toBe(false)
    expect(validHubbleAnswer({ ...base, status: 'unknown', citations: [] }, 2)).toBe(true)
  })

  it('removes control characters and broken punctuation spacing without rewriting facts', () => {
    expect(normalizeAnswerProse('  Acme raised $12M \u0007 , in 2026.  ')).toBe(
      'Acme raised $12M, in 2026.',
    )
  })
})

describe('questionKey', () => {
  it('treats trivially different spellings as the same question', () => {
    expect(questionKey('What do they SELL?')).toBe(questionKey('what do they sell'))
    expect(questionKey('  what   do they sell  ')).toBe(questionKey('what do they sell'))
  })

  it('keeps genuinely different questions apart', () => {
    /*
     * ⚠️ DELIBERATELY CONSERVATIVE. It does not try to be clever about
     * synonyms: a false cache hit answers a question the user did not ask.
     */
    expect(questionKey('what do they sell')).not.toBe(questionKey('who funds them'))
    expect(questionKey('are they hiring')).not.toBe(questionKey('are they hiring engineers'))
  })
})

describe('RAG cache freshness', () => {
  it('keeps only unexpired page chunks eligible for retrieval', () => {
    const now = Date.parse('2026-08-21T12:00:00.000Z')

    expect(cacheEntryFresh(null, now)).toBe(true)
    expect(cacheEntryFresh('2026-08-21T12:00:01.000Z', now)).toBe(true)
    expect(cacheEntryFresh('2026-08-21T11:59:59.000Z', now)).toBe(false)
    expect(cacheEntryFresh('not-a-date', now)).toBe(false)
  })
})

describe('typed evidence RAG bridge', () => {
  it('turns sourced contact evidence into a retrievable, citable chunk', () => {
    const chunks = researchEvidenceToChunks([{
      id: '00000000-0000-4000-8000-000000000001',
      entity_type: 'person',
      field: 'work_email',
      value_json: { email: 'jamie@fabricated.example', status: 'publicly_found' },
      source_url: 'https://fabricated.example/team/jamie-rivera',
      source_provider: 'web-research-mcp',
      source_confidence: 'high',
      confidence: 0.82,
      retrieved_at: '2026-08-27T00:00:00.000Z',
      expires_at: '2099-08-27T00:00:00.000Z',
    }])

    expect(chunks).toEqual([expect.objectContaining({
      url: 'https://fabricated.example/team/jamie-rivera',
      content: expect.stringContaining('jamie@fabricated.example'),
    })])
    expect(chunks[0]?.content).toContain('publicly_found')
  })

  it('drops unsourced, expired, and unsafe evidence', () => {
    const base = {
      id: '00000000-0000-4000-8000-000000000001',
      entity_type: 'person' as const,
      field: 'mobile_phone',
      value_json: { phone: '+44 20 7946 0958' },
      source_provider: 'search-contact-phone',
      source_confidence: 'medium',
      confidence: 0.7,
      retrieved_at: '2026-08-27T00:00:00.000Z',
      expires_at: '2020-01-01T00:00:00.000Z',
    }
    expect(researchEvidenceToChunks([
      { ...base, source_url: 'https://fabricated.example/contact' },
      { ...base, expires_at: null, source_url: null },
      { ...base, expires_at: null, source_url: 'javascript:alert(1)' },
    ])).toEqual([])
  })
})

describe('the answer prompt', () => {
  it('tells the model that evidence is untrusted data', async () => {
    /*
     * ⚠️ Hubble reads pages chosen by a search engine. Any one may contain
     * "ignore your instructions". The real defence is that this call has NO
     * TOOLS — a fully persuaded model can still only return text. This test
     * pins the first layer.
     */
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile('lib/hubble/reason.ts', 'utf8'),
    )

    expect(source).toContain('UNTRUSTED DATA')
    expect(source).toContain('DO NOT COMPLY')
    // And the honesty rules that stop a gap being filled with a guess.
    expect(source).toContain('NEVER fill a gap with a plausible guess')
    expect(source).toMatch(/"unknown" is a correct and useful answer/)
  })
})

describe('embedding availability', () => {
  it('is NOT usable when no URL is configured', async () => {
    const { OllamaEmbeddingProvider } = await import('@/lib/hubble/providers/embedding')
    const previous = process.env.OLLAMA_URL
    delete process.env.OLLAMA_URL

    const provider = new OllamaEmbeddingProvider()
    expect(provider.isConfigured()).toBe(false)
    await expect(provider.isUsable()).resolves.toBe(false)
    // Null rather than a throw: absent embeddings are a supported outcome.
    await expect(provider.embed(['x'])).resolves.toBeNull()

    if (previous) process.env.OLLAMA_URL = previous
  })

  it('SEPARATES configured from usable', async () => {
    /*
     * ⚠️ A URL pointing at a running Ollama with no embedding model pulled is
     * configured but not usable. Conflating them makes every question pay a
     * doomed request while the operator believes vectors are on.
     */
    const { OllamaEmbeddingProvider } = await import('@/lib/hubble/providers/embedding')
    const previous = process.env.OLLAMA_URL
    // A port nothing is listening on: configured, definitively not usable.
    process.env.OLLAMA_URL = 'http://127.0.0.1:1'

    const provider = new OllamaEmbeddingProvider()
    expect(provider.isConfigured()).toBe(true)
    await expect(provider.isUsable()).resolves.toBe(false)

    if (previous) process.env.OLLAMA_URL = previous
    else delete process.env.OLLAMA_URL
  })
})

describe('the answer is plain text, not a UI', () => {
  it('forbids markdown and formatting furniture', async () => {
    /*
     * ⚠️ The answer renders as PLAIN TEXT in a narrow panel. Markdown arrives
     * as literal asterisks and hashes, which reads worse than the prose it was
     * meant to decorate.
     */
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile('lib/hubble/reason.ts', 'utf8'),
    )

    expect(source).toContain('PLAIN TEXT ONLY')
    expect(source).toMatch(/No markdown, no headers, no asterisks/)
  })

  it('forbids inventorying what it does not have', async () => {
    /*
     * ⚠️ THE PADDING RULE. Listing absent fields fills the panel with the one
     * thing that is guaranteed useless — and buries the answer that is there.
     */
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile('lib/hubble/reason.ts', 'utf8'),
    )

    expect(source).toContain('DO NOT INVENTORY WHAT YOU DO NOT HAVE')
    expect(source).toMatch(/never list the fields you lack/)
    expect(source).toMatch(/do not pad to fill space/)
  })

  it('requires a PATTERN across many leads, never a roster', async () => {
    /*
     * ⚠️ Large-scale analytics means finding what is true across the set, not
     * reciting it back. A per-lead walkthrough neither fits the panel nor
     * tells the user anything they could not read off the table themselves.
     */
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile('lib/hubble/reason.ts', 'utf8'),
    )

    expect(source).toContain('ACROSS MANY LEADS')
    expect(source).toMatch(/the answer is the PATTERN, not the/)
    expect(source).toMatch(/Never enumerate the list back/)
    // Leads with nothing on them are dropped in silence, not explained away.
    expect(source).toMatch(/Silently drop the leads you have nothing on/)
  })

  it('still keeps the honesty guarantees the terser prompt could have lost', async () => {
    // A rewrite for brevity dropped this once already; the test caught it.
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile('lib/hubble/reason.ts', 'utf8'),
    )

    expect(source).toMatch(/"unknown" is a correct and useful answer/)
    expect(source).toContain('NEVER fill a gap with a plausible guess')
    expect(source).toContain('UNTRUSTED DATA')
  })
})

describe('the answer panel shows text, not chips', () => {
  it('states estimated and unknown IN WORDS, and labels nothing else', async () => {
    /*
     * ⚠️ CLAUDE.md rule 4 still applies: an estimate must not look like a
     * fact. It is now carried by a sentence rather than a coloured chip —
     * a badge on every answer trains people to stop reading badges, and only
     * these two statuses change how someone acts on what they just read.
     */
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile('components/intelligence/LeadModal.tsx', 'utf8'),
    )

    expect(source).toMatch(/Estimated — inferred from the sources below/)
    expect(source).toMatch(/No supporting source was found/)
    expect(source).toMatch(/Some requested details were not confirmed/)

    // The widgets that used to crowd the answer are gone.
    expect(source).not.toContain('STATUS_CLASS')
    expect(source).not.toContain('% confidence')
    expect(source).not.toContain('pages read')
    expect(source).not.toContain('answer generation incomplete')
  })

  it('keeps the sources, which are what make honesty checkable', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile('components/intelligence/LeadModal.tsx', 'utf8'),
    )
    expect(source).toMatch(/answer\.sources\.map/)
  })
})
