# Outlio production optimization audit

Audit date: 2026-09-16
Scope: repository at `/Users/husnainrafiq/outlio` plus the supplied 76-phase audit brief
Status vocabulary: **PASS**, **PARTIAL**, **FAIL**, **NOT APPLICABLE**, **UNKNOWN**

## Executive result

The application already had unusually strong tenant isolation, database constraints, idempotent billing/event processing, bounded worker retries, server-side pagination, route loading states, and security headers. This pass preserved those systems and fixed the material gaps found by repository inspection:

- removed O(N) campaign counts and O(2N) flow counts with two workspace-scoped aggregate RPCs;
- added the missing trigram index for company contains-search;
- introduced request/correlation IDs at the edge and in the public API audit log;
- added a 15-second FastSpring API timeout and a 15-minute cache for public catalogue prices;
- corrected public-asset cache semantics, deferred GTM, removed fake search-verification tokens, and stopped emitting artificial sitemap freshness;
- completed private-route `noindex`, app-host robots exclusions, a host-aware 404, skip navigation, dialog focus containment, and mobile drawer keyboard behavior;
- replaced two hot-path raster payloads (3.0 MB and 1.5 MB) with 167 KB and 23 KB WebP files;
- removed current lint warnings from source and excluded generated extension bundles from source linting.

Production telemetry, Search Console ownership, managed database pool settings, and credentialed third-party end-to-end flows cannot be proven from the repository. They are explicitly marked below rather than guessed.

## Architecture map

| Layer | Current implementation | Evidence |
|---|---|---|
| Frontend/backend | Next.js 16.3 App Router with React 19 Server Components, Server Actions, and route handlers | `package.json`, `app/`, `node_modules/next/dist/docs/` |
| Deployment | One Vercel deployment serves `outlio.io` and `app.outlio.io`; Proxy performs host-aware rewrites and auth refresh | `proxy.ts`, `vercel.json`, `docs/HANDOFF.md` |
| Database/query layer | Managed Supabase PostgreSQL via `@supabase/supabase-js`/PostgREST and SQL RPCs; no ORM | `lib/supabase/server.ts`, `lib/supabase/admin.ts`, `supabase/migrations/` |
| Authentication | Supabase Auth cookies refreshed by Next 16 Proxy; route-level authorization remains the boundary | `proxy.ts`, `lib/auth/access.ts` |
| Tenant isolation | Workspace context/permissions, RLS policies, composite tenant constraints, and service-role queries scoped in application/RPC code | `lib/workspaces/context.ts`, `lib/workspaces/permissions.ts`, migrations 0070+, `tests/e2e/tenant-isolation.spec.ts` |
| Storage | Supabase Storage for uploads, exports, and avatars; signed URLs and ownership filters | `lib/upload/`, `lib/worker/process-job.ts`, `lib/profile/avatar.ts` |
| Caching | Next route/static caching plus a bounded public FastSpring price cache; mutable CRM data intentionally uncached | `lib/fastspring/pricing.ts`, `next.config.ts` |
| Jobs/queues | PostgreSQL queue/claim RPCs and a bounded worker tick; `pg_cron` calls `/api/cron` every five minutes | `lib/workers/tick.ts`, `lib/worker/`, migrations 0013, 0117–0119, `app/api/cron/route.ts` |
| Email | SMTP/IMAP providers, durable messages/events/enrollments, reply sync, suppressions, and readiness checks | `lib/email/`, migrations 0085–0094 |
| Billing | FastSpring Store Builder/API/webhook; durable receipt/charge/credit ledgers and transactional RPCs | `app/api/webhooks/fastspring/route.ts`, `lib/fastspring/`, migrations 0068–0069 |
| Integrations | Google OAuth/Drive/Sheets, GoHighLevel, Clay, Calendly, signed outbound webhooks, Chrome/Firefox extension | `lib/integrations/`, `app/api/integrations/`, `app/api/webhooks/calendly/`, `extensions/` |
| AI/research | Hubble and intelligence routes with provider controls, SSRF-safe fetchers, budgets, and merge steps | `lib/hubble/`, `lib/intelligence/`, `app/api/hubble/`, `app/api/intelligence/` |
| Public API | `/api/v1/*` routes share API-key auth, scopes, rate limits, tenant derivation, capped pagination, and audit logging | `lib/api/handler.ts`, `lib/api/keys.ts`, `app/api/v1/` |
| Analytics | Google Tag Manager loaded after hydration | `app/layout.tsx` |
| CDN/images | Vercel/Next fingerprinted static chunks, `next/image`, AVIF/WebP negotiation, revalidatable public assets | `next.config.ts`, image components |
| Public routes | Agency: `/`, `/explainers`, `/terms`, `/privacy`; app host: `/`, `/product`, `/how-it-works`, `/pricing`, legal pages | `proxy.ts`, `app/sitemap.ts` |
| Authenticated routes | `/dashboard`, `/crm`, `/email`, `/flows`, `/linkedin`, `/extension`, `/join` | `app/(product)/`, `proxy.ts` |
| Admin routes | `/admin` and admin-only server checks/actions | `app/admin/`, `lib/admin/`, `lib/auth/access.ts` |

### Request/data flow

`Browser → Vercel/Next Proxy (host routing, session refresh, request ID) → Server Component/Action/Route Handler → Supabase RLS client or explicitly scoped service-role client → PostgreSQL/Storage`

Background path: `pg_cron → /api/cron → bounded worker tick → queue claim RPC → idempotent effect/ledger → durable run status`.

## Decisions made

### ADR-OPT-001: cache only public pricing data

- **Context:** FastSpring localized prices were fetched repeatedly, while CRM/report data is mutable and tenant-owned.
- **Decision:** Cache each product/country pair for 15 minutes with `unstable_cache`; keep final checkout authoritative and tenant data uncached.
- **Consequence:** Fewer third-party calls without cross-workspace cache risk. Display price may lag a catalogue edit by at most 15 minutes.

### ADR-OPT-002: aggregate list counts in SQL

- **Context:** campaigns issued one count query per row; flows issued two.
- **Decision:** Add workspace-scoped aggregate RPCs rather than counter columns.
- **Consequence:** Constant query count and no counter drift/write amplification. Counts remain calculated from source rows.

### ADR-OPT-003: propagate correlation IDs at Proxy

- **Context:** server errors and `api_request_log` rows could not be joined to a caller-visible response.
- **Decision:** validate/preserve an upstream ID or generate a UUID; forward it, return it as `X-Request-Id`, and persist it for public API requests.
- **Consequence:** Support can trace new requests without exposing secrets. Historical rows remain null because no caller-visible ID existed to correlate; avoiding a table rewrite keeps deployment safe.

## Database findings and changes

- Existing migrations already cover tenant/date/status foreign-key paths, contact name/email trigram search, contact sort, queue claims, uniqueness, and append-only billing/email event ledgers.
- Fixed N+1 sites: `app/(product)/email/campaigns/page.tsx` and `app/(product)/flows/page.tsx` now call `email_campaign_enrollment_counts` and `flow_run_counts` once per page.
- Added `crm_companies_name_trgm_idx` for `ILIKE '%term%'` in `app/api/crm/quick-search/route.ts`. It is partial on `deleted_at is null`; the write cost is one additional GIN update on company writes. The transaction-compatible build should run in a low-write window because it temporarily blocks company writes.
- Added `api_request_log_request_id_idx` for incident lookup. This is one small index write per public API request.
- No production `EXPLAIN (ANALYZE, BUFFERS)` was run: this workspace has no authorized production/staging database target in scope. Plans and pool settings remain external verification.

## 76-phase status ledger

| # | Area | Status | Evidence / disposition |
|---:|---|---|---|
| 1 | Map application | PASS | Architecture map above; `app/`, `lib/`, `proxy.ts`, migrations inspected. |
| 2 | Database performance | PARTIAL | Indices/RPCs in migrations 0080, 0112, 0143; large lists are paged. Production query plans and managed pool values remain unverified. |
| 3 | Idempotency | PASS | migrations 0029, 0068–0069, 0086, 0097, 0102; webhook/API/worker tests. |
| 4 | Caching | PASS | Public pricing cached in `lib/fastspring/pricing.ts`; mutable tenant data intentionally uncached. |
| 5 | Server caching | PASS | Same bounded public cache; no tenant-shared key introduced. |
| 6 | CDN | PASS | `next.config.ts` uses hashed Next assets and revalidatable stable public filenames. |
| 7 | Images | PASS | `next/image`; new 23 KB/167 KB WebPs; responsive dimensions and lazy defaults. |
| 8 | JavaScript | PASS | App Router route splitting; Three.js dynamically imported in `components/leadengine/`; production build gate. |
| 9 | Re-renders | PARTIAL | Effects/callbacks inspected; no broad context issue found. No production React Profiler trace was available. |
| 10 | Debounce/throttle | PASS | Command palette uses 220 ms debounce plus abort in `components/product/CommandPalette.tsx`; scroll work is rAF-throttled in `app/components/Nav.tsx`. |
| 11 | API payloads | PASS | `/api/v1` routes select explicit fields and cap pages via `lib/api/handler.ts`. |
| 12 | Request deduplication | PASS | Abort/stale-query protection in command palette and intelligence hooks; worker claims prevent duplicate execution. |
| 13 | Loading experience | PASS | product/CRM loading files, error boundary, and explicit component loading/empty/error states. |
| 14 | Lazy loading | PASS | Route splitting plus runtime Three.js imports; no critical content made client-lazy. |
| 15 | Third-party scripts | PASS | GTM uses `next/script` with `afterInteractive` in `app/layout.tsx`. |
| 16 | Dependencies/dead code | PASS | Direct dependencies are referenced; source lint warnings removed; generated `extensions/dist` excluded in `eslint.config.mjs`. |
| 17 | Core Web Vitals | PARTIAL | Fonts swap, stable image dimensions, deferred GTM, compressed hero assets; field p75 data is unavailable. |
| 18 | Lighthouse | UNKNOWN | No browser Lighthouse binary or deployed authenticated test session was available. |
| 19 | Indexing strategy | PASS | Public/private separation in metadata, product layout, robots, and sitemap. |
| 20 | Titles | PASS | Route metadata and host-specific root metadata supply distinct public titles. |
| 21 | Descriptions | PASS | Public page/root metadata contains page-specific descriptions. |
| 22 | Canonicals | PASS | Host-aware root/page alternates and clean sitemap routes. |
| 23 | URL structure | PASS | Existing routes retained; old `/leadengine/*` URLs have permanent redirects in `next.config.ts`. |
| 24 | Sitemap | PASS | `app/sitemap.ts` is host-aware, public-only, and no longer fabricates `lastModified`. |
| 25 | Robots | PASS | `app/robots.txt/route.ts` is host-aware and excludes app/auth/API paths without treating robots as authorization. |
| 26 | Search Console | PARTIAL | Sitemap/canonical/HTTPS/indexability ready; fake verification tokens removed. Ownership verification is external. |
| 27 | Structured data | PASS | Valid Organization/SoftwareApplication JSON-LD via `lib/json-ld.ts`; no invented reviews. |
| 28 | Social previews | PASS | host-specific Open Graph/Twitter fallbacks in `app/layout.tsx`. |
| 29 | Alt text | PASS | meaningful/decorative image usages inspected; QR and content images are labeled. |
| 30 | Heading hierarchy | PASS | Public pages use one primary H1 and semantic section headings. |
| 31 | Internal linking | PASS | Nav/footer/product CTAs connect canonical public routes without artificial link blocks. |
| 32 | Broken links | PASS | 404 `/how` and wrong-host dashboard links fixed; redirects/static route scan cover removed URLs. |
| 33 | 404 | PASS | `app/not-found.tsx` is host-aware, useful, and rendered through Next's not-found mechanism. |
| 34 | Mobile | PARTIAL | Responsive CSS/table overflow/dialog sizing present; automated width smoke is recorded below, but physical-device testing remains external. |
| 35 | Accessibility | PARTIAL | Skip link/targets, semantics, labels, tables, focus traps and live feedback present. Manual screen-reader/contrast sampling remains required. |
| 36 | Interaction states | PARTIAL | Shared controls have hover/active/focus/disabled patterns; exhaustive visual-state review requires manual UI traversal. |
| 37 | Password visibility | PASS | accessible toggle implementation in the shared password field/auth forms. |
| 38 | Mobile menu | PASS | Escape, focus return/containment, scroll lock, navigation close, `aria-expanded` in product/marketing navigation. |
| 39 | Dark mode | NOT APPLICABLE | No supported dark design system; not forced into this audit. |
| 40 | Site search | NOT APPLICABLE | Public site is small; product CRM search exists, is debounced, bounded, and trigram-backed. |
| 41 | FAQ | PASS | Native keyboard-accessible `details`/`summary` plus crawlable copy in `app/page.tsx`. |
| 42 | Floating contact | NOT APPLICABLE | No existing need; intrusive widget intentionally not added. |
| 43 | UTM attribution | NOT APPLICABLE | GTM can observe campaign parameters, but no consented first/last-touch product store is specified. Canonicals exclude query parameters. |
| 44 | Updated dates | NOT APPLICABLE | No blog/resource publishing model; artificial freshness removed from sitemap. |
| 45 | Copy controls | PASS | API-key/referral copy controls use clipboard with success/error feedback. |
| 46 | Print styles | NOT APPLICABLE | Export routes cover reports/data; full dashboard print CSS has no established use case. |
| 47 | Confirmation | PASS | typed/explicit confirmation exists for destructive contact, workspace, campaign, integration, job, and bulk actions. |
| 48 | Newsletter | NOT APPLICABLE | No newsletter product; none added. |
| 49 | Sticky header | PASS | responsive sticky product and public navigation, with guarded scroll behavior. |
| 50 | Scroll progress | NOT APPLICABLE | No long-form publishing experience requiring it. |
| 51 | Link security | PASS | `_blank` anchors/forms use `noopener noreferrer`; source links are validated. |
| 52 | HTTPS | PASS | HSTS/CSP/secure-cookie configuration in `next.config.ts`, Proxy, and Supabase clients. |
| 53 | Forms | PASS | server validation, pending controls, accessible labels, and structured feedback across auth/settings/product forms. |
| 54 | Duplicate submissions | PASS | client pending locks plus database/RPC idempotency for critical effects. |
| 55 | Rate limiting | PASS | shared public API limiter, signup/IP gates, AI/provider budgets, and bounded search. |
| 56 | Background jobs | PASS | durable queues/claims, bounded tick and pg_cron scheduling for extraction, email, flows, webhooks, reports. |
| 57 | Retries | PASS | bounded exponential backoff/jitter and retry classification in integrations, workers, messages, webhooks. |
| 58 | Timeouts | PASS | external HTTP calls carry timeouts; FastSpring timeout added in `lib/fastspring/server.ts`. |
| 59 | Transactions | PASS | billing/credit/merge/claim multi-step invariants live in SQL RPCs and migrations. |
| 60 | Uniqueness | PASS | provider event IDs, email messages, flow idempotency, contacts/integrations and ledger keys enforced in migrations. |
| 61 | Error handling | PASS | `app/(product)/error.tsx`, safe API errors, recovery/empty/error UI; no raw stack responses. |
| 62 | Observability | PARTIAL | durable worker/API/webhook/security logs and diagnostics exist; no external frontend crash/RUM product is configured in code. |
| 63 | Logging | PASS | structured contextual logs avoid tokens/payment bodies; security/log tables are durable. |
| 64 | Correlation IDs | PASS | `proxy.ts`, `lib/api/handler.ts`, `lib/api/keys.ts`, migration 0143, and proxy test. |
| 65 | Webhooks | PASS | FastSpring signature/schema/receipt/idempotency/ledger flow; durable outbound retry ledger with stable event ID. |
| 66 | Billing/credits | PASS | server-authoritative append-only grants/transactions and unique provider-event protection in migrations 0029/0068/0069. |
| 67 | Tenant isolation | PASS | workspace-derived API auth, RLS, explicit service-role scopes, composite constraints, tenant tests. |
| 68 | Search performance | PASS | contact/email/company trigram indexes and bounded quick-search results. |
| 69 | Large tables | PASS | CRM lists are server-paginated/capped, so thousands of DOM rows are not rendered; virtualization is not currently needed. |
| 70 | Performance budget | PASS | `docs/performance-budget.md`. |
| 71 | SEO/app separation | PASS | public sitemap/metadata; inherited private noindex and auth. |
| 72 | Backlink strategy | PASS | `docs/seo-growth-opportunities.md`; no automated link creation. |
| 73 | Production build | PASS | `npm run build` verification recorded below. |
| 74 | Responsive testing | PARTIAL | seven-width overflow smoke recorded below; credentialed product pages and physical devices remain external. |
| 75 | Regression testing | PARTIAL | type/lint/unit/build and available integration checks recorded below; live OAuth, email, billing, and provider flows need credentials/sandbox. |
| 76 | Final audit table | PASS | final-state table below. |

## Final audit table

| Area | Original state | Final state | Evidence | Impact |
|---|---|---|---|---|
| DB indexes | Company contains-search lacked a matching index | Partial trigram GIN added; existing tenant/list indexes retained | migration 0143, migrations 0080/0112 | Removes company full scans at scale |
| N+1 queries | Campaign list N queries; flow list 2N queries | One aggregate query per list | migration 0143 and both list pages | Constant DB round trips |
| Pagination | Major CRM/API paths already bounded | Preserved; no client-side bulk pagination introduced | `lib/crm/contacts-list.ts`, `lib/api/handler.ts` | Bounded memory/DOM/query work |
| API payloads | Explicit selections and caps already present | Preserved; correlation header added | `app/api/v1/`, `lib/api/handler.ts` | Small responses, support traceability |
| Caching | FastSpring display price fetched repeatedly | Public product/country cache, 15-minute revalidation | `lib/fastspring/pricing.ts` | Lower latency/provider load |
| Images | 3.0 MB unoptimized workflow PNG; 1.5 MB raw CSS texture | 167 KB and 23 KB WebP; optimizer restored | WebP files and updated references | Roughly 4.3 MB source-payload reduction |
| JS bundle | Route splitting and dynamic Three already present; GTM inline | GTM after interactive; splitting preserved | `app/layout.tsx`, Three components, build | Less render-path script work |
| SEO indexing | Most route metadata correct; product default/robots incomplete | private inherited noindex plus app robots exclusions | product layout, robots route | Lower private-route crawl risk |
| Metadata | Fake verification placeholders present | removed; host metadata retained | `app/layout.tsx` | No fabricated ownership signal |
| Sitemap | `lastModified` changed on every request | artificial freshness removed | `app/sitemap.ts` | Honest crawler signals |
| Robots | App host allowed every private path | explicit app/auth/API disallows | robots route | Better crawl-budget hygiene |
| Mobile | Responsive foundation existed | product drawer now traps/returns focus and locks scroll | `components/product/ProductShell.tsx` | Usable keyboard/mobile navigation |
| Accessibility | No global skip link; palette focus could escape | skip link/targets and dialog/menu focus containment | root layout, global CSS, shell/palette | WCAG keyboard-navigation improvement |
| Idempotency | Strong ledgers/unique constraints already present | preserved and documented | migrations 0029, 0068–0069, 0086, 0097 | Duplicate-safe critical effects |
| Webhooks | Signed/durable/idempotent processing already present | preserved; correlation improves diagnosis | webhook routes, migrations 0068/0097 | Reliable retries without duplicate effects |
| Multi-tenancy | Strong RLS/context/tests already present | aggregate RPCs repeat workspace scope | migration 0143, tenant tests | No cache/RPC cross-tenant leak |
| Billing | Transactional FastSpring/credit ledgers already present | API timeout and public-price cache added | FastSpring libraries/migrations | Bounded provider waits; safer UX |
| Core Web Vitals | No field evidence; oversized raster and blocking GTM found | assets/scripts improved; field status remains unknown | asset sizes, `next/script`, budget doc | Likely LCP/FCP improvement, not claimed as measured |

## Verification record

The completion run records exact outcomes here after implementation:

- `npm run typecheck` — PASS.
- `npm run test:unit` — PASS (226 files / 3,908 tests).
- `npm run lint` — PASS with zero warnings; the pre-fix run exposed 104 warnings, mainly generated extension bundles plus source/test warnings, which were removed or correctly ignored.
- `npm run build` — PASS; 86 pages generated and the production route manifest completed without build errors.
- Migration 0143 apply + smoke — PASS on an isolated local PostgreSQL 16 cluster, including service-role RPC execution, request-ID default, and index existence. Docker was unavailable, so the repository harness was reproduced with the installed PostgreSQL 16 binaries.
- Responsive smoke — PASS at 375, 390, 430, 768, 1024, 1440, and 1920 px across agency home/explainers, app home/pricing/product/how-it-works/sign-in. It asserted HTTP status, no document overflow, H1, skip target, 404 status, host-aware robots, and sitemap exclusions.
- Isolated staging regression slice — PASS (5 files / 66 tests): tenant isolation, workspace tenancy, flow engine, webhook delivery, and Hubble credit safety.

## Remaining risks / external actions

1. Apply migration `0143_optimization_audit_hardening.sql` before deploying code that invokes its RPCs or inserts `request_id` through generated types.
2. Verify Supabase pool size, idle timeout, database CPU/IO, and `EXPLAIN (ANALYZE, BUFFERS)` for the new aggregates/company search against staging-scale data.
3. Run Lighthouse and capture production field CWV after deployment; local build evidence cannot establish p75 outcomes.
4. Complete Search Console ownership with a real provider-issued token; do not restore placeholders.
5. Run credentialed smoke tests for auth email delivery, Google/GHL OAuth, SMTP/IMAP, FastSpring sandbox checkout/webhook replay, and AI providers in their dedicated environments.
6. Manual screen-reader and physical-device checks remain necessary even though static/keyboard foundations were improved.
