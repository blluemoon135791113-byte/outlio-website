import 'server-only'

/**
 * Hacker News — product launches and public discussion.
 *
 * Free, no key, no account: the Algolia-hosted search endpoint HN publishes for
 * exactly this. Answers "which of these companies launched something" and
 * "which have been discussed", which spec §14 lists under product activity.
 *
 * ⚠️ SEARCH IS FULL-TEXT, SO ATTRIBUTION IS THE HARD PART. A story merely
 * mentioning a company is not that company launching. Only titles where the
 * company name appears as a distinct term are kept, and Show HN / Launch HN
 * posts are marked separately from ordinary mentions — the two mean very
 * different things to a seller.
 */
import { normalizeCompanyName } from '@/lib/companies/normalize'
import { requestJson, setHostPacing } from '@/lib/intelligence/http'
import { expiresAtFor } from '@/lib/intelligence/ttl'
import type {
  CompanyEntity,
  IntelligenceProvider,
  NormalizedEvidence,
  ResearchTask,
} from '@/lib/intelligence/types'

const HN_HOST = 'hn.algolia.com'
const SEARCH_URL = `https://${HN_HOST}/api/v1/search`

// A free community service. Pace it politely.
setHostPacing(HN_HOST, 300)

type HnHit = {
  objectID?: string
  title?: string | null
  url?: string | null
  points?: number
  num_comments?: number
  created_at?: string
  _tags?: string[]
}

type HnResponse = { hits?: HnHit[] }

export type HnStory = {
  id: string
  title: string
  url: string
  points: number
  comments: number
  createdAt: string
  isLaunch: boolean
}

/** A launch announces the company; a mention merely names it. */
function looksLikeLaunch(title: string): boolean {
  return /^(show hn|launch hn)\b/i.test(title.trim())
}

/**
 * Keeps only stories that are genuinely about this company.
 *
 * PURE. The company name must appear as a WHOLE TERM in the title — a
 * substring test would attribute "Notional" to "Notion" and every story about
 * "Stripe Press" to Stripe.
 */
export function attributableStories(
  companyName: string | null,
  hits: readonly HnHit[],
): HnStory[] {
  const target = normalizeCompanyName(companyName)
  if (!target) return []

  const pattern = new RegExp(`(^|\\s)${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`)

  return hits
    .filter((hit) => hit.objectID && hit.title)
    .filter((hit) => pattern.test(normalizeCompanyName(hit.title!) ?? ''))
    .map((hit) => ({
      id: hit.objectID!,
      title: hit.title!.trim(),
      url: hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`,
      points: hit.points ?? 0,
      comments: hit.num_comments ?? 0,
      createdAt: hit.created_at ?? '',
      isLaunch: looksLikeLaunch(hit.title!),
    }))
    .sort((a, b) => Date.parse(b.createdAt || '0') - Date.parse(a.createdAt || '0'))
    .slice(0, 10)
}

export const hackerNewsProvider: IntelligenceProvider<HnStory[]> = {
  name: 'hackernews',
  category: 'product_activity',

  canHandle: (task: ResearchTask) =>
    task.entity.type === 'company' &&
    Boolean(task.entity.name) &&
    task.fields.includes('product_launches'),

  estimateCost: async () => 0,

  execute: async (task) => {
    const company = task.entity as CompanyEntity
    const params = new URLSearchParams({
      query: company.name ?? '',
      tags: 'story',
      hitsPerPage: '30',
    })

    const response = await requestJson<HnResponse>({ url: `${SEARCH_URL}?${params.toString()}` })
    return attributableStories(company.name, response.hits ?? [])
  },

  normalize: (stories, task): NormalizedEvidence[] => {
    if (stories.length === 0) return []

    const retrievedAt = new Date()
    const launches = stories.filter((story) => story.isLaunch)

    return [
      {
        field: 'product_launches',
        entityType: 'company',
        entityId: task.entity.id,
        value: {
          // Separated deliberately: "they launched on HN" and "someone
          // mentioned them" are different facts.
          launches: launches.map((story) => ({
            title: story.title,
            url: story.url,
            points: story.points,
            createdAt: story.createdAt,
          })),
          mentions: stories.length,
          topPoints: Math.max(...stories.map((story) => story.points)),
          mostRecent: stories[0]?.createdAt ?? null,
        },
        sourceProvider: 'hackernews',
        sourceUrl: stories[0]?.url ?? `https://hn.algolia.com/?q=${encodeURIComponent(task.entity.type === 'company' ? (task.entity.name ?? '') : '')}`,
        // A public post, attributed by title match rather than by an identifier.
        sourceConfidence: 'medium',
        confidence: launches.length > 0 ? 0.8 : 0.6,
        retrievedAt: retrievedAt.toISOString(),
        expiresAt: expiresAtFor('product_launches', retrievedAt)?.toISOString() ?? null,
      },
    ]
  },
}
