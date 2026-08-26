import { createHash } from "node:crypto";
import type { Config } from "./config.js";
import type { FetchedPage, PageFetcher } from "./fetcher.js";
import type { SemanticExtractor } from "./gemini.js";
import type { SearchProvider } from "./search.js";
import type { ResearchStorage } from "./store.js";
import type { Lead, ResearchFact, ScoredPage, SearchResult } from "./types.js";

const keyOf = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export class CachingSearchProvider implements SearchProvider {
  constructor(private readonly inner: SearchProvider, private readonly store: ResearchStorage, private readonly config: Config) {}
  async search(query: string, limit: number): Promise<SearchResult[]> { const key = keyOf({ query, limit }); const cached = await this.store.cacheGet<SearchResult[]>("search", key); if (cached) return cached; const value = await this.inner.search(query, limit); await this.store.cacheSet("search", key, value, this.config.CACHE_TTL_SECONDS); return value; }
}

export class CachingPageFetcher {
  constructor(private readonly inner: PageFetcher, private readonly store: ResearchStorage, private readonly config: Config) {}
  async fetch(url: string): Promise<FetchedPage> { const key = keyOf(url); const cached = await this.store.cacheGet<FetchedPage>("page", key); if (cached) return cached; const value = await this.inner.fetch(url); await this.store.cacheSet("page", key, value, this.config.CACHE_TTL_SECONDS); return value; }
}

export class CachingSemanticExtractor implements SemanticExtractor {
  constructor(private readonly inner: SemanticExtractor, private readonly store: ResearchStorage, private readonly config: Config) {}
  async extract(lead: Lead, page: ScoredPage, chunk: string): Promise<ResearchFact[]> { const key = keyOf({ lead, url: page.url, chunk, model: this.config.GEMINI_MODEL }); const cached = await this.store.cacheGet<ResearchFact[]>("extraction", key); if (cached) return cached; const value = await this.inner.extract(lead, page, chunk); await this.store.cacheSet("extraction", key, value, this.config.CACHE_TTL_SECONDS); return value; }
}
