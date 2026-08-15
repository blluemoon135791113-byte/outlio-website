import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createFallbackLlmProvider,
  createGeminiProvider,
  DEFAULT_GEMINI_MODEL,
  type LLMProvider,
  type LlmResult,
  type LlmVendor,
} from '@/lib/intelligence/llm/provider'

const originalGeminiModel = process.env.GEMINI_MODEL

afterEach(() => {
  vi.restoreAllMocks()
  if (originalGeminiModel === undefined) delete process.env.GEMINI_MODEL
  else process.env.GEMINI_MODEL = originalGeminiModel
})

function stubProvider(options: {
  vendor: LlmVendor
  configured?: boolean
  result?: LlmResult
  generate?: LLMProvider['generateJson']
}): LLMProvider {
  const generate = options.generate ?? vi.fn(async () => options.result!)

  return {
    vendor: options.vendor,
    model: `${options.vendor}-stub`,
    isConfigured: () => options.configured ?? true,
    generateJson: generate,
  }
}

const request = {
  system: 'Return JSON.',
  user: 'Plan this.',
  schema: { type: 'object' },
}

describe('Gemini planner provider', () => {
  it('uses the current pinned Flash model when no override is configured', () => {
    delete process.env.GEMINI_MODEL

    expect(DEFAULT_GEMINI_MODEL).toBe('gemini-3.6-flash')
    expect(createGeminiProvider().model).toBe(DEFAULT_GEMINI_MODEL)
  })

  it('keeps the server-side model override', () => {
    process.env.GEMINI_MODEL = 'gemini-custom-model'

    expect(createGeminiProvider().model).toBe('gemini-custom-model')
  })
})

describe('LLM runtime fallback', () => {
  it('uses the alternative provider when the preferred vendor is unavailable', async () => {
    const geminiCall = vi.fn(async (): Promise<LlmResult> => ({
      ok: false,
      code: 'unavailable',
      detail: 'ERR_PROVIDER_REJECTED from provider',
    }))
    const groqCall = vi.fn(async (): Promise<LlmResult> => ({
      ok: true,
      json: { requiredFields: ['industry'], clarificationRequired: false },
      vendor: 'groq',
      model: 'groq-stub',
    }))
    const provider = createFallbackLlmProvider([
      stubProvider({ vendor: 'gemini', generate: geminiCall }),
      stubProvider({ vendor: 'groq', generate: groqCall }),
    ])

    const result = await provider.generateJson(request)

    expect(result.ok).toBe(true)
    expect(geminiCall).toHaveBeenCalledTimes(1)
    expect(groqCall).toHaveBeenCalledTimes(1)
    if (result.ok) expect(result.vendor).toBe('groq')
  })

  it('does not buy a fallback call for a correctable invalid completion', async () => {
    const geminiCall = vi.fn(async (): Promise<LlmResult> => ({
      ok: false,
      code: 'unparseable',
      detail: 'completion was not JSON',
    }))
    const groqCall = vi.fn(async (): Promise<LlmResult> => ({
      ok: true,
      json: {},
      vendor: 'groq',
      model: 'groq-stub',
    }))
    const provider = createFallbackLlmProvider([
      stubProvider({ vendor: 'gemini', generate: geminiCall }),
      stubProvider({ vendor: 'groq', generate: groqCall }),
    ])

    const result = await provider.generateJson(request)

    expect(result).toMatchObject({ ok: false, code: 'unparseable' })
    expect(geminiCall).toHaveBeenCalledTimes(1)
    expect(groqCall).not.toHaveBeenCalled()
  })

  it('skips providers with no key', async () => {
    const unavailableCall = vi.fn()
    const groqCall = vi.fn(async (): Promise<LlmResult> => ({
      ok: true,
      json: {},
      vendor: 'groq',
      model: 'groq-stub',
    }))
    const provider = createFallbackLlmProvider([
      stubProvider({
        vendor: 'gemini',
        configured: false,
        result: { ok: false, code: 'not_configured', detail: 'no key' },
        generate: unavailableCall,
      }),
      stubProvider({ vendor: 'groq', generate: groqCall }),
    ])

    await provider.generateJson(request)

    expect(unavailableCall).not.toHaveBeenCalled()
    expect(groqCall).toHaveBeenCalledTimes(1)
  })
})
