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
import { isBlockedHost, normalizeUrl } from "./url.js";
import { ResearchError, type ResearchFact, type ResearchOutput, type ResearchRequest, type ScoredPage } from "./types.js";

async function concurrentMap<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const output: R[] = new Array(items.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => { while (true) { const index = cursor++; if (index >= items.length) return; output[index] = await fn(items[index]); } }));
  return output;
}

const CONTACT_FIELDS = new Set(["work_email", "email_status", "emails", "mobile_phone", "phone_status", "phones", "person_social_profiles"]);
const CONTACT_PATH = /\/(?:about(?:-us)?|team|people|leadership|management|staff|contact(?:-us)?|press|media|author|speaker|profile)(?:\/|$)/i;
const SKIP_PATH = /\.(?:avif|css|gif|ico|jpe?g|js|json|mp3|mp4|png|svg|webm|webp|woff2?)(?:$|\?)/i;

function normalizedHost(value: string): string {
  try {
    const url = value.includes("://") ? new URL(value) : new URL(`https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return value.toLowerCase().replace(/^www\./, "").split("/")[0] ?? "";
  }
}

/**
 * Relevant links from pages on the company-owned domain. This is deliberately
 * one-hop and path-scored: it finds team/contact biographies without turning
 * Hubble into an open-ended crawler.
 */
export function discoverOfficialContactUrls(
  pages: readonly ScoredPage[],
  companyDomain: string,
  leadName: string,
  seen: ReadonlySet<string>,
  limit: number,
): string[] {
  const official = normalizedHost(companyDomain);
  if (!official || limit <= 0) return [];
  const nameTokens = leadName.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length > 1) ?? [];
  const candidates = new Map<string, number>();

  const consider = (raw: string, fallbackScore = 0) => {
    try {
      const url = new URL(raw);
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      if (host !== official && !host.endsWith(`.${official}`)) return;
      if (SKIP_PATH.test(`${url.pathname}${url.search}`)) return;
      url.hash = "";
      const normalized = normalizeUrl(url.toString());
      if (!normalized || seen.has(normalized)) return;
      const path = url.pathname.toLowerCase();
      const nameScore = nameTokens.some((token) => path.includes(token)) ? 3 : 0;
      const pathScore = CONTACT_PATH.test(path) ? 2 : 0;
      const score = fallbackScore + nameScore + pathScore;
      if (score <= 0) return;
      candidates.set(normalized, Math.max(candidates.get(normalized) ?? 0, score));
    } catch {
      // Parser-generated URLs are validated elsewhere; malformed links simply
      // cannot join the bounded crawl frontier.
    }
  };

  for (const page of pages) for (const url of page.signals.urls) consider(url);

  // JS-only homepages often expose no usable navigation in the HTML response.
  // A tiny deterministic fallback still checks conventional first-party pages.
  for (const path of ["/team", "/about", "/leadership", "/contact"]) {
    consider(`https://${official}${path}`, 1);
  }

  return [...candidates.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([url]) => url);
}

export class LeadResearchPipeline {
  constructor(private readonly config: Config, private readonly search: SearchProvider, private readonly fetcher: { fetch(url: string): Promise<FetchedPage> }, private readonly extractor: SemanticExtractor) {}

  async run(request: ResearchRequest): Promise<ResearchOutput> {
    const started = Date.now(); const limits = clampLimits(this.config, request.limits); const failures: Array<{ url: string; error: string }> = [];
    const queries = new QueryGenerator().generate(request.lead, request.requested_fields, limits.maxQueries); const results = []; const searchFailures: Array<{ query: string; error: string }> = []; let queriesAttempted = 0;
    for (const query of queries) {
      queriesAttempted++;
      try { results.push(...await this.search.search(query, limits.resultsPerQuery)); }
      catch (error) {
        const code = error instanceof ResearchError ? error.code : "SEARCH_FAILED";
        searchFailures.push({ query, error: code });
        // A challenge is a stop signal, never something to work around. Cached
        // results already obtained are still valid evidence. A caller-supplied
        // official domain is also valid independent evidence, so continue only
        // to that direct fetch; without either, fail honestly.
        if (results.length === 0 && !request.lead.company_domain) throw error;
        break;
      }
    }
    // A supplied company domain is the strongest identity signal we have and
    // its homepage is usually the best primary source. Fetch it once even when
    // search rankings are crowded by directories and contact-data vendors.
    const officialUrl = request.lead.company_domain
      ? normalizeUrl(`https://${request.lead.company_domain}`)
      : null;
    const candidates = officialUrl
      ? [{ query: `official website for ${request.lead.company}`, title: request.lead.company, url: officialUrl, snippet: "Official company website", rank: 1 }, ...results]
      : results;
    const wantsContacts = request.requested_fields.some((field) => CONTACT_FIELDS.has(field));
    const discoveryReserve = officialUrl && wantsContacts ? Math.min(4, Math.max(0, limits.maxUrls - 1)) : 0;
    const initialLimit = Math.max(1, limits.maxUrls - discoveryReserve);
    const seen = new Set<string>(); const selected = candidates.filter((result) => { if (seen.has(result.url) || isBlockedHost(new URL(result.url).hostname)) return false; seen.add(result.url); return true; }).slice(0, initialLimit);
    const parser = new CheerioParser(); const scorer = new RelevanceScorer();
    const domainLimiter = new DomainLimiter(this.config.PER_DOMAIN_CONCURRENCY);
    const fetchSelected = async (batch: typeof selected): Promise<Array<ScoredPage | null>> => concurrentMap(batch, this.config.CONCURRENT_REQUESTS, async (result): Promise<ScoredPage | null> => {
      try { const page = await domainLimiter.run(new URL(result.url).hostname, () => this.fetcher.fetch(result.url)); const parsed = parser.parse(page.url, page.html); const score = scorer.score(parsed, request.lead, result.query, result.rank); return { ...parsed, query: result.query, rank: result.rank, ...score }; }
      catch (error) { const message = error instanceof Error ? error.message : "Fetch failed"; failures.push({ url: result.url, error: message }); console.warn(JSON.stringify({ event: "page_fetch_failed", url: result.url, error: message })); return null; }
    });
    const initialFetched = await fetchSelected(selected);
    const initialPages = initialFetched.filter((page): page is ScoredPage => Boolean(page));
    const discoveredUrls = officialUrl && wantsContacts
      ? discoverOfficialContactUrls(
          initialPages,
          request.lead.company_domain,
          request.lead.name,
          seen,
          limits.maxUrls - selected.length,
        )
      : [];
    const discovered = discoveredUrls.map((url, index) => {
      seen.add(url);
      return {
        query: `official contact page for ${request.lead.name} at ${request.lead.company}`,
        title: `Official contact page ${index + 1}`,
        url,
        snippet: "Company-owned contact or team page",
        rank: index + 1,
      };
    });
    const fetched = [...initialFetched, ...await fetchSelected(discovered)];
    const pages = fetched.filter((page): page is ScoredPage => Boolean(page && page.relevance >= this.config.RELEVANCE_THRESHOLD)).sort((a, b) => b.relevance - a.relevance);
    const confidence = new ConfidenceScorer();
    // Search snippets are evidence too: they often expose a public work email
    // or business phone before the destination page is opened (and some social
    // destinations must never be fetched). Attribution remains conservative
    // and every finding keeps the result URL plus a publicly_found status.
    const facts: ResearchFact[] = [
      ...results.flatMap((result) => confidence.snippet(result, request.lead)),
      ...pages.flatMap((page) => confidence.deterministic(page, request.lead)),
    ];
    const chunker = new ContentChunker(); let calls = 0; let geminiFailures = 0;
    for (const page of pages) {
      for (const chunk of chunker.chunk(`${page.title}\n${page.description}\n${page.headings.join("\n")}\n${page.text}`)) {
        if (calls >= limits.maxGeminiCalls) break;
        try { facts.push(...await this.extractor.extract(request.lead, page, chunk)); }
        catch (error) {
          geminiFailures++;
          console.warn(JSON.stringify({ event: "semantic_extraction_failed", url: page.url, error: error instanceof ResearchError ? error.code : "GEMINI_ERROR" }));
        }
        calls++;
      }
      if (calls >= limits.maxGeminiCalls) break;
    }
    const output = new FactMerger().merge(facts, pages, { queries_generated: queries.length, queries_attempted: queriesAttempted, search_failures: searchFailures, results_found: results.length, urls_scraped: selected.length + discovered.length - failures.length, official_pages_discovered: discovered.length, failed_pages: failures.length, failed_page_details: failures.slice(0, 10), pages_relevant: pages.length, pages_sent_to_gemini: calls, gemini_failures: geminiFailures, facts_extracted: facts.length, total_research_ms: Date.now() - started });
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
