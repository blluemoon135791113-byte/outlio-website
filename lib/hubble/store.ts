import 'server-only'

import { createHash } from 'node:crypto'

/**
 * Hubble's memory: cached answers, cached pages, stored chunks.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  THE CACHE IS KEYED BY COMPANY, NOT BY LEAD.                             ║
 * ║                                                                          ║
 * ║  Ten leads at the same company must not cause ten identical research     ║
 * ║  runs. `companies` is already normalised by domain, so keying on         ║
 * ║  `company_id` inherits that dedup rather than reinventing it.            ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ EVERY QUERY SCOPES BY user_id. These run under the service role, which
 * bypasses RLS — the scoping is the access control, not a convenience.
 */
import type { AnswerSource, AnswerStatus, ResearchUsage } from '@/lib/hubble/providers/types'
import type { Chunk } from '@/lib/hubble/retrieve'
import { createAdminClient } from '@/lib/supabase/admin'

/** How long a cached answer stays usable. */
const ANSWER_TTL_DAYS = 14
/** How long a fetched page stays usable before it is read again. */
const PAGE_TTL_DAYS = 30

/**
 * Normalises a question for cache lookup.
 *
 * "What do they sell?" and "what do they sell" are the same question. This is
 * deliberately conservative — it does not try to be clever about synonyms,
 * because a false cache hit answers a question the user did not ask.
 */
export function questionKey(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
    .slice(0, 500)
}

export type CachedAnswer = {
  id: string
  answer: string
  status: AnswerStatus
  confidence: number
  sources: AnswerSource[]
  createdAt: string
}

/** Expired pages must never remain eligible just because their chunks do. */
export function cacheEntryFresh(expiresAt: string | null, now = Date.now()): boolean {
  if (!expiresAt) return true
  const expiry = new Date(expiresAt).getTime()
  return Number.isFinite(expiry) && expiry > now
}

/** The cache check that must happen before any research runs. */
export async function findCachedAnswer(
  userId: string,
  leadId: string | null,
  companyId: string | null,
  question: string,
): Promise<CachedAnswer | null> {
  if (!leadId && !companyId) return null

  const supabase = createAdminClient()

  let query = supabase
    .from('hubble_answers')
    .select('id, answer, status, confidence, sources, created_at, expires_at')
    .eq('user_id', userId)
    .eq('question_key', questionKey(question))
    // An "unknown" answer is not worth serving from cache: the web may have
    // changed, and repeating "I could not find it" without looking is worse
    // than looking again.
    .neq('status', 'unknown')
    .order('created_at', { ascending: false })
    .limit(1)

  // A person-specific answer must never leak across two leads at the same
  // company. Company-only callers still share their cache by company.
  query = leadId ? query.eq('lead_id', leadId) : query.is('lead_id', null)
  query = companyId ? query.eq('company_id', companyId) : query.is('company_id', null)

  const { data } = await query.maybeSingle()

  if (!data) return null
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null

  return {
    id: data.id,
    answer: data.answer,
    status: data.status as AnswerStatus,
    confidence: Number(data.confidence),
    sources: Array.isArray(data.sources) ? (data.sources as AnswerSource[]) : [],
    createdAt: data.created_at,
  }
}

export async function saveAnswer(input: {
  userId: string
  leadId: string | null
  companyId: string | null
  question: string
  answer: string
  status: AnswerStatus
  confidence: number
  sources: AnswerSource[]
  usage: ResearchUsage
}): Promise<string | null> {
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('hubble_answers')
    .insert({
      user_id: input.userId,
      lead_id: input.leadId,
      company_id: input.companyId,
      question: input.question.slice(0, 2000),
      question_key: questionKey(input.question),
      answer: input.answer,
      status: input.status,
      confidence: input.confidence,
      sources: input.sources,
      usage: input.usage,
      expires_at: new Date(Date.now() + ANSWER_TTL_DAYS * 86_400_000).toISOString(),
    } as never)
    .select('id')
    .maybeSingle()

  return data?.id ?? null
}

/** Pages already read for this company, newest first. */
export async function loadCachedChunks(
  userId: string,
  companyId: string | null,
  limit = 400,
): Promise<Chunk[]> {
  if (!companyId) return []

  const supabase = createAdminClient()

  const { data } = await supabase
    .from('hubble_chunks')
    .select('id, page_id, ordinal, content, embedding, hubble_pages!inner(url, title, expires_at)')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .limit(limit)

  return (data ?? [])
    .map((row) => {
      const page = row.hubble_pages as unknown as {
        url: string
        title: string | null
        expires_at: string | null
      }
      return { row, page }
    })
    .filter(({ page }) => cacheEntryFresh(page.expires_at))
    .map(({ row, page }) => ({
      pageId: row.page_id,
      url: page.url,
      title: page.title,
      ordinal: row.ordinal,
      content: row.content,
      embedding: Array.isArray(row.embedding) ? (row.embedding as number[]) : null,
    }))
}

type ResearchEvidenceChunkRow = {
  id: string
  entity_type: 'company' | 'person'
  field: string
  value_json: unknown
  source_url: string | null
  source_provider: string
  source_confidence: string
  confidence: number
  retrieved_at: string
  expires_at: string | null
}

function readableEvidenceValue(value: unknown): string {
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, child]) => `${key.replaceAll('_', ' ')}: ${typeof child === 'string' ? child : JSON.stringify(child)}`)
      .join('; ')
  }
  return String(value ?? '')
}

/** PURE bridge from typed intelligence evidence into citation-ready RAG chunks. */
export function researchEvidenceToChunks(rows: readonly ResearchEvidenceChunkRow[]): Chunk[] {
  const seen = new Set<string>()
  const chunks: Chunk[] = []

  for (const row of rows) {
    if (!row.source_url || !cacheEntryFresh(row.expires_at)) continue
    try {
      const url = new URL(row.source_url)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
    } catch {
      continue
    }

    const field = row.field.replaceAll('_', ' ')
    const value = readableEvidenceValue(row.value_json)
    const key = `${row.entity_type}:${row.field}:${value}:${row.source_url}`
    if (seen.has(key)) continue
    seen.add(key)

    chunks.push({
      pageId: `research-evidence:${row.id}`,
      url: row.source_url,
      title: `Outlio research: ${field}`,
      ordinal: 0,
      content: [
        `Entity type: ${row.entity_type}.`,
        `Field: ${field}.`,
        `Publicly sourced value: ${value}.`,
        `Source provider: ${row.source_provider}.`,
        `Source confidence: ${row.source_confidence}.`,
        `Evidence confidence: ${Number(row.confidence).toFixed(2)}.`,
        `Retrieved at: ${row.retrieved_at}.`,
      ].join(' '),
      embedding: null,
    })
  }

  return chunks
}

/**
 * Loads typed provider/MCP facts as RAG passages. This is the bridge that lets
 * Hubble answer from an email, phone, social profile, funding fact, or signal
 * already enriched by the batch pipeline without searching the web again.
 */
export async function loadResearchEvidenceChunks(
  userId: string,
  leadId: string | null,
  companyId: string | null,
): Promise<Chunk[]> {
  const supabase = createAdminClient()
  const select = 'id, entity_type, field, value_json, source_url, source_provider, source_confidence, confidence, retrieved_at, expires_at'
  const reads: Array<PromiseLike<{ data: unknown[] | null }>> = []

  if (leadId) {
    reads.push(supabase
      .from('research_evidence')
      .select(select)
      .eq('user_id', userId)
      .eq('entity_type', 'person')
      .eq('entity_id', leadId)
      .order('retrieved_at', { ascending: false })
      .limit(100))
  }
  if (companyId) {
    reads.push(supabase
      .from('research_evidence')
      .select(select)
      .eq('user_id', userId)
      .eq('entity_type', 'company')
      .eq('entity_id', companyId)
      .order('retrieved_at', { ascending: false })
      .limit(100))
  }

  const results = await Promise.all(reads)
  const rows = results.flatMap((result) => result.data ?? []) as ResearchEvidenceChunkRow[]
  return researchEvidenceToChunks(rows)
}

/** URLs already fetched, so a second question does not refetch them. */
export async function knownUrls(userId: string, companyId: string | null): Promise<Set<string>> {
  if (!companyId) return new Set()

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('hubble_pages')
    .select('url, expires_at')
    .eq('user_id', userId)
    .eq('company_id', companyId)

  const fresh = (data ?? []).filter((row) => cacheEntryFresh(row.expires_at))

  return new Set(fresh.map((row) => row.url))
}

export async function savePage(input: {
  userId: string
  companyId: string | null
  url: string
  title: string | null
  content: string
  structured: Record<string, unknown>
  method: 'fetch' | 'browser'
  status: number
  chunks: readonly string[]
  embeddings: number[][] | null
  embedModel: string | null
}): Promise<string | null> {
  const supabase = createAdminClient()
  const contentHash = createHash('sha256').update(input.content).digest('hex')
  const structured = { ...input.structured, contentHash }

  const host = (() => {
    try {
      return new URL(input.url).hostname
    } catch {
      return 'unknown'
    }
  })()

  const { data: existing } = await supabase
    .from('hubble_pages')
    .select('id, structured')
    .eq('user_id', input.userId)
    .eq('url', input.url)
    .maybeSingle()

  const previousStructured = existing?.structured &&
    typeof existing.structured === 'object' &&
    !Array.isArray(existing.structured)
    ? existing.structured as Record<string, unknown>
    : {}

  if (existing?.id && previousStructured.contentHash === contentHash) {
    await supabase
      .from('hubble_pages')
      .update({
        company_id: input.companyId,
        title: input.title,
        structured,
        fetch_method: input.method,
        http_status: input.status,
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + PAGE_TTL_DAYS * 86_400_000).toISOString(),
      } as never)
      .eq('id', existing.id)
      .eq('user_id', input.userId)

    return existing.id
  }

  const { data: page } = await supabase
    .from('hubble_pages')
    .upsert(
      {
        user_id: input.userId,
        company_id: input.companyId,
        url: input.url,
        host,
        title: input.title,
        content: input.content,
        content_chars: input.content.length,
        structured,
        fetch_method: input.method,
        http_status: input.status,
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + PAGE_TTL_DAYS * 86_400_000).toISOString(),
      } as never,
      { onConflict: 'user_id,url' },
    )
    .select('id')
    .maybeSingle()

  if (!page?.id) return null

  // Replace rather than append: a refetched page must not leave the previous
  // version's chunks behind to be retrieved as if they were current.
  await supabase.from('hubble_chunks').delete().eq('page_id', page.id).eq('user_id', input.userId)

  if (input.chunks.length > 0) {
    await supabase.from('hubble_chunks').insert(
      input.chunks.map((content, index) => ({
        user_id: input.userId,
        page_id: page.id,
        company_id: input.companyId,
        ordinal: index,
        content,
        embedding: input.embeddings?.[index] ?? null,
        embed_model: input.embeddings ? input.embedModel : null,
      })) as never,
    )
  }

  return page.id
}
