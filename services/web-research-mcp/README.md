# Outlio Web Research MCP

A standalone MCP service that queues public-web research jobs and exposes stateless Streamable HTTP tools:

- `web_search` — return normalized public search-result metadata for Hubble's existing fetch/evidence pipeline.
- `research_lead` — run bounded full research without creating an MCP-owned job; Hubble owns the durable queue and canonical persistence.
- `research_start` — validate a lead and queue a durable job.
- `research_run` — run and persist research in one bounded request for free hosts that sleep.
- `research_status` — inspect queued/running/completed/failed state.
- `research_result` — retrieve source-preserving structured research.
- `research_latest` — retrieve the latest result persisted for a tenant-scoped Outlio lead.

The search layer is modular. Docker Compose now starts a private SearXNG
instance as the primary metasearch service, with DuckDuckGo's public HTML
result page as a fallback. It never attempts to bypass CAPTCHAs, bot
challenges, logins, paywalls, or restricted social platforms. When every
configured search provider refuses a request, the search fails closed.

Contact research uses a larger but still bounded query ladder, follows up to
four relevant first-party team/about/leadership/contact pages, and extracts
normal, obfuscated, `mailto:`, `tel:`, JSON-LD, and public social-profile
signals in code. Middle-name omission and surname initials are handled without
weakening company association. Matching facts from independent hosts receive a
confidence boost; no search result is automatically labelled verified.

Outlio production calls `research_lead` from its existing Postgres-backed
`research_job_queue`. The MCP's queued tools remain available for standalone
use, but Hubble must not enqueue the same run in both systems. `research_lead`
returns cleaned evidence documents and sourced facts; it never returns raw HTML.

## Run locally

```bash
cp .env.example .env
npm install
npm run dev
```

The MCP endpoint is `POST /mcp`; health is `GET /health`. Local development may use in-memory jobs. Production startup requires both `DATABASE_URL` and a bearer token of at least 24 characters. Send `tenant_id` and `lead_id` together on `research_start` to upsert the completed bundle for later Hubble/RAG reads.

Set `WORKER_MODE=request` on a sleeping free web host and call `research_run`; `research_start` deliberately returns `BACKGROUND_WORKER_DISABLED` in that mode so jobs cannot remain silently queued. Keep the default `background` mode only where an always-on process is available.

## Strict no-charge deployment

For a deployment that cannot create a cloud bill, leave Google Cloud billing
unlinked. Run SearXNG and Ollama locally, leave `GEMINI_API_KEY` blank, and keep
`OUTLIO_ALLOW_PAID_PROVIDERS=false` in the main app. The MCP then performs
search, fetching, contacts, and semantic extraction without a metered vendor.
If Ollama is absent it degrades to deterministic code-only extraction. Free
cloud services may sleep, throttle, or suspend at their limits; this design
prioritizes zero financial exposure over uptime.

## Production gate

Deploy first to the intended host, submit one harmless test lead, and confirm the configured search provider returns ordinary result metadata from that host. An operator-owned SearXNG instance is the recommended zero-charge primary provider. DuckDuckGo HTML remains a fallback; do not automate around a challenge.

Recommended topology: HTTPS ingress/load balancer → this stateless MCP API and worker replicas → PostgreSQL. Keep Gemini and database secrets server-side. Autoscale conservatively because DuckDuckGo searches are intentionally paced.

The included `Dockerfile` runs as a non-root user and exposes a container health check. For a complete local stack, first create `services/web-research-mcp/.env` with two random secrets:

```bash
MCP_BEARER_TOKEN=<random 32-byte hex value>
SEARXNG_SECRET=<different random 32-byte hex value>
OLLAMA_URL=http://host.docker.internal:11434
OLLAMA_MODEL=qwen3:4b
```

Then run `docker compose up --build -d`. On a machine with Ollama installed,
pull the configured model once before starting the stack. Leave `OLLAMA_URL`
blank for code-only mode. SearXNG is available only on
`http://127.0.0.1:8080`; the MCP remains on `http://127.0.0.1:8787`.

The Compose database is local-development-only. Hosted deployments should use a managed PostgreSQL database, HTTPS ingress, a generated bearer token, and the appropriate `DATABASE_SSL_MODE`.

## Data policy

- Fetch only public HTTP(S) pages and reject private/reserved DNS targets on every redirect.
- LinkedIn and other login-oriented social hosts are never fetched.
- Code extracts emails, phones, URLs, dates, currencies, and social links before any model call.
- Gemini is used only for semantic extraction from relevant, bounded chunks.
- Contact data found in public page text is `publicly_found`, never automatically `verified`.
- Contradictory sourced facts remain in the output with a `conflict_group`.
