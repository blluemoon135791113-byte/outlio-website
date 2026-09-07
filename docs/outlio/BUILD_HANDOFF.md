# Outlio — build handoff

**Decision of record (owner, 2026-09-08): build everything.** Phases previously
deferred for lack of usage are to be built. This document is the instruction set.

Concerns about building ahead of usage were raised and overruled. They are not
repeated below. What *is* repeated — because it is not a matter of preference —
is the small set of legal and safety constraints in §9, which remain in force.

**Read in this order:** §0 (blocking) → §1 (state) → §2 (how to work here) →
§3–8 (phase-by-phase) → §9 (hard constraints) → §10 (context files).

---

## §0 — BLOCKING: do these before writing any new code

### 0.1 A verified commit is staged and was never made

The sandbox command classifier failed mid-session and would not approve
`git commit`. **8 files staged, +431 / −15.**

```bash
git commit -F /private/tmp/p23.txt
```

`/tmp` clears on reboot. If the file is gone, §0.5 has the message content.

Staged: `lib/events/emit.ts`, `tests/unit/domain-event-boundary.test.ts`,
`tests/unit/trigger-producer.test.ts`, `lib/crm/ingest.ts`,
`lib/crm/opportunities.ts`, `lib/email/reply-sync.ts`,
`app/(product)/crm/tasks/actions.ts`, `docs/outlio/phases/PHASE_23.md`.

Verified before the failure: `tsc` **0 errors**, **3,096 unit tests / 174 files
passing**. `next build` was **not** re-run after the final edit.

### 0.2 One guard passes and has never been shown to fail

`tests/unit/domain-event-boundary.test.ts`. In this codebase that does not yet
count as a guard (§2.1). Close it first:

```bash
cat > lib/crm/__evt_probe.ts <<'TS'
import { dispatchFlowTrigger } from '@/lib/flows/dispatch'
export const probe = () =>
  dispatchFlowTrigger({ workspaceId: 'w', triggerType: 'contact_created', idempotencyKey: 'k' })
TS
npx vitest run tests/unit/domain-event-boundary.test.ts --project unit   # MUST fail
rm -f lib/crm/__evt_probe.ts
ls lib/crm/__evt_probe.ts    # MUST say "No such file"
```

Also mutate: neuter `publishEvent` inside `emit.ts` (vacuity guard must fail),
and delete one line from the `WIRED` mapping (its test must fail).

⚠️ If the probe file survives, `next build` breaks — it imports a `server-only`
module from a path that is not server-only.

### 0.3 Then

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

### 0.4 Two file piles awaiting an owner decision

- `components/leadengine/*` — modified by an earlier agent. This is the
  **landing page**; `CLAUDE.md` rule 5 makes it read-only. Untouched.
- `.claude/agents/*.md` — ~200 untracked agent definitions appeared
  mid-session. Not part of this work. Untouched.

### 0.5 Staged commit message, if `/tmp` was cleared

Title: `Phase 23: twelve webhook events were offered, and none of them ever fired`

Must record: `publishEvent` had 7 call sites, all in its own integration test,
zero in product code; the disproof attempts made before believing it (aliased
imports, re-exports, direct `enqueue_webhook_delivery` bypass); that
`lib/flows/dispatch.ts` documents the identical defect fixed in R8; that the
tests hid it by calling the publisher directly; that six domain moments now go
through `lib/events/emit.ts` behind a boundary guard; that six of twelve events
remain unsourced and are **not** claimed as working; that the phase map was
wrong because parts were built under the earlier milestone numbering; that
`trigger-producer.test.ts` was widened rather than loosened; `tsc` 0 and 3,096
tests passing; **and that the mutation proof had not been run**. End with
`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## §1 — Where the product actually is

Read-only production census, 2026-09-08:

| Table | Rows |
|---|---|
| `workspaces` / `profiles` | 28 / 28 |
| `extraction_jobs` | 87 |
| `crm_contacts` / `crm_companies` | 50 / 44 |
| `crm_opportunities` | **0** |
| `flows` / `flow_versions` | 4 / 5 |
| `flow_runs` / `flow_step_runs` | **0 / 0** |
| `hubble_calls` | **0** |
| `email_campaigns` | 3 |
| `email_messages` (ever sent) | **2** |
| `email_enrollments` | 1 |
| `email_events` | 261 — **254 are known-wrong** (§6.2) |

Two numbers drive most of the work below: `flow_runs` = 0 means the automation
engine has never executed (§3.1), and `hubble_calls` = 0 means every model call
ever made was unmetered (§4.2).

**Phase status:** 0, 0.5, 1, 2, 3, 7, 15 complete · 8 complete-narrowed · 9 and
12 partial · 4 withdrawn · 23 audited and half-wired · everything else to build.

### 1.1 What the last session changed — the commits to read first

| Commit | What it did |
|---|---|
| `ab9e629` | Stopped the E2E harness adopting a **production** server. Five specs had failed looking like five product bugs; it was one environment fault. First green E2E run: 22 passing. |
| `79dceb0` | Repaired a tree left mid-refactor — **33 type errors, `next build` could not run**. Finished the capability registry migration. |
| `485515e` | Phase 12 item 3 — the structural guard on model-provider imports. |
| `d0e753a` | Corrected the Phase 12 brief: **four** unmetered AI routes, not three. |
| `2a776e9` | Phases 13 and 14 assessed; Phase 15 delivered (`RISK_REGISTER.md`), opening the LinkedIn gate. |
| `f553764` | Phase 23 — twelve webhook events offered, **none ever published**. Six now wired through one door. |

⚠️ **Three fixes in that list were the same defect** (§2.1). Read `79dceb0` and
`f553764` before starting: they show both the failure shape and the structural
form of the fix that this codebase expects.

⚠️ **One correction that matters more than it looks.** In `79dceb0`,
`lib/hubble/reason.ts` had lost its `OllamaLlmProvider` import while still
constructing one. The obvious repair — route it through `createHubbleLlm()` —
**typechecks and silently changes behaviour**: `LlmWaterfall` exposes no
`isUsable` of its own, so `evidenceBudgetFor` reads "not local" and hands a
*local* model the full hosted passage set, which the comment three lines above
forbids. This is the class of bug that passes every automated check here.

---

## §2 — How to work in this codebase

### 2.1 The defect class, and why it governs the method

**The recurring defect is not broken code. It is correct code that nothing
calls, and checks that pass for the wrong reason.** Three instances in one
session, and the project has hit it repeatedly:

| When | Defect |
|---|---|
| R8 | Seventeen flow triggers declared, **one** ever fired |
| Phase 12 | One metered AI door, **four** routes walked past it |
| Phase 23 | Twelve webhook events offered, **none** ever published |

Every time the code was right and the *wiring* depended on someone remembering.
Every time, the tests hid it by calling the inner function directly rather than
travelling the path a user travels.

**Therefore, for every feature built below:**

1. Write the feature.
2. Write a test that travels the **user's** path, not the internal function's.
3. **Break the feature and confirm the test goes red.** A test that has never
   failed is not evidence.
4. Where a rule must hold across future code, add a **structural guard** — one
   door plus a scan refusing the others. `tests/unit/model-call-boundary.test.ts`
   and `tests/unit/domain-event-boundary.test.ts` are the templates.

### 2.2 Rules that have each already been paid for

- **Mutations must still compile.** `if (false)` changes TypeScript narrowing
  and breaks test collection — that is not a result. Use `Date.now() < 0`.
- **Every sweep asserts it found something.** A scan over an empty set passes
  vacuously.
- **Strip comments before matching source.** Files here quote the rules they
  obey. This has bitten **six** guards, most recently by matching
  `hubbleExecute` inside a comment and undercounting unmetered routes.
- **Anchor `indexOf` on the statement, not the string.**
- **Prefer one definition to two agreeing copies.** Three copies of the Hubble
  task table drifted; the registry replaced them.
- **Check production before believing a report.** "42 deleted" was a dry run.
- **A layout is not an authorization boundary.** Next renders layout and page
  together; page data lands in the RSC payload regardless.
- **Server actions are tree-shaken.** An action nothing imports gets no action
  ID and is not callable — which is why "gated action with zero callers" recurs
  here as a finding rather than a vulnerability.
- **SQL three-valued logic fails gates open.** `not (false or NULL)` is NULL and
  `if NULL then` does not fire. Coalesce every branch.
- **`server-only` in a Client Component** typechecks and passes tests, then
  fails `next build`. Only the build catches it.

### 2.3 Environment traps

- **`npm run dev` reads `.env.local` — that is PRODUCTION.** Use
  `npm run dev:staging`. Playwright no longer reuses a stray server
  (`reuseExistingServer: false`) because this once wrote E2E fixtures to staging
  while the browser signed into production.
- Production ref `ptewhpmxzenbmxlizxhu`; staging `ahfyvhibzgxrhfjobbqn`.
- **Docker will not start on the owner's machine**, so GreenMail-dependent
  integration tests skip locally. CI skips 24; a local run skipped 47. Do not
  read a local pass count as verification of an email change.
- **`agency` plan limits are malformed** in both projects (no
  `credits_per_month`), so `getPlanById` throws. Harmless only because the plan
  is inactive. **Fix before enabling it** (§8.3).
- Migrations are applied **by hand in the Supabase SQL editor**, never by an
  agent. Validate first:
  `scripts/check-migration.sh supabase/migrations/<file>.sql`.

### 2.4 Commands

```bash
npm run typecheck      # tsc --noEmit
npm run lint           # 0 errors expected; 99 pre-existing warnings
npm test               # unit only, fast
npm run build          # catches the server-only class
npm run test:integration   # real Supabase, serial, slow
npm run test:e2e       # Playwright against staging
npm run db:types       # regenerate types/database.ts after a migration
```

---

## §3 — Unblock the automation engine (Phases 10, 11, 13)

Everything in this section is blocked behind one unexplained fact.

### 3.1 FIRST: why has the flow engine never run? (DECISION-15)

`flow_runs` = 0 and `flow_step_runs` = 0, against **one published flow**
(`contact_created`, live since 2026-09-03) and **three qualifying contacts**
created after it.

Established, each checked rather than assumed:

- The manual path **does** dispatch — `createContactManually`
  (`lib/crm/ingest.ts:634`) calls the dispatcher when `outcome.created > 0`.
- That dispatch predates the contacts (commit `93902d3`, 2026-09-01).
- The dispatch query returns the flow, including the
  `flow_versions!flows_published_version_fk` join.
- The published definition validates; `entryStepId` is `assign`.
- `flow_runs` is genuinely empty — verified with the query error checked, not a
  swallowed failure returning `[]`.

⚠️ **`startRun` inserts a row even when it HALTS**, with `status = 'halted'`.
Zero rows therefore means *nothing reached the insert*. This is not a flow being
refused; the chain stops earlier.

⚠️ **The chain works on staging.** An integration test publishes a flow and calls
`createContactManually` — not `startRun` — and a run appears. So current code
does not explain production's zero.

**To resolve, in order:**

1. Create one contact by hand in the production workspace. Read `flow_runs`.
   One row of either kind narrows this to history rather than code.
2. If still zero, pull the Vercel logs for that request and look for
   `dispatchFlowTrigger` throwing.

Both need production access, so both are the owner's actions.

⚠️ **Do not "fix" this by adding a dispatch call.** A previous pass concluded the
manual path never dispatched and began patching `createContactAction` to add
one — the dispatch was already in `createContactManually`, and the patch would
have fired a **duplicate trigger**. It failed on indentation, which was luck.

### 3.2 Phase 10 — Flow fact expansion

Once 3.1 resolves. Per §9 of the contract: expose company, opportunity,
activity, task, email and conversation facts to flow conditions.

- Extend the fact resolver the engine hands to condition evaluation.
- Every new fact needs a null story: a missing value must not silently read as
  false (that is how eleven triggers looked wired).
- Add to `tests/unit/flow-action-coverage.test.ts`'s sibling: a guard that every
  declared fact has a resolver, asserted both directions.

### 3.3 Phase 11 — Manual flow builder UX

- The builder already filters both pickers on `actionIsImplemented`; keep that
  invariant (`flow-action-coverage.test.ts` pins it).
- Prices come from `lib/capabilities/registry.ts` via `hubbleTaskForAction` —
  do not reintroduce a local task table. Three copies previously drifted.
- The credit quote must be shown **before** publish, per the brief.

### 3.4 Phase 13 — Gemini Flow Copilot

NL generation, conversational patch editing, dry run, credit preview.

- §5.10's prerequisite already exists: the model may emit **only** capability
  ids present in the registry snapshot handed to it. Anything else is a
  validation failure, **not** a repair opportunity.
- Repair loop: **max 2 attempts**, then return structured errors.
- Evals: `/evals/flow-compiler/` with **≥30 golden NL prompts** asserting
  trigger, node set, edges and enum resolution. CI-gated; a pass-rate drop
  blocks merge.
- ⚠️ **The copilot is itself a model call.** It must enter through
  `hubbleExecute` with a registry entry and a price, or
  `tests/unit/model-call-boundary.test.ts` will refuse it — correctly.

---

## §4 — Finish AI metering (Phase 12 item 4)

### 4.1 What exists

- `lib/capabilities/registry.ts` — 32 capabilities, each with `isAi`, price,
  permission. Versioned; **deprecated, never deleted**.
- `lib/hubble/execute.ts` — refuses before spending on: not-an-AI-capability,
  unpriced capability, missing credit context. Hands the model to the runner as
  `tools.llm`.
- `tests/unit/model-call-boundary.test.ts` — only the provider layer and that
  one door may obtain a model at runtime.

### 4.2 What is left

**Four routes call a model with no credit context** (the brief said three; the
fourth was found by import-closure analysis after the first scan matched a
comment):

| Route | Reaches a model via |
|---|---|
| `/api/hubble/ask` | `lib/hubble/reason.ts` |
| `/api/intelligence/query` | `lib/intelligence/planner.ts` |
| `/api/intelligence/clarify` | `lib/intelligence/planner.ts` |
| `/api/intelligence/runs/[id]/summary` | `lib/hubble/summarize.ts` |

⚠️ **`hubble_calls` = 0.** The metered path has never executed, because flows are
its only caller and flows have never run. **Every model call this product has
ever made went through the four routes above.**

**Build:**

1. Price the three unpriced registry entries (`hubble.ask`,
   `intelligence.plan`, `intelligence.summarize`). Recommended starting point:
   **meter at 0** — record the spend, charge nothing — so the number exists
   before the price is chosen. Flow parity would be `ask` = 3, `clarify` = 1.
2. Move each module inside `hubbleExecute`, taking the model from `tools.llm`.
3. **Delete its entry from `UNMETERED_PENDING_DECISION_16`** in the boundary
   test. That list is the checklist; emptying it completes the phase. The test
   asserts both directions, so a stale exemption fails.
4. Rate limits stay as a second layer: `research` is 20 per 10 minutes, roughly
   2,880 model calls per user per day if metering is the only control.

---

## §5 — Finish integrations (Phase 23) and the public surface

### 5.1 What exists

Built under the **earlier milestone numbering** — `lib/api/webhooks.ts` says
"M8 Phase 25.5", `lib/hubble/pricing.ts` says "M7 Phase 22". The §9 map called
this phase `NOT_STARTED`; it was not. **Measure the code, not the plan.**

- Calendly (`lib/integrations/calendly/`), Google (`google*.ts`), GHL, Clay.
- Public API `app/api/v1/` — contacts, companies, opportunities, tasks, lists,
  activities. Migration `0097_public_api.sql`.
- Webhooks — HMAC signing, stable `event_id` across retries, backoff
  30s/2m/8m/32m/2h, SSRF-safe URL check, delivery log, worker delivery each tick.

### 5.2 What was just fixed (staged, §0.1)

Six domain moments now go through `lib/events/emit.ts`, which fans out to the
flow engine **and** webhooks: `contact_created`, `stage_changed`,
`opportunity_won`, `task_completed`, `email_replied`, `email_bounced`.

### 5.3 What is left

**Six of twelve events still have no source and must not be claimed as working:**

| Event | Where its source belongs |
|---|---|
| `crm.contact.assigned` | the assignment path (`ASSIGN_OWNER` and manual reassign) |
| `email.message.sent` | the send path, after a successful provider hand-off |
| `email.contact.unsubscribed` | the suppression path, on unsubscribe only — not on bounce |
| `meeting.booked` / `.cancelled` / `.rescheduled` | Calendly ingest — **needs a payload contract first** |

⚠️ Do not invent the `meeting.*` payload shape to close the gap. Publishing an
event whose body nobody specified is fabricating an API.

**Also outstanding:**

- **Publish-side idempotency.** `enqueue_webhook_delivery(workspace, event_type,
  payload)` takes **no idempotency key**, so a retried business operation
  publishes twice while the flow side de-duplicates.
  `webhook_deliveries.event_id` is stable across retries *of one delivery*, not
  across two publishes. Closing it is a schema change to a table that has never
  held a row — decide deliberately, then expand → backfill → contract (§5.15).
- **Slack / Teams** (§9 names them): `lib/notifications/send.ts` and
  `lib/flows/actions/notify.ts` exist; verify whether either actually delivers,
  and wire the channel if not.
- **Public API**: confirm every `v1` route is key-authenticated, workspace-scoped
  and rate-limited, and that a key cannot read across tenants. Test it by
  *attempting* the cross-tenant read, not by reading the code.

---

## §6 — Reporting (Phase 14)

### 6.1 Scope, per §5.14

Metric registry (id, source, aggregation, filters, formula AST); whitelist
grammar — `+ - * /`, safe division, `COUNT/SUM/AVG/MIN/MAX`, metric references;
**no user SQL, no `eval`**; compiled to parameterized SQL with a hard 10s
statement timeout; campaign/channel/sender/day rollup tables built in the **same
phase** as the dashboard builder.

### 6.2 ⚠️ The one thing that will produce a wrong number on day one

`email_events` holds 261 rows. **254 are false `replied` events** — a whole
mailbox recorded as prospect replies against two messages ever sent. Phase 9
fixed the cause and deliberately kept the rows as evidence.

**A naive reply-rate metric computes 254 / 2 and renders 12,700%.**

Before any email metric ships, choose one and write it down:

- exclude events before the Phase 9 fix by a documented cutoff, or
- reclassify the 254 using the same "did we ever mail them?" rule the fix uses
  (`lib/email/reply-sync.ts`), or
- scope reply-rate to enrollments rather than raw events.

Whichever is chosen, a test must assert the historical rows cannot enter the
numerator.

### 6.3 Rollup grain

Grain is a schema commitment; changing it later is a migration plus a backfill.
Pick it from the shape the data will have, and state the assumption in the
evidence file.

---

## §7 — LinkedIn (Phases 15–21)

Phase 15 is **complete**: `docs/outlio/RISK_REGISTER.md` exists, which §6.3
required before any LinkedIn code. The gate is open. Owner has elected to
proceed.

### 7.1 Current position — verified

No account connected, no send path, no credentials or cookies held, no
automation vendor in source. The entire surface is a browser extension holding
`storage` + `activeTab` against `https://www.linkedin.com/sales/*`, parsing
pages the user opened. **Outlio is an observer; Phase 16 changes that.**

### 7.2 Build order — not negotiable

**16 connection → 17 dry-run + safety engine, complete and VERIFIED → 18
campaigns.** Live mode must not exist before 17 passes.

### 7.3 Phase 16 — account connection

Access method is an owner choice among the five in the register. Row B (official
partner API) is the only ToS-compliant one and is not currently held; applying
is the way to close that properly.

### 7.4 Phase 17 — dry-run + safety engine (the load-bearing phase)

Required by §6.3 **before** Live exists, and each must be `VERIFIED` by breaking
it, not by reading it:

- **Server-side per-account daily and weekly caps.** Provider caps are a
  ceiling, not a target. A client-side cap is not a cap.
- **Workspace emergency stop, per-account pause, per-campaign pause** — each
  proven by a test showing sending actually *ceases*.
- **Eligibility, capacity and collision checks before enqueue**, not after
  failure. Collision spans campaigns *and channels*, so one prospect cannot be
  worked twice.
- **In-product risk acknowledgement** recorded per workspace before Live can be
  enabled.

⚠️ These are the exact shape of control this codebase has shipped broken —
a suppression list with every write path and no read path; a sequence sender
that did not exist while the UI reported sending; twelve webhook events that
never fired. An emergency stop that has never been proven to stop anything is
the same defect where the person harmed is the customer.

### 7.5 Phases 18–21

18 campaigns on an **async operation ledger**, reconciled — a vendor outage must
surface as a visible partial, never a silent one. 19 reply sync — reuse the
Phase 9 lesson: an inbound message is only a reply if **we actually contacted
them**, or the same false-reply bug returns on a new channel. 20 multichannel
campaigns. 21 multichannel analytics + source-to-revenue attribution, which
depends on §6 existing first.

---

## §8 — The rest

### 8.1 Phase 22 — role-aware home dashboards

Roles already exist and `lib/auth/decide.ts` is the single decision point. The
home surface must be **server-side filtered** — hiding a card is not access
control, and a layout is not a boundary (§2.2).

### 8.2 Phase 24 — UI refinement

⚠️ **Standing owner instruction:** for dashboard and login/signup UI use the
installed tooling rather than designing from scratch — `design-taste-frontend`,
`impeccable` (`/impeccable init` once per project), `playwright-cli`, and
`~/reference/awesome-design-md`. See the `ui-design-tooling` memory.

Constraints: zero hardcoded colours on authenticated surfaces (pinned by
`tests/unit/hard-rules.test.ts`); every screen ships designed loading, empty and
error states; no entrance animations in the product; no `backdrop-filter` on
dashboard surfaces; motion ≤150ms. A comp full of literal hex values fails the
suite — resolve to the `@theme` tokens in `app/globals.css`.

**Two install facts that are easy to lose:** impeccable's payload is gitignored
(~14MB per harness incl. a `darwin-arm64` binary) and its hooks are guarded
`[ ! -f <binary> ] || …`, so on a fresh clone they **silently no-op** — run
`npx impeccable install`. And `npm install -g` fails on the owner's machine
(npm prefix `/usr/local`, root-owned); use `npm install -g --prefix ~/.local`.

### 8.3 Phase 25 — hardening + scale

Includes the known defect: **the `agency` plan's limits blob is malformed** in
both projects — no `credits_per_month`, so `getPlanById` **throws**. Harmless
only because the plan is inactive with zero users. Fix before it is enabled.

Also: §6.4 data-subject rights (erasure against append-only history — PII
redacted in place with a tombstone, aggregate rows keeping non-identifying
keys), and per-endpoint circuit breakers for outbound webhooks.

---

## §9 — Constraints that remain in force

These are not preferences and are not affected by the decision to build
everything. Several are commercial rather than moral, and the commercial ones
are load-bearing.

1. **No LinkedIn credential capture, no cookie harvesting** (`CLAUDE.md` rule 2,
   unrevised). Holding a customer's LinkedIn session is a breach liability with
   no upside.
2. **No CAPTCHA solving or bypass. No fingerprint spoofing, stealth or
   anti-detection. No rate-limit evasion.** These are what get an IP range and a
   **sending domain** blocklisted — and Outlio sells email deliverability.
   Losing it breaks the product that pays for everything else. **Scale by adding
   authorized senders, never by evading one sender's limits.**
3. **Never fabricate lead data** (rule 4). A value may be stored only if it was
   **literally observed**, with the evidence row naming provider and URL.
   Synthesising `first.last@company.com` is still forbidden: it looks right, is
   often right, and when it is wrong nobody can tell.
4. **Never render uploaded HTML** (rule 3). No `dangerouslySetInnerHTML`, no
   `innerHTML`, no `iframe srcdoc`. Parsing is server-side only.
5. **Authorization is server-side; RLS on every table.** The service role
   bypasses RLS, so every service-role query must scope by tenant in code.
6. **No secrets in source.** `SUPABASE_SERVICE_ROLE_KEY` is server/worker only,
   never `NEXT_PUBLIC_`.
7. **Do not modify the landing page** (rule 5).
8. **GDPR Art. 14** — notifying a person whose data was collected without their
   knowledge, within a month — remains an accepted, unimplemented exposure. A
   LinkedIn phase increases the volume of personal data and does not change the
   obligation.
9. **No stubs.** If it cannot be finished, leave it unstarted and say so.

---

## §10 — Context files

| File | What it holds |
|---|---|
| `CLAUDE.md` | Hard rules, decided architecture, conventions |
| `docs/outlio/00_BUILD_CONTRACT.md` | The governing spec — §5 architecture, §6 risk, §9 phase map, §10 definition of done |
| `docs/outlio/05_PHASE_STATUS.md` | Per-phase status and results |
| `docs/outlio/04_DECISIONS_NEEDED.md` | Every open question, with options and trade-offs |
| `docs/outlio/phases/PHASE_*.md` | Per-phase briefs and evidence |
| `docs/outlio/RISK_REGISTER.md` | LinkedIn access methods, ToS posture, required controls |
| `docs/outlio/MIGRATION_HANDOFF.md` | Environment, secrets, agent memory — what does not travel with a clone |
| `docs/SELECTOR_MAP.md` | Parser field contract. **§3 and §6 disagree about the job-title selector on different layouts — read both before touching the parser.** |

**Agent memory does not travel with `git clone`.** Three files at
`~/.claude/projects/-Users-husnainrafiq-outlio/memory/` — copy them to the new
machine. The important one encodes §2.1–2.2.

### Knowledge graph — optional, and deliberately not required

`graphify-out/` holds a graph of the documentation (408 nodes, 459 edges, 48
wiki articles at `graphify-out/wiki/index.md`).

⚠️ **Do not treat it as a prerequisite, and do not rebuild it to start work.**
This document plus the files in the table above are the complete source of
truth. The graph is a convenience for exploring how the docs relate; everything
needed to build is written out here in prose.

Where the graph is stale relative to this document, **this document wins.** It
was built before Phases 13, 14, 15 and 23 and before `RISK_REGISTER.md`, so it
under-describes the LinkedIn gate and the webhook finding. That is noted here so
nobody reconciles the two and concludes the newer work is missing.

If someone does want it current later, `/graphify docs --update` re-indexes only
changed files. It is never a blocker.
