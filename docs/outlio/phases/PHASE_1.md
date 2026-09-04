# Phase 1 — Wiring/reachability sweep + authorization core

Per §10. Status: **BRIEF — contains open questions, so it needs approval before
implementation** (§10: "stop and get the brief approved if it contains open
questions").

---

## GOAL

Two halves, in this order:

1. **Authorization core.** One named function that produces a tenant scope, used
   everywhere, plus tests that prove isolation by allow *and* deny.
2. **Wiring/reachability sweep.** Work down the backlog the Phase 0.5 guards
   surfaced, so their allowlists shrink.

## OUT OF SCOPE

- Any CRM table UX (Phase 2). No filtering, sorting or saved-views work.
- The flow runtime. The dead triggers are *counted* here, wired in Phase 4.
- LinkedIn, email productization, reporting.
- Deleting the orphaned modules. ADR-002 left those as product decisions.

---

## CURRENT STATE

All `VERIFIED` against production on 2026-09-04 unless marked otherwise.

**RLS is in good shape, and the naive way of checking it is wrong.**
`VERIFIED` by behaviour, not by reading SQL:

| Result | Count |
|---|---|
| Tables an anonymous client could read rows from | **0** |
| Rejected outright by PostgREST (`42501`) | 86 |
| Proven protected — table has rows, anon saw none | 21 |
| Inconclusive — table is empty, so the test proves nothing | 17 |

⚠️ **A static scan of the migrations reports 46 tables "without RLS", including
`crm_contacts` and `workspaces`. That is wrong.** RLS for the CRM tables is
enabled by `execute format('alter table public.%I enable row level security', t)`
inside `do` blocks looping over arrays (`0071:628`, `0072:559`). No text scan can
see through that, and a second bug — matching a single space where the source has
three — hid more. This is the third scanner in two phases to be wrong on first
write, and it is why the table above is measured by querying as `anon` rather
than by parsing.

**The 17 inconclusive tables are mostly already known-dead:** `company_links`,
`company_signals`, `export_destinations` and the three `web_research_*` are on
`schema-without-code`'s list; `paddle_*` is superseded by FastSpring.

**`scopeFor` does not exist.** §9 names it as Phase 1's deliverable. Grep across
`app/` and `lib/`: zero occurrences.

**The service role is used in 135 files.** `createAdminClient` bypasses RLS
entirely, so CLAUDE.md requires every such query to scope by tenant *in code*.
That requirement is currently enforced by review alone.

⚠️ **I do not have a trustworthy count of violations.** A first-pass scan flagged
92 of 568 service-role `.from()` statements as lacking a visible tenant filter.
Calibrating against the first two — both `crm_tasks` — showed **both were
correctly scoped**; the scanner's chain-matching window truncated before reaching
`.eq('workspace_id', …)`. So **92 is an upper bound for triage, not a finding**,
and many are legitimately cross-tenant (`job_queue`, `webhook_deliveries`,
`export_jobs` are worker claim queues that must sweep all tenants).

Producing a scanner that is right is itself Phase 1 work, and on this repo's
record it will take more than one attempt.

## WHAT ALREADY WORKS (`VERIFIED`)

- `decidePermission` — `lib/workspaces/permissions.ts:246`, 45 permissions, total
  role hierarchy, matrix tests.
- `lib/auth/decide.ts` — the pure access decision; `access.ts` only gathers inputs.
- `apiRoute` — `lib/api/handler.ts:46`. One wrapper does auth, scope check, rate
  limit and workspace scoping for all six v1 routes; handlers cannot read a
  workspace id from the request, which makes cross-tenant reads impossible rather
  than merely forbidden.
- Server-side route guarding — four authenticated routes redirect a signed-out
  visitor (`e2e/auth.spec.ts`, verified non-vacuous against `/pricing`).
- The signup gate, restored and recorded (`0110`).

## WHAT IS MISSING

1. **`scopeFor`** — no single function produces a tenant scope.
2. **A service-role scoping guard** — the rule exists in CLAUDE.md and nothing
   enforces it.
3. **A tenant-isolation test** — DoD item 4 requires "via API and via direct
   URL", with two workspaces and a cross-read that must fail. None exists.
4. **An RBAC deny test at the route layer** — the permission matrix is tested as
   a pure function; nothing asserts a route refuses a real under-privileged user.
5. **RLS confirmation for the 17 inconclusive tables** — needs either rows or a
   different method.

## ARCHITECTURE TO REUSE

- `lib/workspaces/permissions.ts`, `lib/auth/decide.ts`, `lib/auth/access.ts`
- `lib/api/handler.ts` — `apiRoute` is the model `scopeFor` should follow
- `lib/workspaces/context.ts` — `assertWorkspacePermission`
- `tests/unit/orphan-module.test.ts` — the import-graph builder is reusable for
  the service-role scan

## DO-NOT-TOUCH

- The flow runtime (`lib/flows/engine.ts`), per §13.
- `handle_new_user` — just repaired; any change must carry all five
  responsibilities (`signup-gate-intact.test.ts`).
- The landing page (CLAUDE.md rule 5).
- `lib/email/compliance.ts` wiring — four guarded links.

## MODELS / MIGRATIONS / APIs / EVENTS / PERMISSIONS / WORKERS / PROVIDERS

- **Migrations:** none expected. If the 17 inconclusive tables need RLS added,
  that is one additive migration, owner-applied.
- **APIs / events / workers / providers:** no change.
- **Permissions:** no new permissions. DECISION-06 may change where they live.

## TESTS TO WRITE

| Kind | Test |
|---|---|
| Unit | `scopeFor` — every caller shape, including the "no workspace" case |
| Reachability | service-role queries scope by tenant; allowlist for worker sweeps, asserted both directions |
| RBAC | each role × each permission, **allow and deny**, at the route layer not just the pure function |
| Tenant | two workspaces; every read/write cross-attempt fails, via API **and** direct URL |
| E2E | extend `e2e/auth.spec.ts` with an under-privileged user hitting a forbidden route |

⚠️ **Every guard must be verified non-vacuous by breaking what it watches.** Five
of the guards written in Phase 0.5 needed that step, and three were wrong.

## E2E ACCEPTANCE JOURNEY

1. Sign in as a member of workspace A.
2. Load a CRM contact in A — succeeds.
3. Request a contact id belonging to workspace B **by direct URL** — 404 or
   redirect, never the record.
4. Call `/api/v1/contacts` with A's API key — returns only A's contacts.
5. Same call with B's id in a query parameter — no effect; scope comes from the key.
6. As a role lacking `crm.contact.edit`, attempt an edit — refused server-side.
7. Confirm the refusal in step 6 is not merely a hidden button: the action is
   invoked directly.

⚠️ **Steps 1–7 need two workspaces with data and two roles.** See open questions.

## SECURITY + COMPLIANCE NOTES

- This phase touches the code path that decides who sees what. A mistake here is
  a cross-tenant breach, not a bug.
- Every new guard lands with an allowlist asserted in both directions, so wiring
  something up without removing its entry fails loudly.
- No production data is created by this phase's tests if DECISION-03 is answered
  first; see below.

## COST IMPACT

**NONE** unless DECISION-03 is answered with a second Supabase project, which is
a recurring cost the owner has not yet approved.

## OPEN QUESTIONS

Mirrored into `04_DECISIONS_NEEDED.md`.

1. ⚠️ **DECISION-03 blocks the acceptance journey.** Steps 1–7 need two
   workspaces, two roles and seeded contacts. Creating them means writing to
   production — the database now holding 43 leaked `outlio-test-*` accounts from
   test runs. **I am not going to build a tenant-isolation suite that manufactures
   more tenants in production.** Either a second project, or the journey is
   verified by hand once and filed `INFERRED` rather than `VERIFIED`.

2. **DECISION-06 — `permissions.yaml` vs TypeScript.** §5.2 names the YAML file
   as Phase 1's source of truth. The repo satisfies the intent in TypeScript.
   Answering it before I write `scopeFor` avoids doing the work twice.

3. **Scope of the sweep.** Phase 0.5's guards left 11 dead triggers, 5 orphan
   modules and 9 unused tables allowlisted. Wiring 11 triggers is Phase 4 work by
   §9. My reading is that Phase 1's sweep means *the authorization wiring*, and
   the rest stays allowlisted. Confirm if you meant the whole backlog.
