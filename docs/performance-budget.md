# Outlio performance budget

Last reviewed: 2026-09-16

This budget covers the public marketing surfaces on `outlio.io`, the public Lead Engine surfaces on `app.outlio.io`, and the authenticated product. It is a release guardrail, not a reason to cache tenant data or remove useful UI.

## User-facing targets

| Metric | Public pages | Authenticated product | Measurement |
|---|---:|---:|---|
| LCP p75 | < 2.5 s | < 2.5 s on overview/list pages | Production RUM or Lighthouse on representative hardware |
| INP p75 | < 200 ms | < 200 ms | Production RUM |
| CLS p75 | < 0.10 | < 0.10 | Production RUM or Lighthouse |
| Server response p95 | < 800 ms | < 800 ms for ordinary pages | Vercel/server logs |
| Public API p95 | < 500 ms excluding caller network | < 800 ms for aggregate reports | `api_request_log.duration_ms` |
| Simple database query p95 | < 200 ms | < 200 ms | Supabase query telemetry / `EXPLAIN (ANALYZE, BUFFERS)` in staging |
| Heavy report query p95 | < 800 ms | < 800 ms | Staging plan plus production telemetry |
| Initial compressed JS | < 200 KB per public route | < 300 KB per product route | production build output / browser transfer sizes |
| Largest above-fold image transfer | < 250 KB | < 250 KB | Browser network panel with image optimization enabled |
| Initial requests before load | < 45 | < 60 | Browser network panel |

## Hard release checks

- `npm run lint`, `npm run typecheck`, `npm run test:unit`, and `npm run build` must exit successfully.
- The key widths 375, 390, 430, 768, 1024, 1440, and 1920 px must have no document-level horizontal overflow on `/`, `/pricing`, `/product`, `/how-it-works`, sign-in, and representative authenticated list/detail screens.
- No CSS background or `unoptimized` image referenced by a public page may exceed 250 KB without a written exception.
- Public list/search endpoints must have a bounded page size. Large CRM data remains server-paginated; virtualization is required only if a page intentionally renders more than 200 rows.
- A query that adds an index must include the served predicate/order and its write/storage tradeoff in the migration.
- Field Core Web Vitals and p95 latency are deployment measurements. A local build is necessary evidence, but cannot be used to claim those production targets are met.

## Regression response

1. Identify the route, device class, and changed asset/query from build, RUM, or request-log evidence.
2. Fix the measured bottleneck. Do not globally disable animation, image quality, caching, or product functionality.
3. Re-run the release checks and record any intentional budget exception here with an owner and expiry date.

## Current exceptions and unknowns

- Production field Core Web Vitals and Lighthouse results were not available in this workspace on 2026-09-16. They remain an external verification item.
- Supabase pool size and idle-timeout values are managed project settings rather than repository configuration; verify them in the Supabase dashboard before a major concurrency increase.
