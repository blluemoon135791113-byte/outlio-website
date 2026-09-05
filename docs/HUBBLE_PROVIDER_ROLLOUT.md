# Hubble provider rollout

An API key in `.env.local` is not an integration. A provider is ready only when
Hubble has an adapter, a registry position, contract tests, a live smoke test,
and measured cost/coverage data.

## Current roles

| Capability | Preferred path | Fallbacks |
| --- | --- | --- |
| Planning/reasoning | `LLM_PROVIDER` | Gemini → Groq → OpenRouter → Cerebras → Backboard circuit-breaker chain |
| Existing evidence search | Postgres lexical/vector retrieval | Meilisearch only after the capacity gate in `docs/HUBBLE_RESEARCH_ARCHITECTURE.md` |
| Live web search | SearXNG | Google CSE → Brave → Tavily |
| Browser extraction | direct HTTP first | Crawl4AI, with a hard per-question cap |
| Company facts | Wikidata | Companies House → SEC EDGAR → domain discovery → USAspending |
| Funding/news | SearXNG | Tavily → GDELT |
| Technology | DNS | PageSpeed |
| Contact details | Prospeo | Apollo; add Hunter only after a coverage/cost benchmark |
| Embeddings | Ollama `nomic-embed-text` | lexical BM25 when unavailable |

Never run Solr, Elasticsearch, and Meilisearch as three parallel indexes. The
accepted research architecture keeps Postgres as the current retrieval store
and permits Meilisearch as the single future read index only after a measured
capacity gate. Likewise,
do not call Crawl4AI, Firecrawl, Jina, and Apify for every URL. Direct HTTP is
first, one browser renderer is the bounded fallback, and another service is
introduced only when a benchmark proves incremental coverage.

## Environment audit

Keys currently consumed by Hubble include Gemini, Groq, OpenRouter, Cerebras,
Backboard, SearXNG, Ollama, Tavily, Companies House, GitHub, PageSpeed, Prospeo,
Apollo, Google Maps, Supabase, Solr, and Crawl4AI settings documented in
`.env.example`.

The following present keys do not currently have Hubble adapters:

- `APIFY_API_TOKEN`
- `ELASTICSEARCH_API_KEY`
- `EXA_API_KEY`
- `FIRECRAWL_API_KEY`
- `HUNTER_API_KEY`
- `JINA_API_KEY`
- `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`
- `MEILISEARCH_API_KEY`
- `TED_EU`
- `GELT_API_KEY` — likely intended to mean GDELT; GDELT's current adapter uses
  its open API and requires no key.

Recommended next adapters, in order:

1. Langfuse observability, with prompts, lead PII, emails, and secrets redacted.
2. Exa as an optional web/domain-discovery provider, measured against SearXNG
   and Tavily rather than called unconditionally.
3. Hunter as a contact-email fallback, after a 10-company incremental coverage
   and cost benchmark.
4. Firecrawl or Jina only if Crawl4AI misses a measured class of pages.
5. Apify only for a named actor and named dataset that the existing path cannot
   obtain reliably.

## Test gates

### 1. Offline gate — required on every change

```bash
npm run typecheck
npm run lint -- --quiet
npx vitest run tests/unit
```

Target: all tests pass; no live calls and no provider credit is consumed.

### 2. Operator-service gate — required after deployment/config changes

```bash
RUN_HUBBLE_SERVICES=1 \
  npx vitest run tests/integration/hubble-services-live.test.ts
```

This proves SearXNG JSON search, Ollama embeddings, a Solr index/query/delete
round trip, and Crawl4AI rendering. The Solr artifact is uniquely named and is
removed in `finally`.

### 3. Free live-provider gate

```bash
RUN_LIVE_PROVIDERS=1 OUTLIO_ALLOW_PAID_PROVIDERS=false \
  npx vitest run tests/integration/providers-live.test.ts
```

This validates real public providers and the LLM planner while forcibly keeping
metered research providers out of the registry.

### 4. Paid-provider benchmark — deliberate, staging only

```bash
RUN_PROVIDER_BENCHMARK=1 BENCHMARK_SAMPLE=10 \
  OUTLIO_ALLOW_PAID_PROVIDERS=true \
  npx vitest run tests/integration/provider-benchmark.test.ts
```

Do not begin with the benchmark's larger default sample. Measure 10 known leads,
inspect success/not-found/error/timeout separately, then increase to at most 25.
Order providers by cost per incremental valid result, not raw coverage.

### 5. Staging end-to-end gate

Run one known lead and one 10-lead list through these questions:

- “What is this company's official website?”
- “Which companies raised a Series A in the last 12 months?”
- “Find SaaS companies hiring SDRs.”
- “Just give me the founders' work email addresses.”

For every run verify:

- every factual claim has a source URL;
- unavailable data is labelled unknown with the real reason;
- no provider is called after all requested fields are satisfied;
- scheduled batches survive the browser closing;
- no secret or raw provider error is present in tool-call records;
- single-lead research stays inside its request budget;
- list research respects the selected scope and 25-lead cap.

## Deployment sequence

1. Run the offline gate.
2. Deploy only the enabled acquisition services (currently Crawl4AI/SearXNG)
   to an always-on host with enough memory. Do not deploy Solr, Elasticsearch,
   Redis Search, or Meilisearch for the current Postgres-backed retrieval path.
3. Use authenticated HTTPS service URLs in the production environment. Never
   use `127.0.0.1` in Vercel; it points back to the Vercel function itself.
4. Run the operator-service gate against staging.
5. Run the free live-provider gate.
6. Run the 10-company paid benchmark only after confirming account quotas.
7. Update `INTELLIGENCE_PROVIDER_ORDER` from the benchmark.
8. Release to a small user cohort and watch provider error rate, unknown-field
   rate, source coverage, p50/p95 latency, calls per answered field, and cost per
   completed run before widening rollout.
