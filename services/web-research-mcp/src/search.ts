import * as cheerio from "cheerio";
import type { Config } from "./config.js";
import { normalizeUrl } from "./url.js";
import { ResearchError, type SearchResult } from "./types.js";

export interface SearchProvider { search(query: string, limit: number): Promise<SearchResult[]>; }

type SearxResult = {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  snippet?: unknown;
};

/** Operator-owned metasearch. No per-query API or billing dependency. */
export class SearxngSearchProvider implements SearchProvider {
  constructor(
    private readonly config: Config,
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.REQUEST_TIMEOUT_MS);
    try {
      const url = new URL("search", this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`);
      url.searchParams.set("q", query);
      url.searchParams.set("format", "json");
      const response = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: { accept: "application/json", "user-agent": "OutlioResearch/1.0 (+https://outlio.io)" },
      });
      if (!response.ok) {
        throw new ResearchError("SEARCH_PROVIDER_ERROR", `SearXNG returned HTTP ${response.status}`, response.status >= 500 || response.status === 429);
      }
      const payload = await response.json() as { results?: SearxResult[] };
      const results: SearchResult[] = [];
      for (const item of payload.results ?? []) {
        if (results.length >= limit) break;
        if (typeof item.url !== "string") continue;
        const normalized = normalizeUrl(item.url);
        if (!normalized) continue;
        results.push({
          query,
          title: typeof item.title === "string" ? item.title.trim() : "",
          url: normalized,
          snippet: typeof item.content === "string"
            ? item.content.replace(/\s+/g, " ").trim()
            : typeof item.snippet === "string"
              ? item.snippet.replace(/\s+/g, " ").trim()
              : "",
          rank: results.length + 1,
        });
      }
      return results;
    } catch (error) {
      if (error instanceof ResearchError) throw error;
      throw new ResearchError("SEARCH_PROVIDER_ERROR", error instanceof Error ? error.message : "SearXNG search failed", true);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Try lawful providers in order; a refusal never triggers evasion. */
export class FallbackSearchProvider implements SearchProvider {
  constructor(private readonly providers: readonly SearchProvider[]) {}

  async search(query: string, limit: number): Promise<SearchResult[]> {
    let lastError: unknown = null;
    for (const provider of this.providers) {
      try {
        const results = await provider.search(query, limit);
        if (results.length > 0) return results;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError;
    return [];
  }
}

export class DuckDuckGoHtmlSearchProvider implements SearchProvider {
  private lastRequest = 0;
  constructor(private readonly config: Config, private readonly fetchImpl: typeof fetch = fetch) {}
  async search(query: string, limit: number): Promise<SearchResult[]> {
    const wait = this.config.DDG_MIN_INTERVAL_MS - (Date.now() - this.lastRequest);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastRequest = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.REQUEST_TIMEOUT_MS);
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await this.fetchImpl(url, { signal: controller.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; OutlioResearch/1.0; +https://outlio.io)", accept: "text/html" } });
      const html = await response.text();
      if (response.status === 202 || /bots use duckduckgo|anomaly-modal|captcha/i.test(html)) {
        throw new ResearchError("SEARCH_PROVIDER_BLOCKED", "DuckDuckGo challenged this host's egress IP; no bypass was attempted", true);
      }
      if (!response.ok) throw new ResearchError("SEARCH_PROVIDER_ERROR", `DuckDuckGo returned HTTP ${response.status}`, response.status >= 500 || response.status === 429);
      return this.parse(html, query, limit);
    } catch (error) {
      if (error instanceof ResearchError) throw error;
      throw new ResearchError("SEARCH_PROVIDER_ERROR", error instanceof Error ? error.message : "Search failed", true);
    } finally { clearTimeout(timer); }
  }
  parse(html: string, query: string, limit: number): SearchResult[] {
    const $ = cheerio.load(html); const results: SearchResult[] = [];
    $(".result").each((_, element) => {
      if (results.length >= limit) return;
      const link = $(element).find(".result__a").first();
      const url = normalizeUrl(link.attr("href") ?? "", "https://duckduckgo.com");
      if (!url) return;
      results.push({ query, title: link.text().trim(), url, snippet: $(element).find(".result__snippet").text().replace(/\s+/g, " ").trim(), rank: results.length + 1 });
    });
    if (!results.length && /no results/i.test($.text()) === false) throw new ResearchError("SEARCH_PARSE_ERROR", "DuckDuckGo response contained no recognizable results", true);
    return results;
  }
}
