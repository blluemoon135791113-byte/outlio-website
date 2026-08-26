import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { FactMerger } from "../src/facts.js";
import { CheerioParser } from "../src/parser.js";
import { QueryGenerator } from "../src/query-generator.js";
import { DuckDuckGoHtmlSearchProvider } from "../src/search.js";
import { MemoryResearchStorage } from "../src/store.js";
import { ResearchRequestSchema, type ScoredPage } from "../src/types.js";
import { normalizeUrl } from "../src/url.js";

const config = loadConfig({ NODE_ENV: "test", DDG_MIN_INTERVAL_MS: "250" });

describe("URLNormalizer", () => {
  it("unwraps DDG redirects and removes tracking", () => {
    const target = encodeURIComponent("https://www.example.com/a?utm_source=x&id=7#top");
    expect(normalizeUrl(`https://duckduckgo.com/l/?uddg=${target}`)).toBe("https://example.com/a?id=7");
  });
});

describe("configuration", () => {
  it("treats blank optional secrets as unconfigured", () => {
    const parsed = loadConfig({ NODE_ENV: "test", MCP_BEARER_TOKEN: "", DATABASE_URL: "", GEMINI_API_KEY: "" });
    expect(parsed.MCP_BEARER_TOKEN).toBeUndefined(); expect(parsed.DATABASE_URL).toBeUndefined(); expect(parsed.GEMINI_API_KEY).toBeUndefined();
  });
  it("supports request-bound execution for free sleeping hosts", () => {
    expect(loadConfig({ NODE_ENV: "test", WORKER_MODE: "request" }).WORKER_MODE).toBe("request");
  });
});

describe("QueryGenerator", () => {
  it("generates bounded, targeted searches", () => {
    const queries = new QueryGenerator().generate({ name: "Alex Doe", job_title: "VP Sales", company: "Example", company_domain: "example.com", linkedin_url: "" }, ["partnerships"], 4);
    expect(queries).toHaveLength(4); expect(queries[0]).toContain('"Alex Doe"'); expect(queries[3]).toContain("revenue");
  });
});

describe("DuckDuckGo provider", () => {
  it("parses normal HTML results", () => {
    const html = `<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent("https://example.com/about?utm_source=ddg")}">Example</a><div class="result__snippet">Official company page</div></div>`;
    expect(new DuckDuckGoHtmlSearchProvider(config).parse(html, "Example", 5)).toEqual([{ query: "Example", title: "Example", url: "https://example.com/about", snippet: "Official company page", rank: 1 }]);
  });
  it("fails closed on challenge markup", async () => {
    const fakeFetch = async () => new Response("Unfortunately, bots use DuckDuckGo too.", { status: 202 });
    const provider = new DuckDuckGoHtmlSearchProvider(config, fakeFetch as typeof fetch);
    await expect(provider.search("Example", 2)).rejects.toMatchObject({ code: "SEARCH_PROVIDER_BLOCKED" });
  });
});

describe("CheerioParser", () => {
  it("removes boilerplate and extracts public signals", () => {
    const page = new CheerioParser().parse("https://example.com/about", `<html><head><title>Example</title><meta name="description" content="B2B software"></head><body><nav>Noise</nav><main><h1>Example</h1><p>Contact alex@example.com or +1 (212) 555-0199.</p><a href="https://github.com/example">GitHub</a></main><footer>Noise</footer></body></html>`);
    expect(page.text).not.toContain("Noise"); expect(page.signals.emails).toEqual(["alex@example.com"]); expect(page.signals.phones[0]).toContain("212"); expect(page.signals.social_links).toEqual(["https://github.com/example"]);
  });
});

describe("FactMerger", () => {
  const page = (url: string): ScoredPage => ({ url, title: "Source", description: "", headings: [], text: "", signals: { emails: [], phones: [], urls: [], dates: [], currencies: [], social_links: [] }, query: "q", rank: 1, relevance: .8, sourceQuality: .8 });
  it("boosts corroboration and preserves conflicts", () => {
    const output = new FactMerger().merge([
      { field: "company.industry", value: "Software", source_url: "https://example.com", source_title: "A", published_date: null, confidence: .7 },
      { field: "company.industry", value: "Software", source_url: "https://example.org", source_title: "B", published_date: null, confidence: .72 },
      { field: "company.industry", value: "Consulting", source_url: "https://example.net", source_title: "C", published_date: null, confidence: .6 },
    ], [page("https://example.com")], {});
    expect(output.facts).toHaveLength(2); expect(output.facts.find((fact) => fact.value === "Software")?.confidence).toBeCloseTo(.8); expect(output.facts.every((fact) => fact.conflict_group === "company.industry")).toBe(true);
  });
});

describe("ResearchStorage", () => {
  it("supports the queued job lifecycle", async () => {
    const store = new MemoryResearchStorage(); const request = ResearchRequestSchema.parse({ lead: { name: "Alex Doe", company: "Example" } });
    const created = await store.create(request); expect((await store.claim())?.status).toBe("running"); await store.fail(created.id, "TEST", "Expected"); expect(await store.get(created.id)).toMatchObject({ status: "failed", error: { code: "TEST" } });
  });
});
