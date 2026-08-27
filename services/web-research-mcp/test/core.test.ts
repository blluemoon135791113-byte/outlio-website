import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { attributedPersonContacts, FactMerger } from "../src/facts.js";
import { resolveRedirectUrl } from "../src/fetcher.js";
import { OllamaExtractor, SemanticExtractorWaterfall } from "../src/gemini.js";
import { discoverOfficialContactUrls, LeadResearchPipeline } from "../src/pipeline.js";
import { CheerioParser } from "../src/parser.js";
import { QueryGenerator } from "../src/query-generator.js";
import { DuckDuckGoHtmlSearchProvider, FallbackSearchProvider, SearxngSearchProvider } from "../src/search.js";
import { MemoryResearchStorage } from "../src/store.js";
import { ResearchError, ResearchRequestSchema, type ScoredPage } from "../src/types.js";
import { normalizeUrl } from "../src/url.js";

const config = loadConfig({ NODE_ENV: "test", DDG_MIN_INTERVAL_MS: "250" });

describe("URLNormalizer", () => {
  it("unwraps DDG redirects and removes tracking", () => {
    const target = encodeURIComponent("https://www.example.com/a?utm_source=x&id=7#top");
    expect(normalizeUrl(`https://duckduckgo.com/l/?uddg=${target}`)).toBe("https://example.com/a?id=7");
  });

  it("preserves a redirect to the www host", () => {
    expect(resolveRedirectUrl("https://www.example.com/", "https://example.com")).toBe("https://www.example.com/");
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
  it("uses an explicit zero-charge SearXNG engine set", () => {
    expect(loadConfig({ NODE_ENV: "test" }).SEARXNG_ENGINES).toBe("yandex,bing,yep");
  });
  it("accepts Supabase REST storage only in request mode", () => {
    const parsed = loadConfig({ NODE_ENV: "production", WORKER_MODE: "request", MCP_BEARER_TOKEN: "a".repeat(24), SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "b".repeat(32) });
    expect(parsed.SUPABASE_URL).toBe("https://example.supabase.co");
  });
});

describe("QueryGenerator", () => {
  it("generates bounded, targeted searches", () => {
    const queries = new QueryGenerator().generate({ name: "Alex Doe", job_title: "VP Sales", company: "Example", company_domain: "example.com", linkedin_url: "" }, ["partnerships"], 4);
    expect(queries).toHaveLength(4); expect(queries[0]).toContain('"Alex Doe"'); expect(queries[2]).toContain("partnerships"); expect(queries[3]).toContain("technology");
  });

  it("prioritizes exact person and employer-domain contact searches", () => {
    const queries = new QueryGenerator().generate(
      { name: "Jamie Rivera", job_title: "Founder", company: "Fabricated Labs", company_domain: "fabricated.example", linkedin_url: "" },
      ["work_email", "mobile_phone"],
      4,
    );
    expect(queries).toEqual([
      'Jamie Rivera fabricated.example email',
      'site:fabricated.example "Jamie Rivera" email',
      'fabricated.example Jamie Rivera phone number',
      'Jamie Rivera fabricated.example phone WhatsApp',
    ]);
  });

  it("uses the larger contact budget for PDF, role, and contact-page searches", () => {
    const queries = new QueryGenerator().generate(
      { name: "Jamie Rivera", job_title: "Founder", company: "Fabricated Labs", company_domain: "fabricated.example", linkedin_url: "" },
      ["work_email", "mobile_phone"],
      8,
    );
    expect(queries).toHaveLength(8);
    expect(queries).toContain('"Jamie Rivera" "Fabricated Labs" filetype:pdf email');
    expect(queries).toContain('"Jamie Rivera" "Fabricated Labs" contact phone');
  });
});

describe("contact attribution", () => {
  const lead = { name: "Jamie Rivera", job_title: "Founder", company: "Fabricated Labs", company_domain: "fabricated.example", linkedin_url: "" };

  it("accepts a public person-shaped mailbox and nearby business phone", () => {
    expect(attributedPersonContacts(
      "Jamie Rivera — Founder at Fabricated Labs — email jamie@fabricated.example or call +44 20 7946 0958.",
      "https://fabricated.example/team/jamie-rivera",
      lead,
    )).toMatchObject({
      emails: ["jamie@fabricated.example"],
      phones: ["+44 20 7946 0958"],
    });
  });

  it("accepts a public Mexican business number attributed by person and employer", () => {
    expect(attributedPersonContacts(
      "Jamie Rivera — Founder at Fabricated Labs — phone number +52 55 6765 4571.",
      "https://directory.example/jamie-rivera",
      lead,
      true,
    ).phones).toEqual(["+52 55 6765 4571"]);
  });

  it("does not misattribute a generic company mailbox or unrelated contact", () => {
    expect(attributedPersonContacts(
      "Jamie Rivera — Founder at Fabricated Labs. Contact support@fabricated.example. Pat Lee: +44 20 7123 4567.",
      "https://fabricated.example/team",
      lead,
    )).toEqual({ emails: [], phones: [], socialProfiles: [] });
  });

  it("matches an abbreviated captured surname to a published full surname", () => {
    expect(attributedPersonContacts(
      "Muhritz Waheed — Founder at VeloxAura — email muhritz@veloxaura.example.",
      "https://veloxaura.example/team/muhritz-waheed",
      { name: "Muhritz W", job_title: "Founder", company: "VeloxAura", company_domain: "veloxaura.example", linkedin_url: "" },
    ).emails).toEqual(["muhritz@veloxaura.example"]);
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

describe("modular search fallback", () => {
  it("normalizes SearXNG JSON results", async () => {
    let requestedUrl = "";
    const fakeFetch = async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ results: [
        { title: "Jamie Rivera — Fabricated Labs", url: "https://fabricated.example/team?utm_source=search", content: "Email jamie@fabricated.example" },
      ] }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const provider = new SearxngSearchProvider(config, "http://127.0.0.1:8080", fakeFetch as typeof fetch);
    await expect(provider.search("Jamie Rivera", 5)).resolves.toEqual([{
      query: "Jamie Rivera",
      title: "Jamie Rivera — Fabricated Labs",
      url: "https://fabricated.example/team",
      snippet: "Email jamie@fabricated.example",
      rank: 1,
    }]);
    expect(new URL(requestedUrl).searchParams.get("engines")).toBe("yandex,bing,yep");
  });

  it("uses the next provider when the primary search is unavailable", async () => {
    const fallback = new FallbackSearchProvider([
      { search: async () => { throw new ResearchError("SEARCH_PROVIDER_ERROR", "primary unavailable", true); } },
      { search: async (query: string) => [{ query, title: "Fallback", url: "https://fabricated.example", snippet: "Result", rank: 1 }] },
    ]);
    await expect(fallback.search("Jamie Rivera", 5)).resolves.toEqual([
      expect.objectContaining({ title: "Fallback" }),
    ]);
  });
});

describe("CheerioParser", () => {
  it("removes boilerplate and extracts public signals", () => {
    const page = new CheerioParser().parse("https://example.com/about", `<html><head><title>Example</title><meta name="description" content="B2B software"></head><body><nav>Noise</nav><main><h1>Example</h1><p>Contact alex@example.com or +1 (212) 555-0199.</p><a href="https://github.com/example">GitHub</a></main><footer>Noise</footer></body></html>`);
    expect(page.text).not.toContain("Noise"); expect(page.signals.emails).toEqual(["alex@example.com"]); expect(page.signals.phones[0]).toContain("212"); expect(page.signals.social_links).toEqual(["https://github.com/example"]);
  });

  it("rejects citation sequences and numeric ids as phone numbers", () => {
    const page = new CheerioParser().parse("https://example.com", `<main>
      <p>Updated 2022.</p><p>1 2 3 4 5 6 7 8 9 10 11 12 13 14</p>
      <p>Reference 945172407995785216</p><p>Call +44 20 7946 0958.</p>
    </main>`);
    expect(page.signals.phones).toEqual(["+44 20 7946 0958"]);
  });

  it("keeps social profiles but rejects posts and status links", () => {
    const page = new CheerioParser().parse("https://example.com", `<main>
      <a href="https://x.com/example">Profile</a>
      <a href="https://x.com/example/status/123456789">Post</a>
      <a href="https://linkedin.com/in/example">LinkedIn</a>
      <a href="https://github.com/example/project/issues/1">Issue</a>
    </main>`);
    expect(page.signals.social_links).toEqual([
      "https://x.com/example",
      "https://linkedin.com/in/example",
    ]);
  });

  it("extracts obfuscated, mailto, tel, and JSON-LD contacts", () => {
    const page = new CheerioParser().parse("https://example.com/team/alex", `<html><head>
      <script type="application/ld+json">{"email":"alex.json@example.com","telephone":"+1 212 555 0188"}</script>
      </head><body><main><p>Alex Doe: alex [at] example [dot] com</p>
      <a href="mailto:alex.link@example.com">Email</a><a href="tel:+12125550199">Call</a></main></body></html>`);
    expect(page.signals.emails).toEqual(expect.arrayContaining([
      "alex@example.com",
      "alex.json@example.com",
      "alex.link@example.com",
    ]));
    expect(page.signals.phones).toEqual(expect.arrayContaining(["+1 212 555 0188", "+12125550199"]));
  });
});

describe("official contact discovery", () => {
  const page = (urls: string[]): ScoredPage => ({
    url: "https://fabricated.example",
    title: "Fabricated Labs",
    description: "",
    headings: [],
    text: "",
    signals: { emails: [], phones: [], urls, dates: [], currencies: [], social_links: [] },
    query: "official",
    rank: 1,
    relevance: .8,
    sourceQuality: .9,
  });

  it("keeps one-hop first-party people pages and rejects assets and external links", () => {
    expect(discoverOfficialContactUrls([
      page([
        "https://fabricated.example/team/jamie-rivera",
        "https://fabricated.example/assets/team.jpg",
        "https://directory.example/jamie-rivera",
      ]),
    ], "fabricated.example", "Jamie Rivera", new Set(["https://fabricated.example"]), 3)[0])
      .toBe("https://fabricated.example/team/jamie-rivera");
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
    expect(output.documents).toEqual([expect.objectContaining({ url: "https://example.com", text: "" })]);
  });
});

describe("local semantic extraction", () => {
  const page: ScoredPage = {
    url: "https://fabricated.example/about",
    title: "About Fabricated Labs",
    description: "",
    headings: [],
    text: "",
    signals: { emails: [], phones: [], urls: [], dates: [], currencies: [], social_links: [] },
    query: "Fabricated Labs industry",
    rank: 1,
    relevance: .9,
    sourceQuality: .9,
  };
  const lead = { name: "Jamie Rivera", job_title: "Founder", company: "Fabricated Labs", company_domain: "fabricated.example", linkedin_url: "" };

  it("uses Ollama structured output without a hosted API key", async () => {
    const requests: unknown[] = [];
    const fakeFetch = async (_input: string | URL | Request, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({
        message: { content: JSON.stringify({ facts: [{ field: "company.industry", value: "Software", confidence: .9 }] }) },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const extractor = new OllamaExtractor(
      loadConfig({ NODE_ENV: "test", OLLAMA_URL: "http://127.0.0.1:11434", OLLAMA_MODEL: "test-model" }),
      fakeFetch as typeof fetch,
    );
    await expect(extractor.extract(lead, page, "Fabricated Labs builds B2B software."))
      .resolves.toEqual([expect.objectContaining({ field: "company.industry", value: "Software", source_url: page.url })]);
    expect(requests[0]).toMatchObject({ model: "test-model", stream: false, format: { type: "object" } });
  });

  it("falls through when the local extractor is unavailable", async () => {
    const extractor = new SemanticExtractorWaterfall([
      { extract: async () => { throw new ResearchError("OLLAMA_ERROR", "offline", true); } },
      { extract: async () => [{ field: "company.industry", value: "Software", source_url: page.url, source_title: page.title, published_date: null, confidence: .8 }] },
    ]);
    await expect(extractor.extract(lead, page, "Software company"))
      .resolves.toEqual([expect.objectContaining({ value: "Software" })]);
  });
});

describe("ResearchStorage", () => {
  it("supports the queued job lifecycle", async () => {
    const store = new MemoryResearchStorage(); const request = ResearchRequestSchema.parse({ lead: { name: "Alex Doe", company: "Example" } });
    const created = await store.create(request); expect((await store.claim())?.status).toBe("running"); await store.fail(created.id, "TEST", "Expected"); expect(await store.get(created.id)).toMatchObject({ status: "failed", error: { code: "TEST" } });
  });
});

describe("LeadResearchPipeline", () => {
  it("returns deterministic evidence when Gemini is unavailable", async () => {
    const pipeline = new LeadResearchPipeline(
      loadConfig({ NODE_ENV: "test", MAX_QUERIES: "1", MAX_URLS: "1", MAX_GEMINI_CALLS: "1", RELEVANCE_THRESHOLD: "0" }),
      { search: async (query: string) => [{ query, title: "Example", url: "https://example.com/about", snippet: "Example", rank: 1 }] },
      { fetch: async () => ({ url: "https://example.com/about", html: "<main><h1>Alex Doe at Example</h1><p>Contact alex.doe@example.com for B2B software.</p></main>", status: 200, contentType: "text/html" }) },
      { extract: async () => { throw new ResearchError("GEMINI_ERROR", "quota", true); } },
    );

    const output = await pipeline.run(ResearchRequestSchema.parse({ lead: { name: "Alex Doe", company: "Example", company_domain: "example.com" } }));
    expect(output.documents).toHaveLength(1);
    expect(output.facts).toEqual(expect.arrayContaining([expect.objectContaining({ value: "alex.doe@example.com", contact_status: "publicly_found" })]));
    expect(output.meta.gemini_failures).toBe(1);
  });

  it("extracts attributed contacts from search snippets without fetching blocked social pages", async () => {
    const fetched: string[] = [];
    const pipeline = new LeadResearchPipeline(
      loadConfig({ NODE_ENV: "test", MAX_QUERIES: "1", MAX_URLS: "2", MAX_GEMINI_CALLS: "0", RELEVANCE_THRESHOLD: "0" }),
      { search: async (query: string) => [{
        query,
        title: "Jamie Rivera — Founder, Fabricated Labs",
        url: "https://linkedin.com/in/jamie-rivera",
        snippet: "Jamie Rivera leads Fabricated Labs. Business email jamie@fabricated.example and WhatsApp +44 20 7946 0958.",
        rank: 1,
      }] },
      { fetch: async (url: string) => {
        fetched.push(url);
        return { url, html: "<main><h1>Fabricated Labs</h1></main>", status: 200, contentType: "text/html" };
      } },
      { extract: async () => [] },
    );

    const output = await pipeline.run(ResearchRequestSchema.parse({
      lead: { name: "Jamie Rivera", company: "Fabricated Labs", company_domain: "fabricated.example" },
      requested_fields: ["work_email", "mobile_phone"],
    }));
    expect(fetched).toContain("https://fabricated.example");
    expect(fetched.some((url) => url.includes("linkedin.com"))).toBe(false);
    expect(output.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "person.emails", value: "jamie@fabricated.example", source_url: "https://linkedin.com/in/jamie-rivera", contact_status: "publicly_found" }),
      expect.objectContaining({ field: "person.phones", value: "+44 20 7946 0958", source_url: "https://linkedin.com/in/jamie-rivera", contact_status: "publicly_found" }),
    ]));
  });

  it("fetches the supplied official domain even when search ranks a directory first", async () => {
    const fetched: string[] = [];
    const pipeline = new LeadResearchPipeline(
      loadConfig({ NODE_ENV: "test", MAX_QUERIES: "1", MAX_URLS: "2", MAX_GEMINI_CALLS: "0", RELEVANCE_THRESHOLD: "0" }),
      { search: async (query: string) => [{ query, title: "Directory", url: "https://directory.example/company", snippet: "Example", rank: 1 }] },
      { fetch: async (url: string) => { fetched.push(url); return { url, html: "<main><h1>Example</h1><p>Official B2B software.</p></main>", status: 200, contentType: "text/html" }; } },
      { extract: async () => [] },
    );

    await pipeline.run(ResearchRequestSchema.parse({ lead: { name: "Alex Doe", company: "Example", company_domain: "example.com" } }));
    expect(fetched[0]).toBe("https://example.com");
    expect(fetched).toContain("https://directory.example/company");
  });

  it("follows a bounded official team link for contact research", async () => {
    const fetched: string[] = [];
    const pipeline = new LeadResearchPipeline(
      loadConfig({ NODE_ENV: "test", MAX_QUERIES: "1", MAX_URLS: "3", MAX_GEMINI_CALLS: "0", RELEVANCE_THRESHOLD: "0" }),
      { search: async () => [] },
      { fetch: async (url: string) => {
        fetched.push(url);
        return url.endsWith("/team/jamie-rivera")
          ? { url, html: '<main><h1>Jamie Rivera — Founder at Fabricated Labs</h1><p>Email jamie@fabricated.example</p></main>', contentType: "text/html" }
          : { url, html: '<main><h1>Fabricated Labs</h1><a href="/team/jamie-rivera">Leadership</a></main>', contentType: "text/html" };
      } },
      { extract: async () => [] },
    );

    const output = await pipeline.run(ResearchRequestSchema.parse({
      lead: { name: "Jamie Rivera", company: "Fabricated Labs", company_domain: "fabricated.example" },
      requested_fields: ["work_email"],
    }));
    expect(fetched).toContain("https://fabricated.example/team/jamie-rivera");
    expect(output.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "person.emails", value: "jamie@fabricated.example" }),
    ]));
    expect(output.meta.official_pages_discovered).toBeGreaterThan(0);
  });

  it("still reads a supplied official domain when search is challenged", async () => {
    const pipeline = new LeadResearchPipeline(
      loadConfig({ NODE_ENV: "test", MAX_QUERIES: "1", MAX_URLS: "1", MAX_GEMINI_CALLS: "0", RELEVANCE_THRESHOLD: "0" }),
      { search: async () => { throw new ResearchError("SEARCH_PROVIDER_BLOCKED", "challenge"); } },
      { fetch: async (url: string) => ({ url, html: "<main><h1>Example</h1><p>Official B2B software.</p></main>", status: 200, contentType: "text/html" }) },
      { extract: async () => [] },
    );

    const output = await pipeline.run(ResearchRequestSchema.parse({ lead: { name: "Alex Doe", company: "Example", company_domain: "example.com" } }));
    expect(output.documents).toEqual([expect.objectContaining({ url: "https://example.com" })]);
    expect(output.meta.search_failures).toEqual([expect.objectContaining({ error: "SEARCH_PROVIDER_BLOCKED" })]);
  });
});
