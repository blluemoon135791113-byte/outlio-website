@AGENTS.md

# CLAUDE.md — Outlio

Persistent project rules. Loaded automatically every session so constraints
survive context compaction across a multi-session build.

**Full specification:** `docs/IMPLEMENTATION_PROMPT.md`
**Current state:** `docs/PROGRESS.md` — **read this before writing any code.**
**Parser contract:** `docs/SELECTOR_MAP.md` — the field source of truth.

---

## What this project is

An existing Next.js + TypeScript marketing site for **Outlio**, being extended
with a private SaaS application. Approved customers upload HTML files they
manually saved from LinkedIn Sales Navigator search-result pages; the app parses
them into a de-duplicated, exportable lead database.

It is a **file processor**, not a crawler.

---

## Hard rules — never violate

1. **No LinkedIn automation.** No requests to `linkedin.com` from our servers, no
   headless browser, no Playwright/Puppeteer/Selenium, **no automated navigation
   of any kind** — no clicking Next, opening profiles, messaging, connecting or
   changing filters, and no anti-detection, stealth or CAPTCHA-bypass code.
   **Revised 2026-08-11:** input is a page the user opened themselves, arriving
   by one of exactly two routes — a file they upload, or a page captured by the
   browser extension during a session they explicitly started. The extension
   observes; the user navigates. Outside an active session it reads nothing.

   **Revised 2026-09-03 — owner decision, broader fetching permitted.** Outlio
   may fetch pages from sources beyond the company's own site in order to find
   contact details. The owner was shown this rule and the exposure below, and
   chose to widen it.

   **What did NOT change, and why:**
   - **No CAPTCHA solving and no bot-detection evasion.** Not a moral line — a
     commercial one. Those are what get an IP range and a sending domain
     blocklisted, and Outlio sells email deliverability. Losing it would break
     the product that pays for the scraping.
   - **No LinkedIn credential login** (rule 2 stands, unrevised). Holding a
     customer's LinkedIn password is a breach liability with no upside; the
     extension already covers pages they are signed in to.
   - **Node, not Python.** The standing runtime decision is unchanged, so
     Scrapling is not a dependency. Equivalent extraction runs on the existing
     `cheerio` parser and `lib/hubble/fetch`.

   **Exposure the owner accepted, stated once and not re-litigated:** target-site
   ToS, and GDPR Art. 14 — which requires notifying a person whose personal data
   was collected without their knowledge, within a month.
2. **No LinkedIn credentials or cookies** collected, stored, transmitted, or
   logged — ever. Strip them if present in uploaded HTML.
3. **Never render uploaded HTML in a browser.** No `dangerouslySetInnerHTML`, no
   `innerHTML`, no `iframe srcdoc`. Parsing is server-side only.
4. **Never fabricate lead data.** Missing value → `NULL` + a missing-data
   indicator. No inference, no LLM gap-filling.
   See `docs/UNSUPPORTED_FIELDS.md`.

   **Revised 2026-09-03:** enrichment from external sources is now permitted
   (see rule 1), but the anti-fabrication rule is **unchanged and load-bearing**:
   a value may only be stored if it was **literally observed** somewhere, and the
   evidence row naming the provider and URL is kept as its citation. Synthesising
   `first.last@company.com` from a name and a domain is still forbidden — it
   looks right, it is often right, and when it is wrong nobody can tell.
   `lib/crm/evidence-bridge.ts` is where this is enforced for contact details.
5. **Do not modify the existing landing page.** Read-only reference. Only
   permitted change: promoting a hardcoded value into the shared theme, and only
   after flagging it.
6. **No secrets in source.** `SUPABASE_SERVICE_ROLE_KEY` is server/worker only and
   never prefixed `NEXT_PUBLIC_`.
7. **No stubs.** No `// TODO: implement`, no fake functions. If you can't finish
   it, say so and leave it unstarted.
8. **Authorization is server-side.** Hiding a button is not access control.
9. **RLS on every table.** No exceptions.
10. **Never commit a real saved page.** `.gitignore` blocks them. Fixtures are
    fabricated only.

---

## Decisions already made — do not re-litigate

| Decision | Value |
|---|---|
| Package manager | **npm** (not pnpm — the spec is wrong) |
| Product URL | **`outlio.io/dashboard`** via `app/(product)/dashboard/` |
| Admin URL | `outlio.io/admin` |
| Scraper | **Ported to TypeScript + cheerio.** The original `.exe` is obsolete. |
| Worker runtime | **Node.** No Python service. Spec §11.4 does not apply. |
| Database | Supabase, project `ptewhpmxzenbmxlizxhu` |
| Supabase paths | `lib/supabase/` (not Supabase's suggested `utils/supabase/`) |
| Anon key env var | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| `Notes` / `Date Entered` | **Dropped.** Removed from LinkedIn's DOM. |
| Name + URL | **Separate columns.** Never fused into `=HYPERLINK()`. |
| Edge guard file | **`proxy.ts`** — Next 16 renamed `middleware`. Function must be `proxy`. |
| Rate limiting | **Postgres**, not Upstash/Redis. Fails **open** by design. |
| Access decision | Pure function in **`lib/auth/decide.ts`**; `access.ts` only gathers inputs. |
| Worker trigger | **pg_cron → `/api/cron` every 5 minutes** (migration 0118). `after()` still nudges the tick after a launch so the first send is immediate. GitHub Actions (`.github/workflows/cron.yml`) is a backstop only — measured at one run per ~193 minutes, never the 5 it asks for. |
| Scheduler health | `worker_runs` (0117) takes one row per tick; `/admin` reports staleness. `scheduler_diagnostics()` (0119) exposes `cron.job` / `net._http_response`, which PostgREST cannot reach. |

**Worker deployment (revised 2026-08-07, at ~5 users):** the processor is a plain
library (`lib/worker/`). It is triggered by `after()` from the upload action
today and by a long-running loop later. `job_queue`, `FOR UPDATE SKIP LOCKED`,
claims, attempts and backoff are identical in both. **Never inline extraction
into a request handler's response path** — the point of the queue is that jobs
survive the browser closing, and a stale-claim reaper must always exist.

---

## The parser

**Source of truth: `docs/SELECTOR_MAP.md` §3.** Never the recovered Python.

`Linkedin Sales Navigator Scraper SaaS/recovered/scraper_gui_recovered.py` is
frozen evidence. **Never import it at runtime.** Its selectors are dead.

Two traps:

1. **`div[data-anonymize="job-title"]` is NOT the job title.** It holds tenure
   text and fails silently. Real titles: `span[data-anonymize="title"]`.
2. **Anchor only on `data-anonymize`.** Ember IDs (`id="ember####"`) and CSS-module
   hashes (`_lockup-column_wpvxyb`) change every LinkedIn deploy.

A zero-lead result is `ERR_FILE_FORMAT` — **a loud error, never a silent empty
success.** LinkedIn has already broken this parser once.

---

## Working protocol

- **One phase per session.** Stop at the end of a phase and report.
- **Phases 0, 1, 2 are gates.** Phases 0 and 1 are ✅ complete.
- **Update `docs/PROGRESS.md`** at the end of every phase.
- **When uncertain, stop and ask** with `BLOCKER: <summary>` + options +
  trade-offs + your recommendation. Do not guess.
- **Never advance with a failing build.**
- **No unrequested files.** No speculative abstractions, no per-directory READMEs.

---

## Architecture

```
Next.js on Vercel  →  UI, auth, uploads, reads, admin.  NEVER runs the parser.
Postgres job_queue →  claimed with FOR UPDATE SKIP LOCKED.
Node worker        →  separate long-running container. No public inbound HTTP.
Supabase Storage   →  private bucket. Signed URLs only, 60s TTL.
```

Extraction never runs inside a request handler. Jobs must survive the user
closing the browser.

---

## Design rules

Source of truth: `docs/DESIGN_TOKENS.md`.

- **Inherit unchanged:** the 8 color tokens, font variables, focus ring.
- **Must add (missing today):** radius scale, shadow scale, **status colors**
  (success/warning/danger/info), border token. Add once to `@theme`.
- **Adapt:** type scale down one step, 8px spacing rhythm, flat backgrounds on
  authenticated surfaces (gradient/aurora only on sign-in/sign-up/access),
  motion ≤150ms.
- **No entrance animations** on upload, jobs table, or leads table. Never use
  `Reveal.tsx` inside the product.
- **No `backdrop-filter`** on dashboard surfaces.
- **Zero hardcoded colors.** No `#hex`, `rgb()`, `hsl()` in a color position.
- Every screen ships designed **loading**, **empty**, and **error** states.
- No dark mode exists. Do not add one without a decision.

---

## Code conventions

- **App Router**, npm, TypeScript `strict`. Path alias `@/*` → repo root.
- Server Components by default; `'use client'` only where interactivity requires.
- Three Supabase clients: `lib/supabase/client.ts` (browser), `server.ts`
  (RSC/actions), `admin.ts` (service role, server-only).
  **The service role bypasses RLS — every service-role query must scope by
  `user_id` in code.**
- All access decisions go through `lib/auth/access.ts`. Nothing else decides access.
- All plan limits come from `plans.limits` JSONB at runtime. **Never hardcode.**
- Validate every external input with Zod: request bodies, parser output, webhooks.
- One shared `sanitizeCell()` in `lib/export/sanitize.ts` used by both CSV and
  XLSX writers. Formula-injection defense lives there and nowhere else.
- Errors use the typed catalog in `lib/errors/catalog.ts`. Users see friendly
  copy; logs get detail. Never return a stack trace, SQL, storage path, or
  internal ID to the client.
- Never log full lead records, file contents, tokens, signed URLs, or cookies.

---

## Security non-negotiables

- Storage keys are server-generated: `{user_id}/{job_id}/{uuid}.html`.
  **Never derive a path from a user-supplied filename.**
- Validate uploads by content sniffing, not extension or declared MIME.
- Temp directories removed in a `finally` block, always. Orphan sweep on startup.
- Rate-limit auth, upload, export, and admin routes.
- Every state-changing admin action writes an `admin_audit_logs` row **in the same
  transaction**. Audit logs are append-only.
- There is no self-service path to `admin`.

---

## Test fixtures

`tests/fixtures/html/` contains **fabricated data only** — invented names,
`example.com` domains, `linkedin.com/sales/lead/fabricated-N` URLs.

**Never commit a real saved page or any real person's data.**

Required hostile fixtures: empty file, binary renamed `.html`, deeply nested
`<div>` bomb, HTML containing `<script>`, results page with zero results, and a
lead whose name is `=cmd|'/c calc'!A1`.

---

## Commands

```bash
npm run dev              # Next.js app
npm run lint             # eslint
npm run build            # next build
npm run typecheck        # tsc --noEmit
npm test                 # vitest, unit project only — fast, no network
```

Slower, and not part of the default loop:

```bash
npm run test:integration # hits the real Supabase project — serial
npm run test:e2e         # Playwright, staging only
npm run db:types         # regenerate types/database.ts after a migration
```

Migrations are applied **by hand in the Supabase SQL editor**, never by an
agent. Validate one first against a throwaway Postgres:

```bash
scripts/check-migration.sh supabase/migrations/0117_worker_runs.sql
```

---

## Cost-Aware Agent Orchestration

Project-level subagents live in `.claude/agents/`. They exist to route routine,
bounded, or read-only work to a cheaper model without sacrificing correctness.
This section only governs *how agents are used*; it does not change any rule
above it.

### Default execution flow

For meaningful engineering tasks:

1. Understand the task.
2. Use the built-in **Explore** agent for repository discovery — file
   location, dependency tracing, "where does X happen". Do not create a
   custom Explore agent; the built-in one already covers this.
3. Use **docs-auditor** when documentation or setup accuracy is in question.
4. Produce clear acceptance criteria before implementing.
5. Use **feature-implementer** for approved, scoped implementation.
6. Run **verification-reviewer** after implementation.
7. Run **product-risk-reviewer** for changes touching auth, tenant scoping,
   money, migrations, email sending, or anything user-facing with real
   consequences.
8. Resolve findings; rerun verification after fixes.
9. Give a final ship / no-ship recommendation.

### Model routing

| Model | Use for |
|---|---|
| **Haiku** | Repository discovery, documentation checks, bounded read-only searches, deterministic verification |
| **Sonnet** | Normal feature implementation, bug fixes, refactors, product/risk review, non-trivial tests |
| **Opus** (`architecture-advisor`) | Difficult architecture, ambiguous production failures, security-sensitive design, large migrations, conflicting reviewer findings, or repeated failure by cheaper agents — never the default |

Do not reach for Opus because it might produce a marginally nicer answer.

### Do not duplicate work

Do not have multiple agents independently implement the same feature to
compare outputs. Parallel dispatch is for independent research, independent
verification, and independent risk review — not competing implementations.

### Context control

Give each subagent only the task-specific context it needs: acceptance
criteria and targeted file references, not entire directories or full logs.

### Human approval boundary (restates existing rules above, does not relax them)

Never, regardless of which agent is running:

- deploy to production (`vercel deploy --prod`, `supabase db push` against
  production)
- run a destructive database operation or delete significant data
- run an irreversible migration without the owner's explicit go-ahead
- send external messages, rotate secrets, change production credentials,
  spend money, or push to a remote branch without being asked to in that
  session

Local coding, testing, linting, type checking, building, and reading files do
not require re-approval once the task is already requested.

### Task sizing

- **Trivial** (typo, one-line fix): handle directly, no subagent ceremony.
- **Small** (localized bug, small component): Explore if needed →
  feature-implementer → verification-reviewer.
- **Medium** (multi-file feature, integration): Explore → acceptance criteria
  → feature-implementer → verification-reviewer → product-risk-reviewer.
- **High risk** (auth, billing, tenant isolation, sensitive data, destructive
  migration, secrets, concurrency): Explore → plan → architecture-advisor if
  genuinely warranted → feature-implementer → verification-reviewer →
  product-risk-reviewer. Opus is an escalation, not the starting point.

### Repository specifics for agents to use

- Package manager: **npm** (`package-lock.json` present — never suggest pnpm/yarn).
- Commands: `npm run typecheck`, `npm run lint`, `npm test` (unit, fast),
  `npm run test:integration` (hits real Supabase — slower, serial),
  `npm run test:e2e` (Playwright, staging only), `npm run build`,
  `npm run db:types` (regenerate Supabase types after a migration).
- Two tenancy models coexist: `workspace_id` (64 tables) and `user_id`
  (42 tables). Scoping to the wrong one is a silent empty-result bug, not an
  error.
- Server actions are public HTTP endpoints. Every exported action must gate
  (`assertWorkspacePermission`/`assertAdmin`/`assertAccess`) **and** be called
  from somewhere outside its own file — this repo has repeatedly shipped
  gated actions with zero callers.
- Never fabricate data (CLAUDE.md rule 4, above) — this applies to agent output
  too, not just application code.
