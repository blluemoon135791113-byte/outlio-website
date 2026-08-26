import 'server-only'

import { createHmac } from 'node:crypto'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { z } from 'zod'

import type { DeadlineOptions, SearchHit, SearchProvider } from '@/lib/hubble/providers/types'

const SearchResponseSchema = z.object({
  provider: z.string(),
  results: z.array(z.object({
    title: z.string(),
    url: z.string().url(),
    snippet: z.string(),
    rank: z.number().int().positive(),
  })),
})

type ToolCaller = (options: {
  url: URL
  token: string | null
  query: string
  limit: number
  deadlineAt?: number
}) => Promise<unknown>

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

export function webResearchMcpConfig(): { url: URL; token: string | null } | null {
  const raw = process.env.WEB_RESEARCH_MCP_URL?.trim()
  if (!raw) return null

  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) return null
    const explicitToken = process.env.WEB_RESEARCH_MCP_TOKEN?.trim()
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    const token = explicitToken || (supabaseServiceKey
      ? createHmac('sha256', supabaseServiceKey).update('outlio-web-research-mcp:v1').digest('hex')
      : null)
    if (!isLoopback(url.hostname) && !token) return null
    return { url, token }
  } catch {
    return null
  }
}

async function callTool(options: Parameters<ToolCaller>[0]): Promise<unknown> {
  const remaining = options.deadlineAt === undefined
    ? 12_000
    : Math.max(1, Math.min(12_000, options.deadlineAt - Date.now()))

  const transport = new StreamableHTTPClientTransport(options.url, {
    authProvider: options.token ? { token: async () => options.token! } : undefined,
    fetch: async (input, init) => {
      const timeout = AbortSignal.timeout(remaining)
      const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
      return fetch(input, { ...init, signal })
    },
    onInsufficientScope: 'throw',
  })
  const client = new Client({ name: 'outlio-hubble', version: '1.0.0' })

  try {
    await client.connect(transport)
    const response = await client.callTool({
      name: 'web_search',
      arguments: { query: options.query.slice(0, 400), limit: options.limit },
    })
    if (response.isError) return null
    return response.structuredContent
  } finally {
    await client.close().catch(() => {})
  }
}

export class McpWebResearchSearchProvider implements SearchProvider {
  readonly name = 'web-research-mcp'

  constructor(private readonly caller: ToolCaller = callTool) {}

  isConfigured(): boolean {
    return webResearchMcpConfig() !== null
  }

  async search(query: string, limit: number, options: DeadlineOptions = {}): Promise<SearchHit[]> {
    const config = webResearchMcpConfig()
    if (!config || (options.deadlineAt !== undefined && options.deadlineAt <= Date.now())) return []

    try {
      const raw = await this.caller({
        ...config,
        query,
        limit: Math.min(Math.max(limit, 1), 20),
        deadlineAt: options.deadlineAt,
      })
      const response = SearchResponseSchema.parse(raw)
      return response.results.slice(0, limit).map((result) => ({
        url: result.url,
        title: result.title || null,
        snippet: result.snippet || null,
        publishedDate: null,
      }))
    } catch {
      // A stopped MCP host or DuckDuckGo challenge is an ordinary waterfall
      // miss. Hubble moves to Google/Brave/Tavily rather than failing the ask.
      return []
    }
  }
}
