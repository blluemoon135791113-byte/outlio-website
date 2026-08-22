import 'server-only'

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
  companyId: string | null,
  question: string,
): Promise<CachedAnswer | null> {
  if (!companyId) return null

  const supabase = createAdminClient()

  const { data } = await supabase
    .from('hubble_answers')
    .select('id, answer, status, confidence, sources, created_at, expires_at')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .eq('question_key', questionKey(question))
    // An "unknown" answer is not worth serving from cache: the web may have
    // changed, and repeating "I could not find it" without looking is worse
    // than looking again.
    .neq('status', 'unknown')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

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

  const host = (() => {
    try {
      return new URL(input.url).hostname
    } catch {
      return 'unknown'
    }
  })()

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
        structured: input.structured,
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
