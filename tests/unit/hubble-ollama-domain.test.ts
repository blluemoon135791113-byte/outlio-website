/**
 * The local LLM provider, and the domain that makes search precise.
 */
import { describe, expect, it } from 'vitest'

import { isLocalModel, LlmWaterfall, OllamaLlmProvider } from '@/lib/hubble/providers/ollama-llm'
import { siteScopedQuery } from '@/lib/hubble/domain'
import type { LlmRequest, LlmResult, LLMProvider, LlmVendor } from '@/lib/intelligence/llm/provider'

describe('isLocalModel', () => {
  it('REFUSES :cloud models, which are local in name only', () => {
    /*
     * ⚠️ Ollama serves `glm-4.7:cloud` by proxying to ollama.com. The data
     * leaves the machine while every log still says "ollama". Refusing the
     * name outright is what stops the privacy claim quietly becoming false.
     */
    // ⚠️ BOTH SEPARATORS. Ollama names them `:cloud` AND `-cloud`; matching
    // only the first let `qwen3-coder:480b-cloud` through as "local".
    expect(isLocalModel('glm-4.7:cloud')).toBe(false)
    expect(isLocalModel('qwen3-coder:480b-cloud')).toBe(false)
    expect(isLocalModel('deepseek-v3.1:671b-cloud')).toBe(false)
  })

  it('accepts genuinely local models', () => {
    expect(isLocalModel('qwen2.5:7b-instruct')).toBe(true)
    expect(isLocalModel('llama3.1:8b')).toBe(true)
    expect(isLocalModel('nomic-embed-text')).toBe(true)
  })
})

describe('OllamaLlmProvider', () => {
  it('is not configured without a URL', () => {
    const previous = process.env.OLLAMA_URL
    delete process.env.OLLAMA_URL

    expect(new OllamaLlmProvider().isConfigured()).toBe(false)

    if (previous) process.env.OLLAMA_URL = previous
  })

  it('reports NOT CONFIGURED for a cloud model, rather than proxying silently', async () => {
    const prevUrl = process.env.OLLAMA_URL
    const prevModel = process.env.OLLAMA_LLM_MODEL
    process.env.OLLAMA_URL = 'http://127.0.0.1:11434'
    process.env.OLLAMA_LLM_MODEL = 'glm-4.7:cloud'

    const provider = new OllamaLlmProvider()
    expect(provider.isConfigured()).toBe(false)

    const result = await provider.generateJson({ system: 's', user: 'u', schema: {} })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('not_configured')

    if (prevUrl) process.env.OLLAMA_URL = prevUrl
    if (prevModel) process.env.OLLAMA_LLM_MODEL = prevModel
    else delete process.env.OLLAMA_LLM_MODEL
  })
})

/** A provider that fails a set number of times, then succeeds. */
function stubProvider(failures: number, name: string): LLMProvider & { calls: number } {
  return {
    vendor: 'openrouter' as LlmVendor,
    model: name,
    calls: 0,
    isConfigured: () => true,
    async generateJson(_request: LlmRequest): Promise<LlmResult> {
      this.calls += 1
      if (this.calls <= failures) {
        return { ok: false, code: 'unavailable', detail: 'down' }
      }
      return { ok: true, json: { from: name }, vendor: 'openrouter', model: name }
    },
  }
}

describe('LlmWaterfall', () => {
  it('uses the local model when it works, and never touches the hosted one', async () => {
    const local = stubProvider(0, 'local')
    const hosted = stubProvider(0, 'hosted')

    const result = await new LlmWaterfall(local, hosted).generateJson({ system: 's', user: 'u', schema: {} })

    expect(result.ok && result.json).toEqual({ from: 'local' })
    expect(hosted.calls).toBe(0)
  })

  it('RETRIES the local model once — a cold load often fails then succeeds', async () => {
    const local = stubProvider(1, 'local')
    const hosted = stubProvider(0, 'hosted')

    const result = await new LlmWaterfall(local, hosted).generateJson({ system: 's', user: 'u', schema: {} })

    expect(local.calls).toBe(2)
    expect(result.ok && result.json).toEqual({ from: 'local' })
    expect(hosted.calls).toBe(0)
  })

  it('falls back to hosted when local fails twice', async () => {
    /*
     * ⚠️ NOT A DETAIL. Local inference dies for ordinary reasons — a restart,
     * an OOM kill. Without this, each one turns a question that already cost
     * 40 seconds of web fetching into no answer at all.
     */
    const local = stubProvider(99, 'local')
    const hosted = stubProvider(0, 'hosted')

    const result = await new LlmWaterfall(local, hosted).generateJson({ system: 's', user: 'u', schema: {} })

    expect(local.calls).toBe(2)
    expect(result.ok && result.json).toEqual({ from: 'hosted' })
  })

  it('returns the local failure when there is no hosted fallback configured', async () => {
    const local = stubProvider(99, 'local')
    const hosted = { ...stubProvider(0, 'hosted'), isConfigured: () => false }

    const result = await new LlmWaterfall(local, hosted).generateJson({ system: 's', user: 'u', schema: {} })
    expect(result.ok).toBe(false)
  })
})

describe('siteScopedQuery', () => {
  it('scopes the question to the company own site', () => {
    expect(siteScopedQuery('What does their pricing look like?', 'acme.com')).toBe(
      'site:acme.com what does their pricing look like',
    )
  })

  it('drops short words that carry no search signal', () => {
    expect(siteScopedQuery('who is the CEO', 'acme.com')).toBe('site:acme.com')
  })
})

describe('learnDomainFromSources — the gating logic', () => {
  it('requires BOTH a name match and a real host', async () => {
    /*
     * ⚠️ Being cited is better evidence of ownership than ranking first in a
     * search: the page was retrieved, its content answered a question about
     * this company, AND the host matches the name. Either alone is not enough
     * — a cited page on a non-matching host is just a good source.
     */
    const { looksLikeOwnDomain } = await import('@/lib/hubble/source-quality')

    // Cited AND matching → the company's own site.
    expect(looksLikeOwnDomain('atlasai.co', 'Atlas AI Solutions')).toBe(true)

    // Cited but NOT matching → a good source, not their website.
    expect(looksLikeOwnDomain('cloud.google.com', 'Atlas AI Solutions')).toBe(false)
    expect(looksLikeOwnDomain('en.wikipedia.org', 'Atlas AI Solutions')).toBe(false)
  })

  it('does nothing without a company, a name, or any sources', async () => {
    const { learnDomainFromSources } = await import('@/lib/hubble/domain')

    await expect(learnDomainFromSources('u', null, 'Acme Corp', ['https://acme.com'])).resolves.toBeNull()
    await expect(learnDomainFromSources('u', 'c', null, ['https://acme.com'])).resolves.toBeNull()
    await expect(learnDomainFromSources('u', 'c', 'Acme Corp', [])).resolves.toBeNull()
  })
})

describe('the waterfall consults isUsable, not just isConfigured', () => {
  it('SKIPS a named-but-unpulled local model entirely', async () => {
    /*
     * ⚠️ Setting OLLAMA_LLM_MODEL to a model that has not finished downloading
     * makes isConfigured() true while every call 404s. Without this check the
     * waterfall burns TWO failed local calls before falling back, on every
     * single question — pure latency, invisible in the result.
     */
    const local = {
      ...stubProvider(99, 'local'),
      isUsable: async () => false,
    }
    const hosted = stubProvider(0, 'hosted')

    const result = await new LlmWaterfall(local, hosted).generateJson({ system: 's', user: 'u', schema: {} })

    expect(local.calls).toBe(0)
    expect(result.ok && result.json).toEqual({ from: 'hosted' })
  })

  it('uses the local model once it reports usable', async () => {
    const local = { ...stubProvider(0, 'local'), isUsable: async () => true }
    const hosted = stubProvider(0, 'hosted')

    const result = await new LlmWaterfall(local, hosted).generateJson({ system: 's', user: 'u', schema: {} })

    expect(result.ok && result.json).toEqual({ from: 'local' })
    expect(hosted.calls).toBe(0)
  })
})
