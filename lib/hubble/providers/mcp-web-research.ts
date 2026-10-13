import 'server-only'

/**
 * Where the operator's web-research MCP lives, and how to authenticate to it.
 *
 * The MCP is reached by the lead-research client
 * (`lib/intelligence/providers/mcp-research.ts`). Its SEARCH tool is no longer
 * an engine in the SERP waterfall (removed 2026-10-12): it wrapped SearXNG,
 * ran only on localhost, and was a dead slot on every production query.
 */
import { createHmac } from 'node:crypto'

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
