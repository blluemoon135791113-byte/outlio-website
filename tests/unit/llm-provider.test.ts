import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createFallbackLlmProvider,
  createCerebrasProvider,
  createGeminiProvider,
  extractGeminiText,
  createOpenRouterProvider,
  DEFAULT_CEREBRAS_MODEL,
  DEFAULT_GEMINI_MODEL,
  resetLlmCircuitBreaker,
  resolveLlmProvider,
  type LLMProvider,
  type LlmResult,
  type LlmVendor,
} from '@/lib/intelligence/llm/provider'

const originalGeminiModel = process.env.GEMINI_MODEL
const originalAllowedVendors = process.env.LLM_ALLOWED_VENDORS
const originalGeminiKey = process.env.GEMINI_API_KEY
const originalOpenRouterKey = process.env.OPENROUTER_API_KEY

afterEach(() => {
  vi.restoreAllMocks()
  resetLlmCircuitBreaker()
  if (originalGeminiModel === undefined) delete process.env.GEMINI_MODEL
  else process.env.GEMINI_MODEL = originalGeminiModel
  if (originalAllowedVendors === undefined) delete process.env.LLM_ALLOWED_VENDORS
  else process.env.LLM_ALLOWED_VENDORS = originalAllowedVendors
  if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY
  else process.env.GEMINI_API_KEY = originalGeminiKey
  if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = originalOpenRouterKey
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

  it('ignores thought parts and reads the complete structured answer', () => {
    expect(
      extractGeminiText([
        { thought: true, text: 'I should return JSON.' },
        { text: '{"ok":' },
        { text: 'true}' },
      ]),
    ).toBe('{"ok":true}')
  })

  it('sends JSON Schema through the current GenerateContent field', async () => {
    const previous = process.env.GEMINI_API_KEY
    process.env.GEMINI_API_KEY = 'test-key'
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await createGeminiProvider().generateJson({
      ...request,
      schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
    })
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))

    expect(result.ok).toBe(true)
    expect(body.generationConfig.responseJsonSchema).toBeDefined()
    expect(body.generationConfig.responseSchema).toBeUndefined()
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'MINIMAL' })

    if (previous === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = previous
  })
})

describe('LLM vendor allowlist', () => {
  it('fails closed to Gemini instead of falling through to paid vendors', () => {
    process.env.LLM_ALLOWED_VENDORS = 'gemini'
    process.env.GEMINI_API_KEY = 'test-key'
    process.env.OPENROUTER_API_KEY = 'test-key'

    const provider = resolveLlmProvider('openrouter')

    expect(provider.vendor).toBe('gemini')
  })
})

describe('Cerebras provider', () => {
  it('uses a model that exists on the current public endpoint', () => {
    const previous = process.env.CEREBRAS_MODEL
    delete process.env.CEREBRAS_MODEL

    expect(DEFAULT_CEREBRAS_MODEL).toBe('gpt-oss-120b')
    expect(createCerebrasProvider().model).toBe(DEFAULT_CEREBRAS_MODEL)

    if (previous === undefined) delete process.env.CEREBRAS_MODEL
    else process.env.CEREBRAS_MODEL = previous
  })
})

describe('OpenRouter structured output', () => {
  it('uses strict decoding only when the caller schema can preserve its meaning', async () => {
    const previous = process.env.OPENROUTER_API_KEY
    process.env.OPENROUTER_API_KEY = 'test-key'
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ choices: [{ message: { content: '{"ok":true}' } }] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const provider = createOpenRouterProvider()
    await provider.generateJson({
      ...request,
      schema: {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
        required: ['ok'],
      },
    })
    await provider.generateJson({
      ...request,
      schema: {
        type: 'object',
        properties: { filters: { type: 'object' } },
        required: ['filters'],
      },
    })

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))
    expect(firstBody.response_format.json_schema).toMatchObject({
      strict: true,
      schema: { additionalProperties: false },
    })
    expect(secondBody.response_format.json_schema.strict).toBe(false)
    expect(secondBody.response_format.json_schema.schema.properties.filters)
      .not.toHaveProperty('additionalProperties')

    if (previous === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = previous
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

  it('routes past a malformed completion instead of pinning the request to it', async () => {
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

    expect(result.ok).toBe(true)
    expect(geminiCall).toHaveBeenCalledTimes(1)
    expect(groqCall).toHaveBeenCalledTimes(1)
  })

  it('routes past valid JSON that fails the caller domain schema', async () => {
    const wrongShape = vi.fn(async (): Promise<LlmResult> => ({
      ok: true,
      json: { requiredFields: 'funding_amount' },
      vendor: 'openrouter',
      model: 'openrouter-stub',
    }))
    const validShape = vi.fn(async (): Promise<LlmResult> => ({
      ok: true,
      json: { requiredFields: ['funding_amount'] },
      vendor: 'groq',
      model: 'groq-stub',
    }))
    const provider = createFallbackLlmProvider([
      stubProvider({ vendor: 'openrouter', generate: wrongShape }),
      stubProvider({ vendor: 'groq', generate: validShape }),
    ])

    const result = await provider.generateJson({
      ...request,
      validate: (value) =>
        Boolean(
          value &&
          typeof value === 'object' &&
          Array.isArray((value as { requiredFields?: unknown }).requiredFields),
        ),
    })

    expect(result.ok).toBe(true)
    expect(wrongShape).toHaveBeenCalledTimes(1)
    expect(validShape).toHaveBeenCalledTimes(1)
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

  it('cools down an unavailable provider across Hubble model calls', async () => {
    const deadCall = vi.fn(async (): Promise<LlmResult> => ({
      ok: false,
      code: 'unavailable',
      detail: 'retired model',
    }))
    const liveCall = vi.fn(async (): Promise<LlmResult> => ({
      ok: true,
      json: {},
      vendor: 'groq',
      model: 'groq-stub',
    }))
    const provider = createFallbackLlmProvider([
      stubProvider({ vendor: 'cerebras', generate: deadCall }),
      stubProvider({ vendor: 'groq', generate: liveCall }),
    ])

    await provider.generateJson(request)
    await provider.generateJson(request)

    expect(deadCall).toHaveBeenCalledTimes(1)
    expect(liveCall).toHaveBeenCalledTimes(2)
  })
})
