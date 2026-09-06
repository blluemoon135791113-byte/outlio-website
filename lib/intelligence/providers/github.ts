import 'server-only'

/**
 * GitHub — public technical presence.
 *
 * Free. The token raises the rate limit from 60 requests an hour to 5,000, but
 * a **fine-grained token with NO scopes** is sufficient because only public
 * data is read. Nothing here needs, or should have, write access.
 *
 * WHAT IT IS FOR: whether a company builds in the open, and how actively. For
 * anyone selling developer tools that is a qualification signal no firmographic
 * database carries.
 *
 * ⚠️ THE ORG-NAME TRAP. GitHub organisation logins are first-come-first-served
 * and frequently unrelated to the company that shares the name — `github.com/acme`
 * may be a hobby project. A match is accepted only when the organisation's own
 * profile corroborates it: a display name that normalizes to the company's, or
 * a blog URL on the company's own domain.
 */
import { normalizeCompanyName, normalizeDomain } from '@/lib/companies/normalize'
import { requestJson, setHostPacing, ProviderHttpError } from '@/lib/intelligence/http'
import { expiresAtFor } from '@/lib/intelligence/ttl'
import type {
  CompanyEntity,
  IntelligenceProvider,
  NormalizedEvidence,
  ResearchTask,
} from '@/lib/intelligence/types'

const GITHUB_HOST = 'api.github.com'
const BASE = `https://${GITHUB_HOST}`

setHostPacing(GITHUB_HOST, 250)

type GitHubOrg = {
  login?: string
  name?: string | null
  blog?: string | null
  public_repos?: number
  followers?: number
  created_at?: string
  html_url?: string
}

type GitHubRepo = {
  stargazers_count?: number
  language?: string | null
  pushed_at?: string
  fork?: boolean
}

export type GitHubPresence = {
  login: string
  url: string
  publicRepos: number
  followers: number
  totalStars: number
  languages: string[]
  lastPushedAt: string | null
}

/**
 * Whether an organisation profile actually belongs to this company.
 *
 * PURE. Requires corroboration beyond the login matching, because logins are
 * claimed by whoever registered first.
 */
export function orgBelongsToCompany(
  org: GitHubOrg,
  company: { name: string | null; domain: string | null },
): boolean {
  const target = normalizeCompanyName(company.name)

  // The display name is the company's name.
  if (target && normalizeCompanyName(org.name ?? '') === target) return true

  // Or the profile links back to the company's own domain.
  if (company.domain) {
    const blogDomain = normalizeDomain(org.blog ?? '')
    if (blogDomain && blogDomain === company.domain) return true
  }

  return false
}

/** Summarises repositories without keeping any of their content. */
export function summariseRepos(repos: readonly GitHubRepo[]): {
  totalStars: number
  languages: string[]
  lastPushedAt: string | null
} {
  // Forks are somebody else's work; counting their stars would overstate the
  // company's own output.
  const owned = repos.filter((repo) => repo.fork !== true)

  const languages = [
    ...new Set(owned.map((repo) => repo.language).filter((lang): lang is string => Boolean(lang))),
  ].slice(0, 12)

  const pushes = owned
    .map((repo) => repo.pushed_at)
    .filter((at): at is string => Boolean(at))
    .sort()

  return {
    totalStars: owned.reduce((sum, repo) => sum + (repo.stargazers_count ?? 0), 0),
    languages,
    lastPushedAt: pushes.at(-1) ?? null,
  }
}

function headers(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN
  return {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  }
}

/** Candidate org logins to try, most likely first. */
export function candidateLogins(company: { name: string | null; domain: string | null }): string[] {
  const candidates: string[] = []

  const normalized = normalizeCompanyName(company.name)
  if (normalized) {
    candidates.push(normalized.replace(/\s+/g, ''), normalized.replace(/\s+/g, '-'))
  }

  // The domain label is often the org login: acme.com → acme
  if (company.domain) {
    const label = company.domain.split('.')[0]
    if (label) candidates.push(label)
  }

  return [...new Set(candidates.filter((login) => /^[a-z0-9][a-z0-9-]{0,38}$/i.test(login)))]
}

async function lookup(company: CompanyEntity): Promise<GitHubPresence | null> {
  for (const login of candidateLogins(company)) {
    let org: GitHubOrg
    try {
      org = await requestJson<GitHubOrg>({ url: `${BASE}/orgs/${login}`, headers: headers() })
    } catch (error) {
      // 404 means no such org, which is a miss rather than a failure.
      if (error instanceof ProviderHttpError && error.code === 'ERR_PROVIDER_REJECTED') continue
      throw error
    }

    if (!orgBelongsToCompany(org, company)) continue

    const repos = await requestJson<GitHubRepo[]>({
      url: `${BASE}/orgs/${login}/repos?per_page=100&sort=pushed`,
      headers: headers(),
    })

    const summary = summariseRepos(Array.isArray(repos) ? repos : [])

    return {
      login: org.login ?? login,
      url: org.html_url ?? `https://github.com/${login}`,
      publicRepos: org.public_repos ?? 0,
      followers: org.followers ?? 0,
      ...summary,
    }
  }

  return null
}

export const githubProvider: IntelligenceProvider<GitHubPresence | null> = {
  name: 'github',
  category: 'technical_presence',

  canHandle: (task: ResearchTask) =>
    task.entity.type === 'company' &&
    Boolean(task.entity.name ?? task.entity.domain) &&
    task.fields.includes('github_presence'),

  // Free, with or without a token.
  estimateCost: async () => 0,

  execute: (task) => lookup(task.entity as CompanyEntity),

  normalize: (presence, task): NormalizedEvidence[] => {
    // No public organisation is a legitimate fact about a company, but not one
    // worth asserting — the field stays unknown.
    if (!presence) return []

    const retrievedAt = new Date()

    return [
      {
        field: 'github_presence',
        entityType: 'company',
        entityId: task.entity.id,
        value: {
          login: presence.login,
          publicRepos: presence.publicRepos,
          followers: presence.followers,
          totalStars: presence.totalStars,
          languages: presence.languages,
          lastPushedAt: presence.lastPushedAt,
        },
        sourceProvider: 'github',
        sourceUrl: presence.url,
        // The organisation's own public profile.
        sourceConfidence: 'high',
        confidence: 0.85,
        retrievedAt: retrievedAt.toISOString(),
        expiresAt: expiresAtFor('github_presence', retrievedAt)?.toISOString() ?? null,
      },
    ]
  },
}
