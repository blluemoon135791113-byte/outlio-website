import 'server-only'

import { expiresAtFor } from '@/lib/intelligence/ttl'
import { chunkText } from '@/lib/hubble/retrieve'
import { savePage } from '@/lib/hubble/store'
import type { McpLeadResearchResult } from '@/lib/intelligence/providers/mcp-research'
import type {
  CompanyEntity,
  NormalizedEvidence,
  PersonEntity,
  ResearchField,
  SourceConfidence,
} from '@/lib/intelligence/types'

type Subject = {
  company: CompanyEntity
  person?: PersonEntity
}

function asRecord(key: string, value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return { [key]: value }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value]
}

type FactMapping = Array<{
  field: ResearchField
  entityType: 'company' | 'person'
  value: Record<string, unknown>
}>

/**
 * MCP semantic fields → Hubble's typed evidence vocabulary.
 * Unknown model fields are dropped; a model cannot invent a database field.
 */
export function mapMcpFact(
  field: string,
  value: unknown,
  contactStatus?: 'verified' | 'publicly_found' | 'inferred' | 'not_found',
): FactMapping {
  switch (field) {
    case 'person.emails': {
      const status = contactStatus ?? 'publicly_found'
      return [
        { field: 'work_email', entityType: 'person', value: { email: value } },
        { field: 'email_status', entityType: 'person', value: { status } },
      ]
    }
    case 'person.phones': {
      const status = contactStatus ?? 'publicly_found'
      return [
        { field: 'mobile_phone', entityType: 'person', value: { phone: value } },
        { field: 'phone_status', entityType: 'person', value: { status } },
      ]
    }
    case 'person.social_profiles':
      return [{
        field: 'person_social_profiles',
        entityType: 'person',
        value: { profiles: asArray(value) },
      }]
    case 'company.domain':
      return [{ field: 'company_domain', entityType: 'company', value: asRecord('domain', value) }]
    case 'company.industry':
      return [{ field: 'industry', entityType: 'company', value: asRecord('industry', value) }]
    case 'company.employee_count':
      return [{ field: 'employee_count', entityType: 'company', value: asRecord('count', value) }]
    case 'company.revenue':
    case 'company.estimated_revenue':
      return [{ field: 'revenue_estimate', entityType: 'company', value: asRecord('amount', value) }]
    case 'company.investors':
      return [{
        field: 'funding_investors',
        entityType: 'company',
        value: { investors: asArray(value) },
      }]
    case 'company.tech_stack':
    case 'company.technology':
      return [{
        field: 'tech_stack',
        entityType: 'company',
        value: { detected: asArray(value), coverage: 'public_web_evidence' },
      }]
    case 'company.competitors':
      return [{
        field: 'competitors',
        entityType: 'company',
        value: { competitors: asArray(value) },
      }]
    case 'signals.recent_news':
    case 'recent_news':
      return [{ field: 'recent_news', entityType: 'company', value: asRecord('items', value) }]
    case 'signals.hiring':
    case 'signals.hiring_signals':
    case 'hiring':
      return [{
        field: 'hiring_signals',
        entityType: 'company',
        value: { hiring: true, signals: asArray(value) },
      }]
    default:
      return []
  }
}

function normalizedHost(value: string | null): string | null {
  if (!value) return null
  try {
    const url = value.includes('://') ? new URL(value) : new URL(`https://${value}`)
    return url.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return value.toLowerCase().replace(/^www\./, '').replace(/\/$/, '')
  }
}

function sourceConfidence(
  url: string,
  companyDomain: string | null,
  sourceQuality: number,
): SourceConfidence {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    const official = normalizedHost(companyDomain)
    if (official && (host === official || host.endsWith(`.${official}`))) return 'high'
  } catch {
    // URL validity is enforced by the MCP response schema.
  }
  return sourceQuality >= 0.65 ? 'medium' : 'low'
}

function isOfficialSource(url: string, companyDomain: string | null): boolean {
  const official = normalizedHost(companyDomain)
  if (!official) return false
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    return host === official || host.endsWith(`.${official}`)
  } catch {
    return false
  }
}

export function normalizeMcpResearch(
  result: McpLeadResearchResult,
  subject: Subject,
  now: Date = new Date(),
): NormalizedEvidence[] {
  const qualityByUrl = new Map(result.documents.map((document) => [document.url, document.source_quality]))
  const output: NormalizedEvidence[] = []

  for (const fact of result.facts) {
    const mapped = mapMcpFact(fact.field, fact.value, fact.contact_status)
    const confidence = sourceConfidence(
      fact.source_url,
      subject.company.domain,
      qualityByUrl.get(fact.source_url) ?? 0.4,
    )

    for (const item of mapped) {
      const entityId = item.entityType === 'company' ? subject.company.id : subject.person?.id
      if (!entityId) continue

      output.push({
        field: item.field,
        entityType: item.entityType,
        entityId,
        value: {
          ...item.value,
          ...(fact.conflict_group ? { conflictGroup: fact.conflict_group } : {}),
          ...(fact.published_date ? { publishedDate: fact.published_date } : {}),
          sourceTitle: fact.source_title,
        },
        sourceProvider: 'web-research-mcp',
        sourceUrl: fact.source_url,
        sourceConfidence: confidence,
        confidence: fact.confidence,
        retrievedAt: now.toISOString(),
        expiresAt: expiresAtFor(item.field, now)?.toISOString() ?? null,
      })
    }
  }

  // The cleaned official page is itself deterministic website evidence even
  // when the semantic model is unavailable. This keeps the code-only fallback
  // useful and gives Hubble a sourced inventory of public contact/social data.
  for (const document of result.documents) {
    if (!isOfficialSource(document.url, subject.company.domain)) continue

    const common = {
      entityType: 'company' as const,
      entityId: subject.company.id,
      sourceProvider: 'web-research-mcp',
      sourceUrl: document.url,
      sourceConfidence: 'high' as const,
      retrievedAt: now.toISOString(),
    }
    output.push({
      ...common,
      field: 'website_signals',
      value: {
        title: document.title,
        description: document.description,
        headings: document.headings.slice(0, 20),
        publicEmails: document.signals.emails,
        publicPhones: document.signals.phones,
        socialLinks: document.signals.social_links,
        publishedDate: document.published_date ?? null,
      },
      confidence: Math.min(0.95, 0.7 + document.relevance * 0.25),
      expiresAt: expiresAtFor('website_signals', now)?.toISOString() ?? null,
    })

    if (document.signals.social_links.length > 0) {
      output.push({
        ...common,
        field: 'social_profiles',
        value: { profiles: document.signals.social_links },
        confidence: Math.min(0.95, 0.72 + document.relevance * 0.2),
        expiresAt: expiresAtFor('social_profiles', now)?.toISOString() ?? null,
      })
    }
  }

  return output
}

export async function persistMcpDocuments(
  userId: string,
  companyId: string,
  result: McpLeadResearchResult,
): Promise<{ pages: number; chunks: number }> {
  let pages = 0
  let chunks = 0

  for (const document of result.documents) {
    const content = [
      document.description,
      document.headings.join('\n'),
      document.text,
    ].filter(Boolean).join('\n\n').slice(0, 250_000)
    if (!content.trim()) continue

    const pageChunks = chunkText(content)
    const pageId = await savePage({
      userId,
      companyId,
      url: document.url,
      title: document.title || null,
      content,
      structured: {
        description: document.description,
        headings: document.headings,
        signals: document.signals,
        publishedDate: document.published_date ?? null,
        relevance: document.relevance,
        sourceQuality: document.source_quality,
        acquisition: 'web-research-mcp',
      },
      method: 'fetch',
      status: 200,
      chunks: pageChunks,
      embeddings: null,
      embedModel: null,
    })
    if (pageId) {
      pages += 1
      chunks += pageChunks.length
    }
  }

  return { pages, chunks }
}
