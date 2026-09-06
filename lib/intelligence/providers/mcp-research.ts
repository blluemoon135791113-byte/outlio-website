import 'server-only'

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { z } from 'zod'

import { webResearchMcpConfig } from '@/lib/hubble/providers/mcp-web-research'

const ContactStatusSchema = z.enum(['verified', 'publicly_found', 'inferred', 'not_found'])

const DirectSignalsSchema = z.object({
  emails: z.array(z.string()).max(200),
  phones: z.array(z.string()).max(200),
  urls: z.array(z.string()).max(500),
  dates: z.array(z.string()).max(200),
  currencies: z.array(z.string()).max(200),
  social_links: z.array(z.string()).max(200),
})

const McpFactSchema = z.object({
  field: z.string().min(1).max(128),
  value: z.unknown(),
  source_url: z.string().url(),
  source_title: z.string().max(500),
  published_date: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  contact_status: ContactStatusSchema.optional(),
  conflict_group: z.string().max(128).optional(),
})

const McpDocumentSchema = z.object({
  url: z.string().url(),
  title: z.string().max(500),
  description: z.string().max(5_000),
  headings: z.array(z.string().max(500)).max(100),
  text: z.string().max(250_000),
  signals: DirectSignalsSchema,
  published_date: z.string().optional(),
  relevance: z.number().min(0).max(1),
  source_quality: z.number().min(0).max(1),
})

export const McpLeadResearchResultSchema = z.object({
  person: z.record(z.string(), z.unknown()),
  company: z.record(z.string(), z.unknown()),
  signals: z.record(z.string(), z.unknown()),
  facts: z.array(McpFactSchema).max(500),
  sources: z.array(z.object({
    url: z.string().url(),
    title: z.string().max(500),
    relevance: z.number().min(0).max(1),
    published_date: z.string().optional(),
  })).max(100),
  documents: z.array(McpDocumentSchema).max(25),
  meta: z.record(z.string(), z.unknown()),
})

const McpResearchResponseSchema = z.object({
  status: z.literal('completed'),
  result: McpLeadResearchResultSchema,
})

export type McpLeadResearchResult = z.infer<typeof McpLeadResearchResultSchema>

export type McpResearchLead = {
  name: string
  jobTitle: string | null
  company: string
  companyDomain: string | null
  linkedinUrl: string | null
}

export type McpResearchAttempt =
  | { ok: true; result: McpLeadResearchResult; latencyMs: number }
  | {
      ok: false
      reason: 'not_configured' | 'deadline' | 'unavailable' | 'invalid_response'
      latencyMs: number
    }

type ToolCaller = (options: {
  url: URL
  token: string | null
  arguments: Record<string, unknown>
  deadlineAt?: number
}) => Promise<unknown>

async function callResearchTool(options: Parameters<ToolCaller>[0]): Promise<unknown> {
  const remaining = options.deadlineAt === undefined
    ? 90_000
    : Math.max(1, Math.min(120_000, options.deadlineAt - Date.now()))

  const transport = new StreamableHTTPClientTransport(options.url, {
    authProvider: options.token ? { token: async () => options.token! } : undefined,
    fetch: async (input, init) => {
      const timeout = AbortSignal.timeout(remaining)
      const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
      return fetch(input, { ...init, signal })
    },
    onInsufficientScope: 'throw',
  })
  const client = new Client({ name: 'outlio-intelligence', version: '1.0.0' })

  try {
    await client.connect(transport)
    const response = await client.callTool({
      name: 'research_lead',
      arguments: options.arguments,
    })
    if (response.isError) return null
    return response.structuredContent
  } finally {
    await client.close().catch(() => {})
  }
}

export class McpLeadResearchClient {
  constructor(private readonly caller: ToolCaller = callResearchTool) {}

  isConfigured(): boolean {
    return webResearchMcpConfig() !== null
  }

  async research(
    lead: McpResearchLead,
    requestedFields: readonly string[],
    deadlineAt?: number,
  ): Promise<McpResearchAttempt> {
    const startedAt = Date.now()
    const config = webResearchMcpConfig()
    if (!config) return { ok: false, reason: 'not_configured', latencyMs: 0 }
    if (deadlineAt !== undefined && deadlineAt <= Date.now()) {
      return { ok: false, reason: 'deadline', latencyMs: 0 }
    }

    const contactRequested = requestedFields.some((field) =>
      ['work_email', 'email_status', 'mobile_phone', 'phone_status', 'person_social_profiles'].includes(field),
    )

    try {
      const raw = await this.caller({
        ...config,
        deadlineAt,
        arguments: {
          lead: {
            name: lead.name.slice(0, 300),
            job_title: lead.jobTitle?.slice(0, 300) ?? '',
            company: lead.company.slice(0, 300),
            company_domain: lead.companyDomain?.slice(0, 253) ?? '',
            linkedin_url: lead.linkedinUrl?.slice(0, 2_048) ?? '',
          },
          requested_fields: [...new Set(requestedFields)].slice(0, 30),
          limits: {
            // Contact discovery benefits from several narrow searches and a
            // few official-site follow-ups. General research stays smaller.
            max_queries: contactRequested ? 8 : 4,
            results_per_query: contactRequested ? 6 : 5,
            max_urls: contactRequested ? 14 : 10,
            max_gemini_calls: 2,
          },
        },
      })
      if (!raw) {
        return { ok: false, reason: 'unavailable', latencyMs: Date.now() - startedAt }
      }

      const parsed = McpResearchResponseSchema.safeParse(raw)
      if (!parsed.success) {
        return { ok: false, reason: 'invalid_response', latencyMs: Date.now() - startedAt }
      }
      return { ok: true, result: parsed.data.result, latencyMs: Date.now() - startedAt }
    } catch {
      return { ok: false, reason: 'unavailable', latencyMs: Date.now() - startedAt }
    }
  }
}
