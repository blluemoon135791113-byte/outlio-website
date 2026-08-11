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
2. **No LinkedIn credentials or cookies** collected, stored, transmitted, or
   logged — ever. Strip them if present in uploaded HTML.
3. **Never render uploaded HTML in a browser.** No `dangerouslySetInnerHTML`, no
   `innerHTML`, no `iframe srcdoc`. Parsing is server-side only.
4. **Never fabricate lead data.** Missing value → `NULL` + a missing-data
   indicator. No inference, no enrichment, no LLM gap-filling.
   See `docs/UNSUPPORTED_FIELDS.md`.
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
| Worker trigger | **`after()` on Vercel** for now — no container, no cost. Queue semantics unchanged. Swap to a long-running loop when scale demands. |

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
npm run dev          # Next.js app
npm run lint
npm run build
```

**Missing and required before Phase 3 gates can pass:**

```bash
npm run typecheck    # "tsc --noEmit"  — NOT YET ADDED
npm test             # Vitest          — NOT YET INSTALLED
```
