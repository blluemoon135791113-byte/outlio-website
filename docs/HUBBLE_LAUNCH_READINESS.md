# Hubble launch readiness

Updated: 2026-08-23

## Request path

`cache → plan → search → fetch/render → chunk → retrieve → synthesize → validate → save`

The 90-second per-lead budget now protects the final 25 seconds from search
and crawling. Local synthesis is sliced into bounded attempts so it cannot
consume the hosted fallback window.

## Required production variables

At least one configured LLM is required. Pin the selected model in production
even though code defaults exist, so a deployment cannot drift silently.

| Capability | Required variables | Launch status |
| --- | --- | --- |
| Hosted synthesis | `LLM_PROVIDER`, one of `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `CEREBRAS_API_KEY`, `BACKBOARD_API_KEY` | Present in Vercel: Gemini selected |
| Pinned Gemini | `GEMINI_MODEL=gemini-3.6-flash` | Recommended; default passed live test |
| Live search | `SEARXNG_URL`, `SEARXNG_AUTH_TOKEN` | Present in Vercel |
| Search fallback | `TAVILY_API_KEY` and/or Google CSE/Brave variables | Tavily present in Vercel |
| Database/cache | existing Supabase public URL/key and service-role key | Present in Vercel |

## Optional operator services

These improve cost, latency, or coverage but are not allowed to take Hubble
down. Hubble falls back to database/BM25 retrieval and direct HTTP extraction.

| Service | Variables | Safety rule | Current status |
| --- | --- | --- | --- |
| Solr | `SOLR_URL`, `SOLR_COLLECTION`, plus bearer or basic auth | Remote must be authenticated HTTPS | Adapter complete; not configured in Vercel |
| Crawl4AI | `CRAWL4AI_URL`, `CRAWL4AI_API_TOKEN` | Remote must be authenticated HTTPS | Adapter complete; not configured in Vercel |
| Ollama embeddings | `OLLAMA_URL`, optional `OLLAMA_AUTH_TOKEN`, `OLLAMA_EMBED_MODEL`, `OLLAMA_EMBED_DIMENSIONS` | Remote must be authenticated HTTPS; loopback may omit token | Local model passed at 768 dimensions |
| Ollama synthesis | above plus `OLLAMA_LLM_MODEL` | Opt-in; cloud-suffixed models refused | Keep disabled for launch on the tested 6.7B model |

The Oracle host has approximately 954 MiB RAM and already runs SearXNG. Do
not add Solr's JVM and Crawl4AI's browser there: doing so risks taking the
working search service down. Put them on a host with at least 4 GiB RAM, or
launch without them until that host exists.

## Three-cycle evidence

### Cycle 1 — deadline and degraded mode

- Retrieval now stops 25 seconds before the overall deadline.
- Failure states distinguish missing configuration, exhausted budget,
  provider outage, invalid output, and no evidence.
- Raw crawled fragments are no longer presented as a generated answer.
- Retrieved sources remain visible and reusable.

### Cycle 2 — quality and reuse

- A factual answer must cite an in-range evidence passage.
- Garbled schema output, JSON fragments, and evidence fences are rejected.
- Presentation cleanup removes control characters and broken punctuation
  spacing without rewriting facts.
- Fresh relevant evidence from two independent pages suppresses repeat search.
- Every attempted model records vendor, model, safe failure detail, and latency.

Live result: Gemini produced a clean, corroborated, two-source answer in about
4.5 seconds.

### Cycle 3 — fallback and launch gates

- The installed local 6.7B model failed to answer within 30 seconds and starved
  the hosted fallback. The waterfall was changed to bounded 8-second local
  slices with a protected hosted window.
- Re-test passed through the same waterfall in about 20.8 seconds.
- Local Ollama embeddings passed in about 1.3 seconds.
- `npm run lint -- --quiet`: passed.
- `npm run build`: passed.
- Unit suite: 68 files and 954 tests passed after the final security patch.
- Free live-provider suite: 9 tests passed. It also exposed empty news/funding
  coverage and unavailable tech providers for that sample; passing transport
  tests must not be mistaken for acceptable coverage.

## Final gates

```bash
npm run typecheck
npm run lint -- --quiet
npx vitest run tests/unit
npm run build

RUN_HUBBLE_LLM=1 \
  npx vitest run tests/integration/hubble-llm-live.test.ts

RUN_LIVE_PROVIDERS=1 OUTLIO_ALLOW_PAID_PROVIDERS=false \
  npx vitest run tests/integration/providers-live.test.ts

# Only after Solr, Crawl4AI, SearXNG, and Ollama URLs are reachable:
RUN_HUBBLE_SERVICES=1 \
  npx vitest run tests/integration/hubble-services-live.test.ts
```

Do not mark operator services ready merely because a URL is present. Their live
round-trip tests must pass from the same network environment as the app.
