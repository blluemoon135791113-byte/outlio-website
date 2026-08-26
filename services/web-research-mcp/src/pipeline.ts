import type { Config } from "./config.js";
import { clampLimits } from "./config.js";
import { ContentChunker } from "./chunker.js";
import { ConfidenceScorer, FactMerger } from "./facts.js";
import type { FetchedPage } from "./fetcher.js";
import type { SemanticExtractor } from "./gemini.js";
import { CheerioParser } from "./parser.js";
import { QueryGenerator } from "./query-generator.js";
import { RelevanceScorer } from "./relevance.js";
import type { SearchProvider } from "./search.js";
import { isBlockedHost } from "./url.js";
import type { ResearchFact, ResearchOutput, ResearchRequest, ScoredPage } from "./types.js";

async function concurrentMap<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const output: R[] = new Array(items.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => { while (true) { const index = cursor++; if (index >= items.length) return; output[index] = await fn(items[index]); } }));
  return output;
}

export class LeadResearchPipeline {
  constructor(private readonly config: Config, private readonly search: SearchProvider, private readonly fetcher: { fetch(url: string): Promise<FetchedPage> }, private readonly extractor: SemanticExtractor) {}

  async run(request: ResearchRequest): Promise<ResearchOutput> {
    const started = Date.now(); const limits = clampLimits(this.config, request.limits); const failures: Array<{ url: string; error: string }> = [];
    const queries = new QueryGenerator().generate(request.lead, request.requested_fields, limits.maxQueries); const results = [];
    for (const query of queries) results.push(...await this.search.search(query, limits.resultsPerQuery));
    const seen = new Set<string>(); const selected = results.filter((result) => { if (seen.has(result.url) || isBlockedHost(new URL(result.url).hostname)) return false; seen.add(result.url); return true; }).slice(0, limits.maxUrls);
    const parser = new CheerioParser(); const scorer = new RelevanceScorer();
    const domainLimiter = new DomainLimiter(this.config.PER_DOMAIN_CONCURRENCY);
    const fetched = await concurrentMap(selected, this.config.CONCURRENT_REQUESTS, async (result): Promise<ScoredPage | null> => {
      try { const page = await domainLimiter.run(new URL(result.url).hostname, () => this.fetcher.fetch(result.url)); const parsed = parser.parse(page.url, page.html); const score = scorer.score(parsed, request.lead, result.query, result.rank); return { ...parsed, query: result.query, rank: result.rank, ...score }; }
      catch (error) { const message = error instanceof Error ? error.message : "Fetch failed"; failures.push({ url: result.url, error: message }); console.warn(JSON.stringify({ event: "page_fetch_failed", url: result.url, error: message })); return null; }
    });
    const pages = fetched.filter((page): page is ScoredPage => Boolean(page && page.relevance >= this.config.RELEVANCE_THRESHOLD)).sort((a, b) => b.relevance - a.relevance);
    const confidence = new ConfidenceScorer(); const facts: ResearchFact[] = pages.flatMap((page) => confidence.deterministic(page));
    const chunker = new ContentChunker(); let calls = 0;
    for (const page of pages) {
      for (const chunk of chunker.chunk(`${page.title}\n${page.description}\n${page.headings.join("\n")}\n${page.text}`)) {
        if (calls >= limits.maxGeminiCalls) break; facts.push(...await this.extractor.extract(request.lead, page, chunk)); calls++;
      }
      if (calls >= limits.maxGeminiCalls) break;
    }
    const output = new FactMerger().merge(facts, pages, { queries_generated: queries.length, results_found: results.length, urls_scraped: selected.length - failures.length, failed_pages: failures.length, failed_page_details: failures.slice(0, 10), pages_relevant: pages.length, pages_sent_to_gemini: calls, facts_extracted: facts.length, total_research_ms: Date.now() - started });
    output.person.name = request.lead.name; output.person.job_title = request.lead.job_title; output.person.company = request.lead.company;
    output.company.name = request.lead.company; output.company.domain = request.lead.company_domain;
    return output;
  }
}

class DomainLimiter {
  private active = new Map<string, number>(); private queues = new Map<string, Array<() => void>>();
  constructor(private readonly limit: number) {}
  async run<T>(domain: string, task: () => Promise<T>): Promise<T> { await this.acquire(domain); try { return await task(); } finally { this.release(domain); } }
  private async acquire(domain: string) { if ((this.active.get(domain) ?? 0) < this.limit) { this.active.set(domain, (this.active.get(domain) ?? 0) + 1); return; } await new Promise<void>((resolve) => { const queue = this.queues.get(domain) ?? []; queue.push(resolve); this.queues.set(domain, queue); }); this.active.set(domain, (this.active.get(domain) ?? 0) + 1); }
  private release(domain: string) { this.active.set(domain, Math.max(0, (this.active.get(domain) ?? 1) - 1)); const next = this.queues.get(domain)?.shift(); if (next) next(); }
}
