import 'server-only'

/**
 * Google PageSpeed Insights — tech detection through an official API.
 *
 * Lighthouse ships "stack packs": it recognises the CMS and framework a page
 * runs on (WordPress, Shopify, React, Angular, Magento, Drupal…) and reports
 * them in the response. That gives part of `tech_stack` from a sanctioned API
 * rather than from markup we scraped and guessed at.
 *
 * ⚠️ NARROW AND SLOW. It sees frameworks and CMSes, NOT the marketing and sales
 * tools an ICP question usually asks about — it will not tell you whether a
 * company uses HubSpot, Intercom, or Salesforce. Each call also renders the
 * page and takes 10–30 seconds, so this is a per-company lookup with a real
 * latency budget, not something to run across thousands of domains casually.
 *
 * ⚠️ REQUIRES A DOMAIN. Runs only after Wikidata or domain discovery has found
 * one.
 */
import { requestJson, setHostPacing } from '@/lib/intelligence/http'
import { expiresAtFor } from '@/lib/intelligence/ttl'
import type {
  CompanyEntity,
  IntelligenceProvider,
  NormalizedEvidence,
  ResearchTask,
} from '@/lib/intelligence/types'

const PAGESPEED_HOST = 'www.googleapis.com'
const PAGESPEED_URL = `https://${PAGESPEED_HOST}/pagespeedonline/v5/runPagespeed`

setHostPacing(PAGESPEED_HOST, 500)

/** Lighthouse renders the page; the default 12s client timeout is far too short. */
const PAGESPEED_TIMEOUT_MS = 60_000

type PageSpeedResponse = {
  lighthouseResult?: {
    finalUrl?: string
    requestedUrl?: string
    stackPacks?: Array<{ id?: string; title?: string }>
  }
}

export type DetectedTechnology = {
  /** Stable key, e.g. `wordpress`. */
  id: string
  /** Human-readable, e.g. `WordPress`. */
  name: string
  category: 'cms' | 'framework' | 'ecommerce' | 'other'
}

/** Stack-pack ids Lighthouse emits, mapped to a category we can filter on. */
const CATEGORIES: Record<string, DetectedTechnology['category']> = {
  wordpress: 'cms',
  drupal: 'cms',
  joomla: 'cms',
  wix: 'cms',
  squarespace: 'cms',
  october: 'cms',
  ezoic: 'other',
  amp: 'framework',
  react: 'framework',
  angular: 'framework',
  vue: 'framework',
  next: 'framework',
  nuxt: 'framework',
  gatsby: 'framework',
  svelte: 'framework',
  magento: 'ecommerce',
  shopify: 'ecommerce',
  woocommerce: 'ecommerce',
  prestashop: 'ecommerce',
  bigcommerce: 'ecommerce',
}

/**
 * Reads detected technologies out of a Lighthouse result.
 *
 * PURE, so parsing is tested against a recorded response. An unrecognised stack
 * pack is kept as `other` rather than dropped — a technology we have not
 * categorised is still a fact worth recording.
 */
export function extractTechnologies(response: PageSpeedResponse): DetectedTechnology[] {
  const packs = response.lighthouseResult?.stackPacks ?? []

  const technologies = new Map<string, DetectedTechnology>()
  for (const pack of packs) {
    const id = pack.id?.trim().toLowerCase()
    if (!id) continue
    technologies.set(id, {
      id,
      name: pack.title?.trim() || id,
      category: CATEGORIES[id] ?? 'other',
    })
  }

  return [...technologies.values()]
}

export function hasPageSpeedCredentials(): boolean {
  return Boolean(process.env.PAGESPEED_API_KEY)
}

export const pageSpeedTechProvider: IntelligenceProvider<{
  technologies: DetectedTechnology[]
  finalUrl: string
}> = {
  name: 'pagespeed-tech',
  category: 'tech_stack',

  canHandle: (task) =>
    task.entity.type === 'company' &&
    Boolean((task.entity as CompanyEntity).domain) &&
    hasPageSpeedCredentials(),

  // Free tier, but not free of time. Priced at zero because no money changes
  // hands; the real cost here is latency, which the runner budgets separately.
  estimateCost: async () => 0,

  execute: async (task: ResearchTask) => {
    const company = task.entity as CompanyEntity
    const target = `https://${company.domain}`

    const params = new URLSearchParams({
      url: target,
      key: process.env.PAGESPEED_API_KEY ?? '',
      strategy: 'mobile',
      category: 'performance',
    })

    const response = await requestJson<PageSpeedResponse>({
      url: `${PAGESPEED_URL}?${params.toString()}`,
      timeoutMs: PAGESPEED_TIMEOUT_MS,
    })

    return {
      technologies: extractTechnologies(response),
      finalUrl: response.lighthouseResult?.finalUrl ?? target,
    }
  },

  normalize: (output, task): NormalizedEvidence[] => {
    // Nothing detected is NOT "no technology". Lighthouse recognises a narrow
    // set, so silence means unknown and must produce no evidence at all.
    if (output.technologies.length === 0) return []

    const retrievedAt = new Date()

    return [
      {
        field: 'tech_stack',
        entityType: 'company',
        entityId: task.entity.id,
        value: {
          detected: output.technologies,
          // Named so a consumer cannot mistake this for a full stack scan.
          coverage: 'cms_and_framework_only',
          scannedUrl: output.finalUrl,
        },
        sourceProvider: 'pagespeed-tech',
        sourceUrl: output.finalUrl,
        // The company's own live page, read by Google's renderer: as close to
        // an official observation as tech detection gets.
        sourceConfidence: 'high',
        confidence: 0.85,
        retrievedAt: retrievedAt.toISOString(),
        expiresAt: expiresAtFor('tech_stack', retrievedAt)?.toISOString() ?? null,
      },
    ]
  },
}
