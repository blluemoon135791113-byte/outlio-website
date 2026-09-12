# Migration handoff — everything needed to continue Outlio elsewhere

Written 2026-09-07. Purpose: move this project to another machine or another
agent session **without losing the context that is not in the code**.

Read in this order: this file → `docs/outlio/05_PHASE_STATUS.md` →
`docs/outlio/04_DECISIONS_NEEDED.md` → `CLAUDE.md`.

---

## 1. Where the state actually lives

| What | Where | In git? |
|---|---|---|
| Hard rules, decided architecture | `CLAUDE.md` | yes |
| Phase map, status of all 26 phases | `docs/outlio/05_PHASE_STATUS.md` | yes |
| Every open question | `docs/outlio/04_DECISIONS_NEEDED.md` | yes |
| Per-phase briefs and evidence | `docs/outlio/phases/` | yes |
| Governing spec | `docs/outlio/00_BUILD_CONTRACT.md` | yes |
| Parser field contract | `docs/SELECTOR_MAP.md` | yes |
| **Agent memory** | `~/.claude/projects/-Users-husnainrafiq-outlio/memory/` | **NO — §2 below** |
| **Secrets** | `.env.local`, `.env.staging` | **NO — §5 below** |
| Knowledge graph of all the above | `graphify-out/` | see §7 |

⚠️ Only two things do not travel with `git clone`: the agent memory and the env
files. Everything else is in the repo.

---

## 2. Agent memory — carry these three files

Location on the current machine:

```
~/.claude/projects/-Users-husnainrafiq-outlio/memory/
  MEMORY.md                      (index — one line per memory)
  outlio-verification-habits.md  (type: feedback)
  ui-design-tooling.md           (type: feedback)
```

On the new machine the directory is
`~/.claude/projects/<escaped-project-path>/memory/`, where the path is the
project's absolute path with `/` replaced by `-`. Copy all three files in.

### Memory 1 — verification habits (the important one)

> Outlio's recurring defect is not broken code. It is **checks that pass for the
> wrong reason**: a guard nothing calls, a test whose assertion cannot fail, a
> counter reporting the same number forever, a scheduler firing perfectly and
> being refused every time.

Rules it encodes, each learned from a real bug:

- **Break the guard and re-run.** Neuter what a check protects and confirm the
  suite goes red. Mutations must still compile — `if (false)` changes TypeScript
  narrowing and breaks test collection; use `Date.now() < 0`.
- **Every sweep asserts it found something.** A scan over an empty directory
  passes vacuously.
- **Strip comments before matching source.** Files here quote the rules they
  obey, so a raw grep passes on prose. Has bitten five guards now — the most
  recent on 2026-09-07, when a check for `reuseExistingServer` matched the
  incident note in a comment rather than the setting.
- **Anchor `indexOf` on the statement, not the string.**
- **Prefer one definition over two agreeing copies.**
- **Check production before believing a report.** "42 deleted" was a dry-run
  count.

### Memory 2 — UI design tooling

For **dashboard and login/signup UI**, the owner wants `design-taste-frontend`,
`impeccable`, `playwright-cli` and `~/reference/awesome-design-md` used rather
than designing from scratch. Two install facts that are easy to lose:

1. **impeccable's payload is gitignored** (~14MB per harness, incl. a
   `darwin-arm64` binary). A fresh clone has the hooks but not the binary, and
   the hooks are guarded `[ ! -f <binary> ] || …`, so they **silently no-op**.
   If impeccable seems inert, run `npx impeccable install`.
2. **`npm install -g` fails on this machine** — npm's prefix is `/usr/local`,
   owned by root. Use `npm install -g --prefix ~/.local <pkg>`.

---

## 3. The tasks ahead

### 3.1 Blocked on the owner — nothing proceeds without these

| # | Action | Why it is the owner's |
|---|---|---|
| **DECISION-15** | Create one contact by hand in production, read `flow_runs`. If still 0, pull Vercel logs. | Needs a production write. The flow engine has **never produced a run** — `flow_runs` and `flow_step_runs` are both 0 against one published flow and three qualifying contacts. The chain is proven working on staging, so production's zero is unexplained. Phase 10 and Phase 11 are both blocked behind it. |
| **DECISION-16** | Decide what `/api/hubble/ask` and the two intelligence routes cost. | Pricing. Recommendation: *meter but do not charge* (record spend, price 0) — the only option that does not require guessing a number nobody has. |
| **DECISION-14** | Confirm Phase 5 stays deferred. | Delegated to the agent 2026-09-06 and answered *defer*; owner can override. |
| **Open PR** | `main` is branch-protected and gated on CI. **18 commits** sit ahead of `origin/main` on `platform-m1-workspaces`. | Pushing to a remote needs to be asked for in-session. |
| **Provider bill** | Read the LLM provider console. | Only place the real cost of the unmetered routes exists. ⚠️ `hubble_calls` is **0** — the metered path has never executed, so every model call this product has ever made was unmetered. |
| **DECISION-17** | Decide whether Outlio enters the LinkedIn channel. | Gates Phases 16–20. One of five access methods is ToS-compliant and we do not have it; the failure mode is the customer losing their account. See `RISK_REGISTER.md`. |
| **DMARC** | Drop `pct=25` after ~2 weeks of clean reports (set 2026-09-06). | Live DNS. |

### 3.2 Other decisions still open

`DECISION-04` (no mailbox — now partly overtaken, one account connected),
`DECISION-08` (§7 fixture vs free tier), `DECISION-09` (saved views shared or
private), `DECISION-10` (does a bridged value keep its citation),
`DECISION-11` (what a value with no provenance says), `DECISION-13` (default
ingest mode). Full text in `04_DECISIONS_NEEDED.md`.

### 3.3 Phase map — what is left to build

| Phase | State | Note |
|---|---|---|
| 0, 0.5, 1, 2, 3 | COMPLETE | evidence files exist |
| 4 | **WITHDRAWN** | the 4% ratio was a chronology artifact — the CRM did not exist while those leads were extracted |
| 5, 6 | **DEFERRED** | `crm_opportunities` is 0 rows; designing against a population of zero |
| 7 | COMPLETE | email E2E with a real mailbox |
| 8 | COMPLETE (narrowed) | suppression list shipped; rotation + variants deferred (1 mailbox, 0 sequence steps) |
| 9 | **PARTIAL** | reply-attribution defect fixed; the conversation model deferred until a second channel exists |
| 10 | **BLOCKED** | DECISION-15 |
| 11 | **DEFERRED** | Flow builder UX, blocked behind 10 — the engine has never run |
| 12 | **PARTIAL** | items 1–3 delivered 2026-09-08: registry, guarded entry point, structural boundary guard. Item 4 needs DECISION-16 |
| 13 | **DEFERRED** | Flow Copilot — generates definitions for an engine with 0 runs |
| 14 | **DEFERRED** | Reporting — every metric source is 0–2 rows, and the one table with volume holds 254 known-wrong rows |
| 15 | **COMPLETE** | LinkedIn capability matrix + `RISK_REGISTER.md` — the gate §6.3 requires before any LinkedIn code |
| 16–20 | **GATED** | LinkedIn channel, blocked on DECISION-17 |
| 21–25 | NOT STARTED | see §9 of the build contract |

⚠️ **Seven phases now rest on the same fact** — 4, 5, 6, 11, 13, 14 and the
recommendation in 15. Production, 2026-09-08: 28 workspaces, 50 contacts, 2
emails ever sent, 1 enrolment, 0 opportunities, 0 flow runs, 0 metered AI calls.
The engineering is a long way ahead of the usage, and no further phase changes
that. **That is a product question, not an engineering one, and it is now the
main one.**

### 3.4 Ready to start with no approval

- ~~**Phase 12 items 1–3**~~ — **done 2026-09-08.** What remains unstarted with no approval needed is genuinely little; see the phase table. The next substantive step is item 4, and it is blocked on pricing. Originally: one capability registry file (`id`, `is_ai`,
  `credits`, required permission), a single guarded entry point for model calls
  that fails closed without a credit context, and a **structural guard** that no
  module may import an LLM provider except that entry point. Item 3 is the real
  deliverable — 1, 2 and 4 without it produce a fourth unmetered route the first
  time someone is in a hurry.
- Narrow CI's push trigger to `main` (it currently runs `verify` twice per
  change).
- Trigger the Integration workflow to confirm the Phase 9 reply-sync fix —
  `email-reply-sync.test.ts` skips locally because Docker will not start on this
  machine, and it is the only test covering the changed path.

---

## 4. Known traps that cost time here

1. **A stale `npm run dev` on port 3000 points at PRODUCTION.** `next dev` reads
   `.env.local`. Playwright used to reuse any listener on that port, so E2E
   fixtures went to staging while the browser signed in against production —
   five specs failed looking like five product bugs. Fixed
   (`reuseExistingServer: false`) and pinned in `hard-rules.test.ts`. Use
   `npm run dev:staging` for anything authenticated.
2. **`div[data-anonymize="job-title"]` is NOT the job title** on the layouts
   `SELECTOR_MAP` §3 covers — it holds tenure text and fails silently. §6's
   2026-08-19 census records the opposite on a different layout. Both are true;
   read the section before touching the parser.
3. **A layout is not an authorization boundary.** Next renders layout and page
   together; page data lands in the RSC flight payload regardless.
4. **Server actions are tree-shaken.** An action nothing imports gets no action
   ID and is not callable over HTTP — which is why "gated actions with zero
   callers" is a recurring finding here rather than a vulnerability.
5. **SQL three-valued logic fails gates open.** `not (false or NULL)` is NULL,
   and `if NULL then` does not fire. Coalesce every branch.
6. **`server-only` in a Client Component** typechecks and passes tests, then
   fails `next build`.
7. **Docker will not start on this machine**, so GreenMail-dependent integration
   tests skip. CI skips 24; a local run skipped 47. Reading the pass count as
   verification of an email change is exactly the vacuity trap.
8. **`agency` plan limits are malformed** in both projects (no
   `credits_per_month`), so `getPlanById` throws. Harmless only because the plan
   is inactive with zero users. Fix before enabling it.

---

## 5. Environment setup on a new machine

```bash
git clone <remote> outlio && cd outlio
npm ci
```

Then recreate two untracked files. **Copy the values from a password manager —
never from git history, and never paste them into a chat.**

`.env.local` (production) needs these keys:

```
WEB_RESEARCH_MCP_URL  NEXT_PUBLIC_SUPABASE_URL  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY  TRIAL_IP_HASH_SECRET  OUTLIO_ALLOW_PAID_PROVIDERS
LLM_PROVIDER  LLM_ALLOWED_VENDORS  GEMINI_API_KEY  GROQ_API_KEY  GROQ_MODEL
OPENROUTER_API_KEY  CEREBRAS_API_KEY  BACKBOARD_API_KEY  OLLAMA_URL
COMPANIES_HOUSE_API_KEY  GITHUB_TOKEN  PAGESPEED_API_KEY  TAVILY_API_KEY  TED_EU
PROSPEO_API_KEY  APOLLO_API_KEY  HUNTER_API_KEY  GOOGLE_MAPS_API_KEY
APIFY_API_TOKEN  TOKENRA_API_KEY  MEILISEARCH_API_KEY  ELASTICSEARCH_API_KEY
EXA_API_KEY  FIRECRAWL_API_KEY  JINA_API_KEY  LANGFUSE_PUBLIC_KEY
LANGFUSE_SECRET_KEY  LANGFUSE_BASE_URL  GOOGLE_CSE_API_KEY  GOOGLE_CSE_ID
VECTOR_SEARCH_API  SERPER_API_KEY  INTEGRATION_ENCRYPTION_KEY
UNSUBSCRIBE_TOKEN_SECRET
```

`.env.staging` needs six: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`INTEGRATION_ENCRYPTION_KEY`, `UNSUBSCRIBE_TOKEN_SECRET`,
`TRIAL_IP_HASH_SECRET`.

Two Supabase projects, and confusing them is the trap in §4.1:

| | ref |
|---|---|
| production | `ptewhpmxzenbmxlizxhu` |
| staging | `ahfyvhibzgxrhfjobbqn` |

Commands: `npm run dev` (production data), `npm run dev:staging`,
`npm run typecheck`, `npm run lint`, `npm test` (unit, fast),
`npm run test:integration` (real Supabase, serial), `npm run test:e2e`
(Playwright, staging), `npm run build`, `npm run db:types`.

Migrations are applied **by hand in the Supabase SQL editor**, never by an
agent. Validate one first with
`scripts/check-migration.sh supabase/migrations/<file>.sql`.

---

## 6. Git state at handoff

Branch `platform-m1-workspaces`, **12 commits ahead of `origin/main`**, 4 of
them not yet pushed to the branch remote:

```
016e144  Phase 12 brief: the same AI work is billed or free depending on the door
d03788f  Correct a phase table that said seven phases were unstarted
fce9f40  Add a staging preview config, so the default one is not the only one
ab9e629  Stop the E2E harness from adopting a production server
```

`main` is branch-protected and gated on the `verify` CI job (typecheck, lint,
unit tests, build). Integration runs nightly against staging and refuses if the
URL contains the production ref.

Health at handoff: `tsc` 0 errors · lint 0 errors / 99 warnings · **3,069 unit
tests pass** · **22 E2E pass** (first green run) · `next build` clean.

Uncommitted and deliberately left alone: modified `components/leadengine/*`
(landing-page work predating this session — `CLAUDE.md` rule 5 makes the landing
page read-only) and untracked `.codex-previews/`, `.codex/`.

---

## 7. The knowledge graph

`graphify-out/` holds a graph of every document in `docs/` plus `CLAUDE.md`,
`AGENTS.md` and the three memory files — **408 nodes, 459 edges, 38
communities**, health-checked clean (no dangling, missing or collapsed edges).

```
graphify-out/graph.html        interactive, open in a browser
graphify-out/GRAPH_REPORT.md   audit report with the god nodes
graphify-out/graph.json        GraphRAG-ready
graphify-out/wiki/index.md     48 agent-crawlable articles — entry point
```

The wiki is the useful artifact for a new agent session: it is markdown, one
article per community, and it can be read without running anything.

⚠️ It is a graph of the **documentation**, not the code — `lib/`, `app/` and
`supabase/` were deliberately excluded to keep the migration context legible.
Rebuild wider with `/graphify . --update` if code structure is wanted.

`graphify-out/` is regenerable and need not be committed.
