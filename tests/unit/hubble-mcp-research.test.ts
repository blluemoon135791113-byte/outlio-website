import { afterEach, describe, expect, it, vi } from 'vitest'

import { mapMcpFact, normalizeMcpResearch } from '@/lib/intelligence/mcp-research'
import {
  McpLeadResearchClient,
  type McpLeadResearchResult,
} from '@/lib/intelligence/providers/mcp-research'

const previousUrl = process.env.WEB_RESEARCH_MCP_URL
const previousToken = process.env.WEB_RESEARCH_MCP_TOKEN

afterEach(() => {
  vi.restoreAllMocks()
  if (previousUrl === undefined) delete process.env.WEB_RESEARCH_MCP_URL
  else process.env.WEB_RESEARCH_MCP_URL = previousUrl
  if (previousToken === undefined) delete process.env.WEB_RESEARCH_MCP_TOKEN
  else process.env.WEB_RESEARCH_MCP_TOKEN = previousToken
})

const result: McpLeadResearchResult = {
  person: {},
  company: {},
  signals: {},
  facts: [{
    field: 'person.emails',
    value: 'alex@example.com',
    source_url: 'https://example.com/team',
    source_title: 'Team',
    published_date: null,
    confidence: 0.86,
    contact_status: 'publicly_found',
  }, {
    field: 'company.industry',
    value: 'B2B software',
    source_url: 'https://example.com/about',
    source_title: 'About',
    published_date: null,
    confidence: 0.9,
  }],
  sources: [],
  documents: [{
    url: 'https://example.com/about',
    title: 'About',
    description: '',
    headings: ['About Example'],
    text: 'Example builds B2B software.',
    signals: { emails: [], phones: [], urls: [], dates: [], currencies: [], social_links: [] },
    relevance: 0.9,
    source_quality: 0.9,
  }],
  meta: {},
}

describe('McpLeadResearchClient', () => {
  it('calls the stateless tool with hard no-charge limits', async () => {
    process.env.WEB_RESEARCH_MCP_URL = 'https://research.example.com/mcp'
    process.env.WEB_RESEARCH_MCP_TOKEN = 'secret'
    const caller = vi.fn(async () => ({ status: 'completed', result }))
    const client = new McpLeadResearchClient(caller)

    const attempt = await client.research({
      name: 'Alex Doe',
      jobTitle: 'VP Sales',
      company: 'Example',
      companyDomain: 'example.com',
      linkedinUrl: null,
    }, ['work_email', 'industry'])

    expect(attempt).toMatchObject({ ok: true })
    expect(caller).toHaveBeenCalledWith(expect.objectContaining({
      arguments: expect.objectContaining({
        requested_fields: ['work_email', 'industry'],
        limits: {
          max_queries: 4,
          results_per_query: 5,
          max_urls: 10,
          max_gemini_calls: 2,
        },
      }),
    }))
  })

  it('rejects malformed MCP output without exposing it', async () => {
    process.env.WEB_RESEARCH_MCP_URL = 'https://research.example.com/mcp'
    process.env.WEB_RESEARCH_MCP_TOKEN = 'secret'
    const client = new McpLeadResearchClient(async () => ({ status: 'completed', result: 'bad' }))
    await expect(client.research({
      name: 'Alex Doe',
      jobTitle: null,
      company: 'Example',
      companyDomain: null,
      linkedinUrl: null,
    }, ['industry'])).resolves.toMatchObject({ ok: false, reason: 'invalid_response' })
  })
})

describe('MCP evidence normalization', () => {
  it('maps contacts and company facts to typed, sourced evidence', () => {
    const evidence = normalizeMcpResearch(result, {
      company: {
        type: 'company',
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Example',
        domain: 'example.com',
        linkedinUrl: null,
      },
      person: {
        type: 'person',
        id: '22222222-2222-4222-8222-222222222222',
        fullName: 'Alex Doe',
        linkedinUrl: null,
        location: null,
        jobTitle: 'VP Sales',
        companyName: 'Example',
        companyDomain: 'example.com',
        companyId: '11111111-1111-4111-8111-111111111111',
      },
    }, new Date('2026-08-27T00:00:00.000Z'))

    expect(evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'work_email',
        value: expect.objectContaining({ email: 'alex@example.com' }),
        sourceProvider: 'web-research-mcp',
        sourceConfidence: 'high',
      }),
      expect.objectContaining({
        field: 'email_status',
        value: expect.objectContaining({ status: 'publicly_found' }),
      }),
      expect.objectContaining({
        field: 'industry',
        entityType: 'company',
        value: expect.objectContaining({ industry: 'B2B software' }),
      }),
    ]))
  })

  it('drops model fields outside Hubble vocabulary', () => {
    expect(mapMcpFact('person.favorite_color', 'blue')).toEqual([])
  })
})

