import 'server-only'

/**
 * Ask Hubble — the orchestrator.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  cache → plan → search → fetch → extract → chunk → retrieve → answer     ║
 * ║                                                                          ║
 * ║  Every step is bounded by `ResearchBudget`. The planner decides WHAT to  ║
 * ║  research; this file decides HOW MUCH may happen. That split is the      ║
 * ║  whole reason one question cannot become an unbounded crawl — the model  ║
 * ║  is never the thing enforcing its own limits.                            ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ THIS IS THE MICRO PATH: one lead, one question, researched properly. It
 * is never run across a batch. Deep research on every person in a 300-lead
 * upload is exactly the unbounded work the budget exists to prevent — batch
 * analysis stays with the existing provider pipeline and SQL aggregation.
 */
import { learnDomainFromSources, resolveCompanyDomain, siteScopedQuery } from '@/lib/hubble/domain'
import { httpPageFetcher } from '@/lib/hubble/fetch/fetcher'
import { resolveEmbeddingProvider } from '@/lib/hubble/providers/embedding'
import { resolveSearchProvider } from '@/lib/hubble/providers/search'
import {
  DEFAULT_BUDGET,
  emptyUsage,
  isFetchFailure,
  type AnswerSource,
  type AnswerStatus,
  type ResearchBudget,
  type ResearchUsage,
  type SearchHit,
} from '@/lib/hubble/providers/types'
import { answerFromEvidence, planResearch } from '@/lib/hubble/reason'
import { chunkText, diversify, retrieve, type Chunk } from '@/lib/hubble/retrieve'
import { findCachedAnswer, knownUrls, loadCachedChunks, savePage, saveAnswer } from '@/lib/hubble/store'

export type AskSubject = {
  leadId: string | null
  companyId: string | null
  companyName: string | null
  domain: string | null
  personName: string | null
  personTitle: string | null
  /** Whatever the CRM already holds, rendered for the model as context. */
  known: string
}

export type AskResult = {
  answer: string
  status: AnswerStatus
  confidence: number
  sources: AnswerSource[]
  usage: ResearchUsage
  /** True when served entirely from a previous answer. */
  fromCache: boolean
  intent: string
}

/** Hosts that never yield readable evidence, so fetching them wastes budget. */
const UNFETCHABLE = [
  /(^|\.)linkedin\.com$/i, // rule 1, and enforced again in the fetcher
  /(^|\.)facebook\.com$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)twitter\.com$/i,
  /(^|\.)x\.com$/i,
  /(^|\.)youtube\.com$/i,
  /(^|\.)pinterest\./i,
]

function worthFetching(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return !UNFETCHABLE.some((pattern) => pattern.test(host))
  } catch {
    return false
  }
}

/** Runs tasks with a concurrency ceiling — politeness to the sites we read. */
async function pooled<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  let cursor = 0

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      const item = items[index]
      if (item === undefined) return
      results.push(await worker(item))
    }
  })

  await Promise.all(runners)
  return results
}

export async function askHubble(
  userId: string,
  subject: AskSubject,
  question: string,
  budget: ResearchBudget = DEFAULT_BUDGET,
): Promise<AskResult> {
  const started = Date.now()
  const usage = emptyUsage()
  const deadline = started + budget.maxTotalMs

  /* ---- 1. Cache. Before anything else, always. ------------------------- */
  const cached = await findCachedAnswer(userId, subject.companyId, question)
  if (cached) {
    usage.cacheHits = 1
    usage.elapsedMs = Date.now() - started
    return {
      answer: cached.answer,
      status: cached.status,
      confidence: cached.confidence,
      sources: cached.sources,
      usage,
      fromCache: true,
      intent: question,
    }
  }

  /*
   * Resolved once, before any work: whether vectors are genuinely available.
   * `isConfigured()` only says a URL was set — see the note on `isUsable`.
   */
  const embedder = resolveEmbeddingProvider()
  const vectorsUsable = await embedder.isUsable()

  /* ---- 2. What we already hold: previously fetched pages for this company. */
  const chunks: Chunk[] = await loadCachedChunks(userId, subject.companyId)
  const alreadyFetched = await knownUrls(userId, subject.companyId)

  /*
   * ⚠️ THE DOMAIN, BEFORE PLANNING — it is what makes the queries precise.
   *
   * Without it a question about "Atlas AI Solutions" returned atlasai.uk and
   * atlasaisolutions.org, which are different companies. Read from
   * `companies.domain` when stored, discovered and saved when not, so this
   * cost is paid once per company rather than once per question.
   */
  const resolved = subject.domain
    ? { domain: subject.domain, origin: 'stored' as const }
    : await resolveCompanyDomain(userId, subject.companyId, subject.companyName)

  const domain = resolved?.domain ?? null

  /* ---- 3. Plan. ------------------------------------------------------- */
  const { plan, llmCalls } = await planResearch(
    question,
    {
      companyName: subject.companyName,
      domain,
      personName: subject.personName,
      known: subject.known,
    },
    budget.maxQueriesPerRound,
  )
  usage.llmCalls += llmCalls

  /*
   * ⚠️ A CACHED CORPUS IS NOT A CACHED ANSWER.
   *
   * Even when the planner says existing data suffices, retrieval still runs
   * over the stored chunks — the answer is produced from evidence, never from
   * the planner's opinion that evidence exists.
   */
  const shouldSearch = !plan.sufficient && Date.now() < deadline

  /* ---- 4. Search, then fetch. ----------------------------------------- */
  if (shouldSearch) {
    const search = resolveSearchProvider()
    const candidates: SearchHit[] = []

    /*
     * One site-scoped query alongside the planner's, when a domain is known.
     * It finds what the company says about itself — authoritative for
     * products, pricing and people, useless for funding or news, which is why
     * it supplements the unscoped queries rather than replacing them.
     */
    const queries = domain
      ? [siteScopedQuery(question, domain), ...plan.queries].slice(0, budget.maxQueriesPerRound + 1)
      : plan.queries

    for (const query of queries) {
      if (Date.now() > deadline) break
      const hits = await search.search(query, 6)
      usage.searches += 1
      candidates.push(...hits)
    }

    // Dedup by URL, drop what we already have and what is not worth reading.
    const seen = new Set<string>(alreadyFetched)
    const toFetch: string[] = []
    for (const hit of candidates) {
      if (seen.has(hit.url) || !worthFetching(hit.url)) continue
      seen.add(hit.url)
      toFetch.push(hit.url)
      if (toFetch.length >= budget.maxPagesFetched) break
    }

    const fetched = await pooled(toFetch, budget.concurrency, async (url) => {
      if (Date.now() > deadline) return null
      const page = await httpPageFetcher.fetchPage(url)
      if (isFetchFailure(page)) return null
      return page
    })

    for (const page of fetched) {
      if (!page) continue
      usage.pagesFetched += 1

      const pieces = chunkText(page.content)
      if (pieces.length === 0) continue

      /*
       * Embeddings when available, null when not. `savePage` stores null
       * happily and retrieval falls back to lexical scoring.
       */
      const embeddings = vectorsUsable ? await embedder.embed(pieces) : null

      const pageId = await savePage({
        userId,
        companyId: subject.companyId,
        url: page.url,
        title: page.title,
        content: page.content,
        structured: {},
        method: page.method,
        status: page.status,
        chunks: pieces,
        embeddings,
        embedModel: embeddings ? embedder.model : null,
      })

      chunks.push(
        ...pieces.map((content, index) => ({
          pageId: pageId ?? page.url,
          url: page.url,
          title: page.title,
          ordinal: index,
          embedding: embeddings?.[index] ?? null,
          content,
        })),
      )
    }
  }

  /* ---- 5. Retrieve. --------------------------------------------------- */
  const queryEmbedding = vectorsUsable ? (await embedder.embed([question]))?.[0] ?? null : null

  const ranked = retrieve(
    question,
    chunks,
    queryEmbedding,
    budget.maxChunksToModel * 3,
    domain,
    subject.companyName,
  )
  // At most 3 passages from any one page, so a single verbose site cannot
  // fill the evidence set and make corroboration impossible.
  const evidence = diversify(ranked, 3, budget.maxChunksToModel)

  /* ---- 6. Answer. ----------------------------------------------------- */
  const { answer, llmCalls: answerCalls } = await answerFromEvidence(
    question,
    evidence,
    subject.known,
    domain,
    subject.companyName,
  )
  usage.llmCalls += answerCalls
  usage.elapsedMs = Date.now() - started

  /*
   * ⚠️ LEARN THE DOMAIN FROM WHAT WAS ACTUALLY CITED.
   *
   * Being cited is better evidence of ownership than ranking first in a
   * search. Only fills a gap — never overwrites a known domain — and makes
   * every future question about this company site-scoped and precise.
   */
  if (!domain) {
    await learnDomainFromSources(
      userId,
      subject.companyId,
      subject.companyName,
      answer.sources.map((source) => source.url),
    )
  }

  /* ---- 7. Save, so the next question reuses it. ------------------------ */
  await saveAnswer({
    userId,
    leadId: subject.leadId,
    companyId: subject.companyId,
    question,
    answer: answer.answer,
    status: answer.status,
    confidence: answer.confidence,
    sources: answer.sources,
    usage,
  })

  return {
    answer: answer.answer,
    status: answer.status,
    confidence: answer.confidence,
    sources: answer.sources,
    usage,
    fromCache: false,
    intent: plan.intent,
  }
}
