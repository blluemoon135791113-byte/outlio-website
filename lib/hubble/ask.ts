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
import {
  learnDomainFromRedirect,
  learnDomainFromSources,
  resolveCompanyDomain,
  siteScopedQuery,
} from '@/lib/hubble/domain'
import { crawl4AiPageFetcher } from '@/lib/hubble/fetch/crawl4ai'
import { httpPageFetcher } from '@/lib/hubble/fetch/fetcher'
import { resolveEmbeddingProvider } from '@/lib/hubble/providers/embedding'
import { resolveSearchProvider } from '@/lib/hubble/providers/search'
import { indexPageInSolr } from '@/lib/hubble/providers/solr'
import {
  DEFAULT_BUDGET,
  emptyUsage,
  isFetchFailure,
  retrievalDeadline,
  type AnswerSource,
  type AnswerStatus,
  type ResearchBudget,
  type ResearchUsage,
  type SearchHit,
} from '@/lib/hubble/providers/types'
import { answerFromEvidence, planResearch } from '@/lib/hubble/reason'
import {
  chunkText,
  diversify,
  hasReusableEvidence,
  retrieve,
  type Chunk,
} from '@/lib/hubble/retrieve'
import { looksLikeOwnDomain } from '@/lib/hubble/source-quality'
import {
  findCachedAnswer,
  knownUrls,
  loadCachedChunks,
  loadResearchEvidenceChunks,
  savePage,
  saveAnswer,
} from '@/lib/hubble/store'
import { citedContactEvidence } from '@/lib/hubble/contact-evidence'
import { writeEvidence } from '@/lib/intelligence/evidence-store'

export type AskSubject = {
  leadId: string | null
  companyId: string | null
  companyName: string | null
  domain: string | null
  personName: string | null
  personTitle: string | null
  /**
   * Where the lead is. Passed to identity resolution so a cited contact can be
   * corroborated against the right person, not merely the right name.
   */
  personLocation: string | null
  /** Whatever the CRM already holds, rendered for the model as context. */
  known: string
}

/**
 * What Hubble is doing right now.
 *
 * ⚠️ REAL PHASES, REPORTED AS THEY HAPPEN — never a timer pretending to be
 * progress. A question takes 40-90 seconds of genuine network work; the user
 * is owed the truth about which part is slow, and a fake sequence would
 * eventually claim "reading 4 pages" when nothing was fetched at all.
 */
export type AskPhase =
  | { phase: 'cache' }
  | { phase: 'planning' }
  | { phase: 'searching'; query: string; index: number; total: number }
  | { phase: 'reading'; count: number }
  | { phase: 'thinking'; passages: number }

export type AskProgress = (update: AskPhase) => void

export type AskResult = {
  answer: string
  status: AnswerStatus
  confidence: number
  sources: AnswerSource[]
  usage: ResearchUsage
  /** True when served entirely from a previous answer. */
  fromCache: boolean
  intent: string
  synthesis: import('@/lib/hubble/reason').SynthesisState
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
  onProgress: AskProgress = () => {},
): Promise<AskResult> {
  const started = Date.now()
  const usage = emptyUsage()
  const deadline = started + budget.maxTotalMs
  const researchDeadline = retrievalDeadline(started, budget)

  /* ---- 1. Cache. Before anything else, always. ------------------------- */
  onProgress({ phase: 'cache' })
  const cached = await findCachedAnswer(userId, subject.leadId, subject.companyId, question)
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
      synthesis: 'completed',
    }
  }

  /*
   * Resolved once, before any work: whether vectors are genuinely available.
   * `isConfigured()` only says a URL was set — see the note on `isUsable`.
   */
  const embedder = resolveEmbeddingProvider()
  const vectorsUsable = await embedder.isUsable({ deadlineAt: researchDeadline })

  /* ---- 2. What we already hold: previously fetched pages for this company. */
  const [pageChunks, typedEvidenceChunks, alreadyFetched] = await Promise.all([
    loadCachedChunks(userId, subject.companyId),
    loadResearchEvidenceChunks(userId, subject.leadId, subject.companyId),
    knownUrls(userId, subject.companyId),
  ])
  const chunks: Chunk[] = [...pageChunks, ...typedEvidenceChunks]

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
    : await resolveCompanyDomain(userId, subject.companyId, subject.companyName, researchDeadline)

  let domain = resolved?.domain ?? null

  /*
   * Repair a stale stored alias from evidence already in the cache.
   *
   * The first Caddie run had `hirecaddie.ai` stored but cached primary pages
   * on `caddie.app`. Reusable evidence meant the search/fetch block was skipped,
   * so redirect learning there could never run. A single guarded homepage read
   * proves the relationship before changing identity; after the compare-and-
   * swap succeeds, later questions skip this path because the hosts agree.
   */
  let checkedStoredHomepage = false
  if (domain && resolved?.origin === 'stored') {
    const hasMatchingAlias = chunks.some((chunk) => {
      try {
        const host = new URL(chunk.url).hostname.toLowerCase().replace(/^www\./, '')
        return host !== domain && looksLikeOwnDomain(host, subject.companyName)
      } catch {
        return false
      }
    })

    if (hasMatchingAlias && Date.now() < researchDeadline) {
      const requestedUrl = `https://${domain}/`
      const homepage = await httpPageFetcher.fetchPage(requestedUrl, {
        deadlineAt: researchDeadline,
      })
      checkedStoredHomepage = true
      if (!isFetchFailure(homepage)) {
        const canonical = await learnDomainFromRedirect(
          userId,
          subject.companyId,
          subject.companyName,
          domain,
          requestedUrl,
          homepage.url,
        )
        if (canonical) domain = canonical
      }
    }
  }

  /* ---- 3. Plan. ------------------------------------------------------- */
  onProgress({ phase: 'planning' })
  const { plan, llmCalls } = await planResearch(
    question,
    {
      companyName: subject.companyName,
      domain,
      personName: subject.personName,
      known: subject.known,
    },
    budget.maxQueriesPerRound,
    researchDeadline,
    budget.maxLlmCalls > 0,
  )
  usage.llmCalls += llmCalls

  /*
   * ⚠️ A CACHED CORPUS IS NOT A CACHED ANSWER.
   *
   * Even when the planner says existing data suffices, retrieval still runs
   * over the stored chunks — the answer is produced from evidence, never from
   * the planner's opinion that evidence exists.
   */
  const shouldSearch =
    !plan.sufficient &&
    !hasReusableEvidence(question, chunks, domain, subject.companyName) &&
    budget.maxSearchRounds > 0 &&
    Date.now() < researchDeadline

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

    for (const [index, query] of queries.entries()) {
      if (Date.now() > researchDeadline) break
      onProgress({ phase: 'searching', query, index: index + 1, total: queries.length })
      const hits = await search.search(query, 6, { deadlineAt: researchDeadline })
      usage.searches += 1
      candidates.push(...hits)
    }

    // Dedup by URL, drop what we already have and what is not worth reading.
    const seen = new Set<string>(alreadyFetched)
    const toFetch: string[] = []

    // Read the stored official homepage once. Besides providing primary
    // evidence, this deterministically discovers canonical-domain redirects
    // such as hirecaddie.ai -> caddie.app.
    if (domain && !checkedStoredHomepage) {
      const homepage = `https://${domain}/`
      if (!seen.has(homepage)) {
        seen.add(homepage)
        toFetch.push(homepage)
      }
    }

    for (const hit of candidates) {
      if (seen.has(hit.url) || !worthFetching(hit.url)) continue
      seen.add(hit.url)
      toFetch.push(hit.url)
      if (toFetch.length >= budget.maxPagesFetched) break
    }

    if (toFetch.length > 0) onProgress({ phase: 'reading', count: toFetch.length })

    const fetched = await pooled(toFetch, budget.concurrency, async (url) => {
      if (Date.now() > researchDeadline) return null
      const direct = await httpPageFetcher.fetchPage(url, { deadlineAt: researchDeadline })
      if (!isFetchFailure(direct)) return { requestedUrl: url, page: direct }

      // Browser rendering is reserved for pages plain HTTP could not read and
      // is bounded across the whole question, regardless of fetch concurrency.
      if (
        usage.browserFetches >= budget.maxBrowserFetches ||
        (direct.code !== 'empty' && direct.code !== 'http_error')
      ) return null

      usage.browserFetches += 1
      const rendered = await crawl4AiPageFetcher.fetchPage(url, { deadlineAt: researchDeadline })
      return isFetchFailure(rendered) ? null : { requestedUrl: url, page: rendered }
    })

    for (const fetchedPage of fetched) {
      if (!fetchedPage) continue
      const { requestedUrl, page } = fetchedPage
      usage.pagesFetched += 1

      if (domain) {
        const canonical = await learnDomainFromRedirect(
          userId,
          subject.companyId,
          subject.companyName,
          domain,
          requestedUrl,
          page.url,
        )
        if (canonical) domain = canonical
      }

      // Solr is an acceleration layer, never the source of truth. Indexing is
      // best-effort and cannot block saving the evidence in Hubble's database.
      await indexPageInSolr(page, { deadlineAt: researchDeadline })

      const pieces = chunkText(page.content)
      if (pieces.length === 0) continue

      /*
       * Embeddings when available, null when not. `savePage` stores null
       * happily and retrieval falls back to lexical scoring.
       */
      const embeddings = vectorsUsable
        ? await embedder.embed(pieces, { deadlineAt: researchDeadline })
        : null

      const pageId = await savePage({
        userId,
        companyId: subject.companyId,
        url: page.url,
        title: page.title,
        content: page.content,
        structured: page.structured,
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
  const queryEmbedding = vectorsUsable
    ? Date.now() < researchDeadline
      ? (await embedder.embed([question], { deadlineAt: researchDeadline }))?.[0] ?? null
      : null
    : null

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
  onProgress({ phase: 'thinking', passages: evidence.length })
  const { answer, llmCalls: answerCalls } = await answerFromEvidence(
    question,
    evidence,
    subject.known,
    domain,
    subject.companyName,
    deadline,
    Math.max(0, budget.maxLlmCalls - usage.llmCalls),
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
  // Deterministic contacts found in the exact cited passages become typed
  // lead evidence. The model's answer text is never parsed or trusted here.
  // Persistence is best-effort: a card write cannot erase a completed answer.
  try {
    await writeEvidence(userId, null, citedContactEvidence({
      leadId: subject.leadId,
      companyId: subject.companyId,
      personName: subject.personName,
      personTitle: subject.personTitle,
      personLocation: subject.personLocation,
      companyName: subject.companyName,
      domain,
    }, answer.status, answer.sources))
  } catch {
    // The page/chunk and answer stores still retain the cited result.
  }

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
    synthesis: answer.synthesis,
  }
}
