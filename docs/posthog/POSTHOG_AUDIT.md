# PostHog audit

Audit date: 16 September 2026; validation finalized 19 September 2026
Existing project: **Outlio**, US region, project `612494`
Baseline dashboard: **Your starter dashboard**, resource `2102692`

## Executive summary

Outlio now has a privacy-first PostHog foundation in code: one typed event
catalog, stable internal user identity, workspace grouping, sanitized errors,
metadata-only Hubble telemetry, a same-origin ingestion proxy, and narrowly
gated session replay. Analytics failures are deliberately non-blocking.

Synthetic validation now proves browser and server ingestion, stable identity,
workspace grouping, UUID deduplication, sanitized exceptions, IP suppression,
and fully masked replay. This is implementation evidence, not a real-product
baseline: funnels, retention, alert thresholds, and customer behavior remain
unknown until approved rollout and sufficient non-synthetic traffic exist.

## Evidence-backed inventory

| Area | Status | Evidence |
| --- | --- | --- |
| Framework | PASS | Next.js `16.3.0`, React `19.2.4`, App Router; `package.json` |
| Browser SDK | PASS | `posthog-js` initialized in `instrumentation-client.ts` |
| Server SDK | PASS | `posthog-node` wrapper in `lib/posthog-server.ts` |
| Central event contract | PASS | `lib/analytics/catalog.ts`; schema tests in `tests/unit/analytics-catalog.test.ts` |
| Identity | PASS | Stable auth user UUID; no email/name/phone in PostHog identify calls |
| Workspace tenancy | PASS | Browser `group('workspace', id)` and server event `groups`; `ProductShell.tsx`, `lib/posthog-server.ts` |
| Reverse proxy | PASS | Same-origin `/ingest` rewrites in `next.config.ts`; app-host allowance in `proxy.ts` |
| Web analytics | PASS (synthetic) | Browser and server validation events received; current/session-entry URLs are query/fragment-free and IP is `0.0.0.0` |
| Session replay | PASS (synthetic) | Replay `01a0ab35-d62e-7575-8c64-12b49ef079df` visually inspected: text, links, and attributes masked; recording blocked on URLs with query/fragment |
| Error tracking | PASS (synthetic), PARTIAL production readiness | Sanitized browser/server exceptions received without injected email/token values; source-map resolution remains unverified |
| Release metadata | PARTIAL | Events include Vercel commit SHA when available; PostHog source-map upload is not configured |
| CI/CD | PASS | GitHub Actions run checks; Vercel deployment configuration exists |
| PostHog assets | PASS for validation dashboard, PARTIAL for alerts | `Outlio synthetic validation` dashboard `2113829` contains the requested validation views; `Analytics basics (wizard)` dashboard `2113797` contains five event-definition insights, including CRM activation `z0qtkSxw`; alert thresholds still need real traffic |
| Extended workflow coverage | IMPLEMENTED, live canary pending | Typed events now cover extractor terminal results, persisted exports, manual CRM contact creation/assignment, and opportunity creation/stage changes; no production/customer mutation was performed to manufacture rows |
| Consent/legal | PARTIAL | DNT respected, no PostHog persistence, privacy policy updated; jurisdiction-specific legal review remains owner/counsel work |
| Duplicate analytics | PASS | No second product analytics SDK found in the repository |

## Architecture reality

- Public website and authenticated SaaS are one Next.js repository.
- Auth is Supabase-based; the stable PostHog person key is the internal auth
  UUID, never an email address.
- Collaborative product areas use `workspaces` and `workspace_memberships`.
  Workspace IDs are the PostHog group keys.
- A browser extension submits extracted pages to the Next.js API; the accepted
  job is tracked, but raw HTML and scraped profile data are never tracked.
- Hubble performs search/fetch/LLM work. Only status, duration, aggregate call
  counts, cache use, stable user ID, and workspace ID are captured.
- Email, CRM, flows, billing checkout, extension ingestion, and Hubble are real
  repository features. Mobile is not present.

## Connected PostHog validation baseline

The project was initially empty on 16 September 2026. The authorized synthetic
run then established the following implementation baseline:

| Baseline | Observed value | Status |
| --- | ---: | --- |
| Browser/server delivery | Both channels visible | PASS |
| Stable person identity | Auth UUID on browser and server rows | PASS |
| Workspace grouping | Expected synthetic workspace UUID | PASS |
| Event deduplication | Two sends using UUID `fabfef7a-fbb3-4ad4-a0cc-4a4c21951683` produced one server row | PASS |
| Sanitized errors | Browser and server controlled exceptions visible without injected secret/email values | PASS |
| Replay privacy | Clean safe-route replay fully masked | PASS |
| Customer funnels/retention | No approved production baseline | UNKNOWN |
| Dashboards | Starter `2102692`; validation dashboard `2113829` with eight tiles; wizard dashboard `2113797` with five definition insights | PASS, with `$snapshot` query limitation |

Validation dashboard `2113829` contains environment, browser/server channel,
workspace, safe failure-code, Hubble outcome, Hubble-duration, replay-count, and
synthetic funnel views. The replay-count tile is a retained diagnostic: PostHog
returns no `$snapshot` product-analytics rows for this project even though
replay `01a0ab35-d62e-7575-8c64-12b49ef079df` exists and was visually inspected
in the Replay product. The replay itself, not an invented chart value, is the
authoritative validation evidence.

The fifth wizard insight, `z0qtkSxw`, defines the CRM activation funnel
`crm_contact_created` → `crm_opportunity_created` →
`crm_opportunity_stage_changed`. It is expected to remain empty until an
approved deployment and synthetic canary; no definition seeds were added for
these new events.

## Capability decisions

| Capability | Decision | Reason |
| --- | --- | --- |
| Product analytics | USE NOW | Directly measures activation and core workflows with low-volume explicit events |
| Web analytics | USE NOW | Public acquisition and signup path exist; URLs are sanitized |
| Session replay | USE NOW, restricted | Useful for friction, but only at 10% on low-risk overview routes with maximum masking |
| Error tracking | USE NOW | Product and server failures need correlation; payloads are sanitized |
| Dashboards | USE NOW | Synthetic events establish definitions; business charts must exclude synthetic traffic and thresholds must wait for real data |
| Feature flags | CONFIGURE LATER | No specific risky rollout was authorized; private key/server evaluation is not configured |
| Experiments | CONFIGURE LATER | No traffic baseline or powered hypothesis exists |
| Surveys | CONFIGURE LATER | Draft only after a decision and targeting rule exist; launching requires approval |
| AI observability | USE NOW, metadata-only | Hubble duration/outcome/call counts are useful; raw prompt/output is prohibited |
| PostHog `$ai_generation` traces | CONFIGURE LATER | Token/model metadata is not consistently exposed at the orchestration boundary yet |
| Logs | CONFIGURE LATER | Existing structured security/operational logs are authoritative; duplication has no proven value |
| Data warehouse | NOT APPLICABLE now | No approved reporting join requires database access from PostHog |
| Data pipelines/CDP | NOT APPLICABLE now | No approved destination or transformation need exists |
| PostHog MCP/AI | CONFIGURE LATER | No callable PostHog MCP was available; authenticated browser access supplied validation evidence |
| Self-driving | CONFIGURE LATER | Wizard advertises paid PR work; no spend or repository-write approval was given |
| Mobile analytics | NOT APPLICABLE | No mobile runtime exists in this repository |

## Principal risks and controls

| Risk | Before | Control now | Residual status |
| --- | --- | --- | --- |
| PII in identity | Email, name and phone were sent by identify | Only stable user ID plus plan/admin/role | PASS |
| Sensitive replay | Recording could start broadly or expose raw URL metadata | Disabled by default; exact allowlist + 10% sampling + full masking; query/hash URLs blocked; clean synthetic replay visually inspected | PASS for validation window |
| Query secrets in URLs | Default pageview URLs may contain queries | Query strings and fragments removed before send | PASS |
| Event drift | Raw string captures were scattered | Typed catalog, exact property allowlists, schema version, unit tests | PASS |
| Tenant orphaning | Workspace was only an event property | Browser and server workspace group binding | PASS for workspace-scoped events |
| Hubble data leakage | Potential prompt/output capture | Metadata-only custom events; PostHog Node privacy mode | PASS |
| Cost growth | Autocapture/replay could be high volume | Narrow autocapture, 10% replay, no bodies/headers/performance capture | PASS |
| Source-map opacity | Minified errors may be hard to diagnose | Release is attached; source-map upload still missing | PARTIAL |
| Worker event loss | Request-context `after()` is unavailable in standalone workers | Terminal extractor capture uses an explicit immediate mode and awaits the bounded SDK flush | PASS in code; live canary pending |

## Cost envelope

There is no traffic history, so this is a planning scenario, not observed
usage. At 1,000 monthly active users, assuming 50 safe page/autocapture events,
15 explicit business events, 5 Hubble events, and 10% replay sampling per user,
the expected order of magnitude is about **70,000 events and at most 100 sampled
users' safe-route recordings per month**. This is intentionally conservative.
Re-estimate after 14 days of ingestion; do not enable logs, broad replay, data
warehouse sync, experiments, or self-driving until actual volume and pricing
are reviewed.

## Performance envelope

The production build completed successfully. Two generated client chunks that
contain PostHog code total 527,951 bytes uncompressed and approximately 168,507
bytes gzipped; they also contain shared application code, so this is an upper
bound rather than an incremental SDK delta. Server delivery is scheduled with
Next.js `after`, so flushes do not delay action/route responses. Browser
persistence, performance capture, console capture, cross-origin iframe replay,
and replay network bodies/headers are disabled.

## External blockers

1. A PostHog private key/source-map upload secret has not been approved or
   configured.
2. Paid self-driving work is not approved.
3. No production deployment of this expanded audit implementation is allowed
   by the attached brief without a fresh explicit approval.
4. Hubble live execution was not performed because the safe validation runtime
   deliberately disabled paid provider keys; its event contract and privacy
   allowlist were verified statically.
5. Synthetic evidence proves transport and privacy controls but cannot establish
   customer conversion, retention, or alert baselines.
6. A fresh full UI journey requires a new synthetic credential handoff; the
   prior test credentials were intentionally ephemeral and were not retained.
