import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  McpWebResearchSearchProvider,
  webResearchMcpConfig,
} from '@/lib/hubble/providers/mcp-web-research'

const previousUrl = process.env.WEB_RESEARCH_MCP_URL
const previousToken = process.env.WEB_RESEARCH_MCP_TOKEN
const previousSupabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

afterEach(() => {
  vi.restoreAllMocks()
  if (previousUrl === undefined) delete process.env.WEB_RESEARCH_MCP_URL
  else process.env.WEB_RESEARCH_MCP_URL = previousUrl
  if (previousToken === undefined) delete process.env.WEB_RESEARCH_MCP_TOKEN
  else process.env.WEB_RESEARCH_MCP_TOKEN = previousToken
  if (previousSupabaseServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
  else process.env.SUPABASE_SERVICE_ROLE_KEY = previousSupabaseServiceKey
})

describe('McpWebResearchSearchProvider', () => {
  it('requires HTTPS and auth for a remote endpoint', () => {
    process.env.WEB_RESEARCH_MCP_URL = 'http://research.example.com/mcp'
    process.env.WEB_RESEARCH_MCP_TOKEN = 'secret'
    expect(webResearchMcpConfig()).toBeNull()

    process.env.WEB_RESEARCH_MCP_URL = 'https://research.example.com/mcp'
    delete process.env.WEB_RESEARCH_MCP_TOKEN
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(webResearchMcpConfig()).toBeNull()

    process.env.WEB_RESEARCH_MCP_TOKEN = 'secret'
    expect(webResearchMcpConfig()?.url.toString()).toBe('https://research.example.com/mcp')
  })

  it('derives an isolated MCP token from the server-only Supabase key', () => {
    process.env.WEB_RESEARCH_MCP_URL = 'https://research.example.com/mcp'
    delete process.env.WEB_RESEARCH_MCP_TOKEN
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret'
    const config = webResearchMcpConfig()
    expect(config?.token).toMatch(/^[a-f0-9]{64}$/)
    expect(config?.token).not.toBe(process.env.SUPABASE_SERVICE_ROLE_KEY)
  })

  it('allows unauthenticated loopback development', () => {
    process.env.WEB_RESEARCH_MCP_URL = 'http://127.0.0.1:8787/mcp'
    delete process.env.WEB_RESEARCH_MCP_TOKEN
    expect(new McpWebResearchSearchProvider().isConfigured()).toBe(true)
  })

  it('maps structured MCP search output into Hubble hits', async () => {
    process.env.WEB_RESEARCH_MCP_URL = 'https://research.example.com/mcp'
    process.env.WEB_RESEARCH_MCP_TOKEN = 'secret'
    const caller = vi.fn(async () => ({
      provider: 'duckduckgo-html',
      results: [{
        query: 'Example funding',
        title: 'Example raises funding',
        url: 'https://news.example.org/example-funding',
        snippet: 'Public result snippet',
        rank: 1,
      }],
    }))

    const provider = new McpWebResearchSearchProvider(caller)
    await expect(provider.search('Example funding', 5)).resolves.toEqual([{
      url: 'https://news.example.org/example-funding',
      title: 'Example raises funding',
      snippet: 'Public result snippet',
      publishedDate: null,
    }])
    expect(caller).toHaveBeenCalledWith(expect.objectContaining({
      query: 'Example funding',
      limit: 5,
      token: 'secret',
    }))
  })

  it('degrades to no hits when the MCP is unavailable or malformed', async () => {
    process.env.WEB_RESEARCH_MCP_URL = 'https://research.example.com/mcp'
    process.env.WEB_RESEARCH_MCP_TOKEN = 'secret'
    const broken = new McpWebResearchSearchProvider(async () => ({ results: 'not-an-array' }))
    await expect(broken.search('Example', 5)).resolves.toEqual([])
  })
})
