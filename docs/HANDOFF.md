# Outlio — Handoff

**Written:** 2026-09-01 · **HEAD:** `93902d3` on `platform-m1-workspaces`
(also pushed to `main`, which is what Vercel deploys)

Read this with `CLAUDE.md` (hard rules), `docs/PROGRESS.md` (the Ledger — the
full chronological record) and `docs/OUTLIO_FUNCTIONAL_GAP_MATRIX.md`.

---

## 1. What this project is

A Next.js + TypeScript marketing site for **Outlio**, extended with a private
SaaS sales platform. Customers upload HTML they saved from LinkedIn Sales
Navigator (or capture it via a browser extension during a session they start
themselves), and it becomes a de-duplicated lead database, a CRM, an email
outreach system, an automation engine, and reporting.

**It is a file processor, not a crawler.** No requests to linkedin.com from our
servers, ever. See `CLAUDE.md` for the ten hard rules — they are not negotiable
and several exist because the alternative is legal exposure.

---

## 2. Current state in one paragraph

M0–M9 (the original build) are complete. R0–R14 (the "functional expansion"
repair pass) are partly complete: **R0, R1, R3, R4, R5, R6, R8, R9, R10, R11,
R12, R14 are done**; R2 is half done; R7, R13, R15–R19 are not started.

The product now works end to end for CRM and email. It did not two days ago,
for reasons described in §5, and understanding those reasons matters more than
anything else in this document.

**Verification as of HEAD:** 2,288 unit tests passing · integration suite 410
passing / 3 failing (all KI7, known) / 24 skipped (7 are deliberate opt-in
"live" suites) · `tsc --noEmit` 0 errors · `npm run lint` 0 errors, 96
pre-existing warnings · `npm run build` clean.

---

## 3. Architecture

```
Next.js on Vercel  →  UI, auth, uploads, reads, admin. NEVER runs the parser.
proxy.ts           →  edge guard. Decides what the software domain serves.
Postgres job_queue →  claimed with FOR UPDATE SKIP LOCKED.
lib/workers/tick.ts→  every background job, run on a schedule (§4).
Supabase Storage   →  private bucket, signed URLs only, 60s TTL.
```

### Decisions that are settled — do not re-litigate

| Decision | Value |
|---|---|
| Package manager | **npm** |
| Product URL | `outlio.io/dashboard` via `app/(product)/` |
| Scraper | Ported to TypeScript + cheerio. The `.exe` is obsolete. |
| Worker runtime | **Node.** No Python service. |
| Database | Supabase, project `ptewhpmxzenbmxlizxhu` |
| Supabase clients | `lib/supabase/{client,server,admin}.ts` |
| Edge guard | **`proxy.ts`** — Next 16 renamed `middleware`. Function must be `proxy`. |
| Rate limiting | Postgres, not Redis. Fails **open** by design. |
| Access decisions | Pure function in `lib/auth/decide.ts`; `lib/workspaces/permissions.ts` for workspace roles |
| Scheduling | GitHub Actions every 5 min + Vercel daily floor (§4) |
| Vercel plan | **Hobby (free)** — this constrains real things |

### Layering that matters

- **Engines** live in `lib/` and are pure of HTTP. They are well tested.
- **Server actions** live beside their route in `app/(product)/.../actions.ts`
  and do permission checks, then call engines.
- **`assertWorkspacePermission(permission)`** is the gate. Everything
  state-changing calls it first.
- ⚠️ **The service role bypasses RLS.** Every service-role query must scope by
  `workspace_id` **in code**. An id arriving in a form is a *claim*, not
  authorisation — verify it belongs to the caller's workspace before using it.

---

## 4. Scheduling — read before touching anything background

`/api/cron` runs `runTick()`, which runs **every** background job: reap stale
email claims → send queued email → sync replies → advance waiting flows →
deliver webhooks.

**Two schedulers, deliberately:**

| Scheduler | Cadence | Role |
|---|---|---|
| `.github/workflows/cron.yml` | every 5 min | **the real one** |
| `vercel.json` | daily 06:00 UTC | a floor if the Action is disabled |

**Vercel Hobby allows one cron invocation per day.** That is why the real
schedule lives in GitHub Actions. The Vercel entry is not redundant — if the
Action is disabled or its secret rotates, the queue still drains once a day
instead of never.

`CRON_SECRET` must be identical in **Vercel env vars** and **GitHub Actions
secrets**. The route **fails closed**: a missing secret refuses every request.
Full detail in `docs/SCHEDULING.md`.

⚠️ `CRON_SECRET` must contain **no newlines**. A deploy failed because two
`openssl rand -base64 32` outputs were pasted together — Vercel injects it into
an HTTP header and refuses the deployment. Use `openssl rand -hex 32`.

---

## 5. The defect class that dominated this work

**Code that is correct, tested, and never called.** It appeared in four
distinct shapes, and every one shipped to production:

1. **Dead workers (R10).** `runSendWorker`, `syncWorkspaceReplies`,
   `reapExpiredClaims`, `deliverPendingWebhooks`, `claimWaitingRuns` had **zero
   callers**. No cron, no `after()`, no `vercel.json`. A launched campaign never
   sent. Replies were never fetched. Webhooks never delivered. Flows that hit a
   WAIT never resumed.
2. **Stranded engines (R1/R4/R5).** `createPipeline`, `createOpportunity`,
   `ingestExtractionJob`, `runCsvImport`, `buildImportPlan`, `undoBatch` — built
   in M2/M3, tested, no caller. Customers could not create a pipeline or a deal,
   and could not get a contact list into the CRM.
3. **Stranded database functions (R14).** `email_mailbox_report` — written and
   tested in M7, never read.
4. **Dead triggers (R8).** 17 flow trigger types; **one** ever fired. A customer
   could publish a flow and watch it never run, with no error, because nothing
   had gone wrong — nothing had happened at all.

**Why nothing caught it:** unit tests, `tsc` and `next build` all pass whether
or not anything calls the code. Coverage was strong at the **engine** layer and
absent at the **wiring** layer.

### The guards that now exist — keep them

`tests/unit/worker-wiring.test.ts` asserts:

- every background worker has a caller;
- the tick is reachable from an API route;
- both schedulers exist, and the secret travels in a header not a URL;
- each of the six previously-stranded engines has a caller;
- reporting RPCs are actually read (matched as **strings**, since `db.rpc('x')`
  is not a call expression and the original guard could not see them);
- each wired flow trigger is dispatched from somewhere.

⚠️ **Every one of these was verified non-vacuous** by breaking the thing and
watching the test fail. Do that for any guard you add. A structural test that
cannot fail is worse than none.

---

## 6. Gotchas — the expensive ones

### Migrations

- ⚠️ **A migration that recreates a function copies the original body
  VERBATIM.** I retyped `claim_email_messages` to add one column and broke it
  twice in a row: first renaming `message_id` → `id` (the worker reads
  `message_id`; sending stopped), then dropping the **suppression sweep** and
  the `attempts < max_attempts` cap (a message queued before someone
  unsubscribed would have been sent to them). Fixed in 0105 and 0106.
- ⚠️ **A smoke test must assert the CONTRACT, not that the function runs.**
  Three smoke tests passed through both regressions because they asserted on
  `idempotency_key` and the new column, never on the identifier the caller
  reads or the rules the function exists to enforce.
- Migrations are applied **by hand** by the human. Write the file, rehearse with
  `./scripts/check-migration.sh <migration> <smoke>`, put it in
  `supabase/APPLY_PENDING.sql`, and give the human the SQL. `supabase db push`
  is unsafe here (KI8).
- After applying: `npm run db:types`.
- Latest migration: **0106**. All applied.

### Tests

- ⚠️ **`npm run test:email` exists because three suites need GreenMail and had
  been skipping silently for months.** `email-send-worker`, `email-reply-sync`,
  `email-smtp`. That skip is how the 0104 suppression regression reached
  production. The suites already `console.warn` — it was not enough, because a
  warning in a 400-test run is invisible.
- `*-live.test.ts` suites are gated behind opt-in env vars (`RUN_LIVE_PROVIDERS`,
  `RUN_HUBBLE_LLM`, …) because they call real paid APIs. Skipping is correct.
- Integration tests share the **live** Supabase project. Do not run two
  integration suites concurrently; they interfere.

### Data semantics

- ⚠️ **NULL is not zero, anywhere.** A missing lead value, a reply rate with no
  sends, an unset deal value. `email_campaign_report` returns NULL deliberately
  because `0%` reads as "nobody answered" when the truth is "nothing went out".
  The UI must preserve that (`—` plus an explanation).
- **Matched contacts are "already in your CRM", not "duplicates".** The
  canonical-contact rule associating a person with a new batch is correct
  behaviour; calling it a duplicate makes it sound like a fault.
- **Manual contact creation goes THROUGH `crm_ingest_contacts`**, not a plain
  insert. Typing someone in is the most likely way a duplicate enters a CRM.

### Product rules with teeth

- **Suppression is the one email rule with legal weight.** Never weaken the
  suppression sweep in `claim_email_messages`.
- **A pipeline with no Won stage is refused** — no deal could ever close and it
  would never appear in revenue reports.
- **Flow templates spend nothing.** Enforced by a test reading
  `ACTION_TYPES[...].costsCredits`. A starter clicked without reading must not
  commit someone to spend.
- **Sequence structure is frozen while a campaign is live; wording is not.**
  Enrolments hold a step index, so renumbering makes someone skip a step.
- **`step_index` reordering needs TWO passes** (park above the range, then
  settle) because of the unique index on `(campaign_id, step_index)`.

---

## 7. ⚠️ The R0 audit is unreliable about UI

`docs/OUTLIO_FUNCTIONAL_GAP_MATRIX.md` was produced by static inspection. Its
**engine-reachability findings were traced properly and all six proved out.**
Its **UI-completeness findings were pattern-matched from greps and have been
wrong every single time it was checked:**

| Claim | Reality |
|---|---|
| "Setter can read every contact" | False — `dataScope` is applied to contacts, detail, board, reports |
| "Search and Hubble unscoped" | False — search goes through `listContacts`; Hubble scopes by `userId` |
| "Flow builder: no canvas, no branch drawing, no node library" | False — `layoutSteps` walks the graph with depth + yes/no labels; the picker splits free from paid actions |
| "Flow run history: no screen" | False — `/flows/[id]` already renders it |

Corrections are recorded inline in the matrix. **Verify any UI claim before
building on it.** One real gap did come from that section: `/crm/companies` had
no owner filter (introduced by this agent, fixed in R5).

---

## 8. Open items

### Needs a human decision

| Item | Question |
|---|---|
| **KI11 / DR5** | Credits and Lead Engine rows are `user_id`-scoped while everything else is workspace-scoped. Changing it changes what a customer buys. |
| **DR18** | XLSX export needs a spreadsheet dependency added. Yes or no? |
| **Plan packaging** | Migration 0103 set module entitlements and seat limits per plan. The numbers were a recommendation — review them. |

### Blocked

- **Calendar sync (Phase 24.5)** — needs Google/Microsoft OAuth credentials.

### Known issues

- **KI7** — the signup IP gate rate-limits its own test runner. 3 integration
  tests fail because of it. Pre-existing, confirmed.
- **KI8** — `supabase db push` is unsafe; migrations are applied by hand.
- ⚠️ **KI9 — roughly twenty screens have never been rendered in a browser.**
  They typecheck, lint, build, and their data layers are tested. Visual and
  interaction correctness is **unverified**. The agent cannot sign in; this needs
  a human at the preview once. This is the largest untested surface in the
  project.
- **Nothing forces the GreenMail suites to run in CI.**

### Not started

- **R2 remainder** — bulk select, saved views, column config, the full filter
  set, contact detail as a drawer.
- **R7** — custom dashboards, widgets, custom metrics. Nothing exists.
- **R13** — campaign schedule/options UI. All enforced server-side already.
- **Flow builder undo/redo.**
- **Triggers not yet fired:** `list_added`, `batch_added`, `campaign_enrolled`,
  `email_sent`, `email_unsubscribed`, `no_activity`, `webhook`, `scheduled`.
  The last two need a surface (a schedule, an endpoint). `manual` is **done** —
  a published flow whose trigger is `manual` has a "Run now" control on its
  page. ⚠️ That is **not** test mode: every action runs for real, and the UI
  says so before the click.
- **R15–R19** — cross-module integration, attribution, integrations framework,
  UI refinement, security/perf regression.

---

## 9. Working protocol

- **One phase per session.** Stop at the end and report.
- **Update `docs/PROGRESS.md`** every phase. It is the project's memory.
- **Never advance with a failing build.**
- **When uncertain, stop and ask** with `BLOCKER:` + options + a recommendation.
- **No stubs.** If you cannot finish it, say so and leave it unstarted.
- **Verify before you claim.** Half the corrections in this document exist
  because something was asserted from a grep instead of traced.

### Commands

```bash
npm run dev
npm run lint
npm run build
npx tsc --noEmit
npx vitest run tests/unit
npx vitest run tests/integration        # ~17 min, shares the live database
npm run test:email                      # starts GreenMail, runs the 3 mail suites
npm run db:types                        # after any applied migration
./scripts/check-migration.sh <mig> <smoke>   # rehearse a migration in Docker
```

---

## 10. If you do one thing first

**Get a human to sign in at the preview and walk the product.** Twenty screens
have been built without ever being seen. Everything below them is tested; the
surface is not. That is the single largest risk in the codebase, and it is
cheap to retire.

**If you do a second thing:** pick up R7 (custom dashboards). It is the only
remaining module with nothing at any layer — no builder, no widgets, no custom
metrics — so it is the largest single gap against the brief.
