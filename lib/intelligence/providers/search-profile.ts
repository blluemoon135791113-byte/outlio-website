import 'server-only'

/**
 * Free, source-backed company classification from the operator's SearXNG.
 * This deliberately handles only business model: a snippet must state the
 * classification, and absence remains unknown rather than becoming a guess.
 */
import { hasWebSearch, serpSearch } from '@/lib/search'
import { normalizeCompanyName } from '@/lib/companies/normalize'
import { expiresAtFor } from '@/lib/intelligence/ttl'
import type {
  CompanyEntity,
  IntelligenceProvider,
  NormalizedEvidence,
  ResearchTask,
} from '@/lib/intelligence/types'

type SearchProfileFinding = {
  models: string[]
  description: string | null
  industry: string | null
  sourceUrl: string
  sourceTitle: string
} | null

const MODEL_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'SaaS', pattern: /\b(?:saas|software[- ]as[- ]a[- ]service)\b/i },
  { label: 'B2B', pattern: /\bb2b\b|business[- ]to[- ]business/i },
  { label: 'B2C', pattern: /\bb2c\b|business[- ]to[- ]consumer/i },
  { label: 'Marketplace', pattern: /\bmarketplace\b/i },
  { label: 'Agency', pattern: /\b(?:agency|consultancy|consulting firm)\b/i },
  { label: 'E-commerce', pattern: /\be-?commerce\b/i },
  { label: 'Subscription', pattern: /\bsubscription(?:-based)?\b/i },
]

const INDUSTRY_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'Cybersecurity', pattern: /\b(?:cybersecurity|information security)\b/i },
  { label: 'Software', pattern: /\b(?:software|saas|cloud platform)\b/i },
  { label: 'Financial Services', pattern: /\b(?:fintech|financial services|banking|payments?)\b/i },
  { label: 'Healthcare', pattern: /\b(?:healthcare|health tech|medical|clinical)\b/i },
  { label: 'E-commerce', pattern: /\be-?commerce\b/i },
  { label: 'Marketing and Advertising', pattern: /\b(?:marketing|advertising|adtech)\b/i },
  { label: 'Education', pattern: /\b(?:education|edtech|learning platform)\b/i },
  { label: 'Professional Services', pattern: /\b(?:consulting|consultancy|professional services)\b/i },
]

function resultMatchesCompany(
  company: CompanyEntity,
  result: { url: string; title: string | null; snippet: string | null },
): boolean {
  if (company.domain) {
    try {
      const host = new URL(result.url).hostname.replace(/^www\./, '')
      const domain = company.domain.replace(/^www\./, '')
      if (host === domain || host.endsWith(`.${domain}`)) return true
    } catch {
      // Fall through to the name check for malformed third-party URLs.
    }
  }

  const name = normalizeCompanyName(company.name)
  const text = normalizeCompanyName(`${result.title ?? ''} ${result.snippet ?? ''}`)
  return Boolean(name && text && (` ${text} `).includes(` ${name} `))
}

export function extractSearchProfile(
  company: CompanyEntity,
  results: readonly { url: string; title: string | null; snippet: string | null }[],
): SearchProfileFinding {
  for (const result of results) {
    if (!resultMatchesCompany(company, result)) continue
    const text = `${result.title ?? ''} ${result.snippet ?? ''}`
    const models = MODEL_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label)
    const industry = INDUSTRY_PATTERNS.find(({ pattern }) => pattern.test(text))?.label ?? null
    const description = result.snippet?.trim() || null
    if (models.length > 0 || industry || description) {
      return {
        models: [...new Set(models)],
        description,
        industry,
        sourceUrl: result.url,
        sourceTitle: result.title ?? '',
      }
    }
  }
  return null
}

export function extractBusinessModel(
  company: CompanyEntity,
  results: readonly { url: string; title: string | null; snippet: string | null }[],
): SearchProfileFinding {
  const finding = extractSearchProfile(company, results)
  return finding?.models.length ? finding : null
}

function query(task: ResearchTask): string {
  const company = task.entity as CompanyEntity
  const name = company.name ? `"${company.name.replace(/"/g, '')}"` : company.domain ?? ''
  const terms: string[] = []
  if (task.fields.includes('business_model')) terms.push('SaaS B2B marketplace business model')
  if (task.fields.includes('industry')) terms.push('industry company')
  if (task.fields.includes('company_description')) terms.push('about company')
  return `${name} ${terms.join(' ')}`
}

export const searchCompanyProfileProvider: IntelligenceProvider<SearchProfileFinding> = {
  name: 'search-company-profile',
  category: 'company_profile',

  canHandle: (task) =>
    task.entity.type === 'company' &&
    task.fields.some((field) => ['business_model', 'company_description', 'industry'].includes(field)) &&
    Boolean((task.entity as CompanyEntity).name ?? (task.entity as CompanyEntity).domain) &&
    hasWebSearch(),

  estimateCost: async () => 0,
  execute: async (task) => extractSearchProfile(task.entity as CompanyEntity, await serpSearch(query(task), { limit: 8 })),
  normalize: (finding, task): NormalizedEvidence[] => {
    if (!finding) return []
    const retrievedAt = new Date()
    const base = {
      entityType: 'company' as const,
      entityId: task.entity.id,
      sourceProvider: 'search-company-profile',
      sourceUrl: finding.sourceUrl,
      sourceConfidence: 'medium' as const,
      retrievedAt: retrievedAt.toISOString(),
    }
    const evidence: NormalizedEvidence[] = []
    const push = (field: 'business_model' | 'company_description' | 'industry', value: Record<string, unknown>, confidence: number) => {
      if (!task.fields.includes(field)) return
      evidence.push({
        ...base,
        field,
        value,
        confidence,
        expiresAt: expiresAtFor(field, retrievedAt)?.toISOString() ?? null,
      })
    }

    if (finding.models.length > 0) {
      push('business_model', {
        model: finding.models.join(' + '),
        models: finding.models,
        sourceTitle: finding.sourceTitle,
      }, 0.65)
    }
    if (finding.description) {
      push('company_description', {
        description: finding.description,
        sourceTitle: finding.sourceTitle,
      }, 0.6)
    }
    if (finding.industry) {
      push('industry', { industry: finding.industry, sourceTitle: finding.sourceTitle }, 0.6)
    }

    return evidence
  },
}
