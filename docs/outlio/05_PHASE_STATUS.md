# Phase status

One line per phase. `status ∈ NOT_STARTED | IN_PROGRESS | BLOCKED | COMPLETE`.
A phase is `COMPLETE` only when every DoD item in §10 is `VERIFIED` and
`PHASE_<n>_EVIDENCE.md` exists.

| Phase | Name | Status | Branch | Evidence |
|---|---|---|---|---|
| 0 | Reality audit | **COMPLETE** | `platform-m1-workspaces` | [`02_GAP_MATRIX.csv`](02_GAP_MATRIX.csv) · [`PHASE_0_EVIDENCE.md`](phases/PHASE_0_EVIDENCE.md) · [`PHASE_0_AUDIT.md`](phases/PHASE_0_AUDIT.md) |
| 0.5 | Safety net | **COMPLETE** | `platform-m1-workspaces` | [`PHASE_0.5.md`](phases/PHASE_0.5.md) · [`PHASE_0.5_EVIDENCE.md`](phases/PHASE_0.5_EVIDENCE.md) |
| 1 | Wiring sweep + authorization core | **COMPLETE** | `platform-m1-workspaces` | [`PHASE_1.md`](phases/PHASE_1.md) · [`PHASE_1_EVIDENCE.md`](phases/PHASE_1_EVIDENCE.md) |
| 2 | CRM table: filter/sort/pagination, bulk actions, saved views | **COMPLETE** | `platform-m1-workspaces` | [`PHASE_2.md`](phases/PHASE_2.md) · [`PHASE_2_EVIDENCE.md`](phases/PHASE_2_EVIDENCE.md) |
| 3 | Contact + Company workspaces; evidence/provenance | **COMPLETE** | `platform-m1-workspaces` | [`PHASE_3.md`](phases/PHASE_3.md) · [`PHASE_3_EVIDENCE.md`](phases/PHASE_3_EVIDENCE.md) |
| 4–25 | see §9 | NOT_STARTED | — | — |

## Phase 0 result (2026-09-04)

Ran: `tsc --noEmit` exit 0 · `npm run lint` 0 errors / 97 warnings ·
`vitest run tests/unit` 141 files, 2,563 tests, all passed, 37.6s ·
`vitest run tests/integration` **1,482s — 403 passed, 4 failed, 46 skipped** ·
42-table read-only production census.

Of the four integration failures, three are finding #1 below and one was my own
regression: `sync_contact_evidence` was added to the tick this session without
being added to `worker-tick.test.ts`'s expected-job list. Fixed. The suite's
25-minute cost is itself finding #6.

Five defects found that no type check, linter or build could see:

1. ⚠️ **The signup gate has not run since 2026-08-24.** `0070_workspaces.sql` —
   a migration about workspaces — redefined `handle_new_user()` and, because
   `create or replace function` replaces rather than merges, deleted the
   reservation check (0018), the device claim (0019), the identity-reuse block
   (0019) and the profile contact fields (0009). Production: **915 signup
   reservations created, 19 ever consumed**; 39 of 60 profiles with a null name,
   phone and LinkedIn URL. Identity and device reuse are unenforced, leaving only
   the in-app rate limiter, which fails open by design.

   An integration test **did** catch this. It had been failing for eleven days
   because the suite takes 25 minutes and nobody ran it. **`0110` applied by the
   owner 2026-09-04; `signup-ip-gate.test.ts` now 6/6.** Guard landed and proven
   non-vacuous: `tests/unit/signup-gate-intact.test.ts`.
2. **No message Outlio sends can carry `List-Unsubscribe`** — the header
   builders are called by nothing and `OutboundMessage` has no field to carry
   them. No body link, no postal address. CAN-SPAM and bulk-sender exposure,
   ahead of us rather than behind us (0 rows in `email_accounts`).
3. **Eleven of seventeen flow triggers can never fire**, all of them selectable
   in the builder.
4. **`lib/crm/custom-fields.ts` has zero importers** — 326 lines, passing tests,
   two empty tables.
5. **`crm_saved_views` is a table with no code of any kind.**

Phase 0 is `COMPLETE` in the §13 sense — the deliverables exist. It is **not**
`COMPLETE` in the §10 DoD sense and is not claimed as such: there is no E2E
harness, so no UI row in the gap matrix is `VERIFIED` under §4.

## Phase 0.5 result (2026-09-04)

Approved and implemented. `tsc` 0 · lint 0 errors · **147 unit files, 2,654
tests** · 6 E2E · `next build` clean. Detail in
[`PHASE_0.5_EVIDENCE.md`](phases/PHASE_0.5_EVIDENCE.md).

- **Suite split** — `npm test` is unit-only and fast. Previously the default
  test command took 25 minutes *and wrote to production*, which is why finding
  #1 sat unread for eleven days.
- **Four structural guards**, each proven non-vacuous by breaking what it
  watches. Two were caught being wrong by that step. They found **5 orphan
  modules and 9 unused tables** where Phase 0's manual audit found one of each.
- **Email compliance closed** — `List-Unsubscribe`, body link, postal address.
- **E2E tripwire** — Playwright, `PARTIAL` not `COMPLETE`.
- **All migrations applied; history repaired.** 111 of 111 recorded.
- **ADR-002** — dead code decided per module, and one answer changed.

⚠️ **Phase 0.5 is `COMPLETE`; that is not the same as §10 `VERIFIED`.** No UI row
in the gap matrix is `VERIFIED` under §4, because the E2E harness deliberately
omits the journeys that would require signing up against production.

## Phase 1 result (2026-09-04) — COMPLETE

`tsc` 0 · lint 0 errors · **151 unit files, 2,802 tests** · 7 E2E · 14 tenant
tests. Detail in [`PHASE_1_EVIDENCE.md`](phases/PHASE_1_EVIDENCE.md).

**All eleven DoD items are `VERIFIED`.** Items 1 and 4 were `INFERRED` under
ADR-004 and are now proven, because ADR-005 created a staging project.

- **`lib/auth/scope.ts`** — a `TenantScope` only `scopeFor` can produce.
  `listContacts` took a bare `workspaceId: string`, indistinguishable from any
  other string at a call site.
- **Two live tenancy models named for the first time** — 64 tables on
  `workspace_id`, 42 on `user_id`, 18 global. The wrong filter matches nothing
  and renders as an empty state.
- **All 45 server actions and every API route are gated**, with two
  credential-exchange exceptions that assert their own rate limiting.
- **RLS measured by behaviour:** 0 tables leak to anon.
- **Tenant isolation proven by breaking it** — RLS disabled on staging, three
  read tests failed; `.eq('workspace_id', …)` removed from `getContactDetail`,
  the E2E journey failed.

⚠️ **Seven wrong scanner versions across this phase, every one wrong in the
alarming direction** — accusing correct code. The first reported "92 unscoped
service-role reads"; the true figure was zero. Publishing any of those runs
unchecked would have reported a security emergency that did not exist.

## Still open going into Phase 2

- **DECISION-04** — no mailbox. Email is proven by construction and by GreenMail,
  never against a real provider.
- ⚠️ **43 `outlio-test-*@example.com` accounts in production**, legacy from when
  the suite ran there. No longer accumulating; clearing them is an owner call.
- ⚠️ **`PRODUCT_SPEC.md` does not exist and cannot be written** without the
  original prompt's sections E–CE. §2's authority order has a hole at level 4,
  so every gap-matrix status is measured against the code's own intent rather
  than a specification.
- ⚠️ **The `agency` plan's limits blob is malformed** in production and staging —
  no `credits_per_month`, so `getPlanById` throws. Harmless today because the
  plan is inactive with zero users; it must be fixed before it is ever enabled.
- **39 profiles still have a null name, phone and LinkedIn URL** from the 0070
  window. Values survive in `auth.users.raw_user_meta_data`; a backfill is a
  separate migration, and guessing is worse than a visible null.
- ~~**Role-based denial with a real under-privileged user** is untested at the
  route layer.~~ **Closed 2026-09-05** — `e2e/role-denial.spec.ts` puts a real
  `setter` inside another member's workspace. It found a leak: see below.

## Phase 2 result (2026-09-05) — COMPLETE

`tsc` 0 · lint 0 errors · **154 unit files, 2,844 tests** · 9 E2E · build clean ·
§7 worst p95 **5.0ms** against an 800ms budget. Detail in
[`PHASE_2_EVIDENCE.md`](phases/PHASE_2_EVIDENCE.md).

**All eleven DoD items are `VERIFIED`.**

- **§7 fixture and measurement** — 100k contacts on staging, every list scenario
  on an index. DECISION-08 option A: activities deferred to Phase 14, which is
  the phase that uses them.
- **Migration 0112** — an index for `full_name`, the sort that had none. The plan
  was a parallel seq scan over the whole workspace on every page.
- **Filters** — tag (AND), company, created range, `hasEmail`, source.
- **Bulk actions** — tag, add-to-list, soft delete, behind one helper holding the
  permission, the bound and the empty-selection refusal.
- **Private saved views** — DECISION-09.

⚠️ **The benchmark measured my own network first**, reporting PASS at 766ms and
FAIL at 1149ms for the same query an hour apart. Rewritten to take the verdict
from `EXPLAIN (ANALYZE, BUFFERS)`. Testing that guard by dropping 0112's index
produced p95 397.5ms — **under budget, so the clock said PASS** — while scanning
3,102 buffers. The plan check fails it anyway.

## Still open going into Phase 3

- ~~Saved views have no UI.~~ **Closed 2026-09-05** — interface shipped, round
  trip proven end to end.
- ~~**Role-based denial with a real under-privileged user**, carried from
  Phase 1.~~ **Closed 2026-09-05.**
- **DECISION-04** — no mailbox.
- ⚠️ **The `agency` plan's limits blob is malformed** in production and staging.
  Inactive with zero users; must be fixed before it is enabled.
- ⚠️ **43 legacy `outlio-test-*` accounts in production**, no longer accumulating.
- ⚠️ **`PRODUCT_SPEC.md` still does not exist**, so §2's authority order has a
  hole at level 4.

## Phase 3 result (2026-09-05) — COMPLETE

`tsc` 0 · lint 0 errors · **155 unit files, 2,857 tests** · 10 E2E · build clean.
Detail in [`PHASE_3_EVIDENCE.md`](phases/PHASE_3_EVIDENCE.md).

**All eleven DoD items are `VERIFIED`.**

- **2,294 evidence rows became reachable.** They were correctly stored and
  entirely invisible — `crm_contact_emails` carried `source` (an enum), never a
  citation, so the page a value came from was unrecoverable once bridged.
- **`0113`** — `evidence_id`, nullable and `ON DELETE SET NULL`, because evidence
  expires while the address stays true.
- **Companies needed no migration** — `source_company_id` is an exact structural
  link, so DECISION-10's objection (matching on *value*) does not apply.
- **`safeSourceUrl`** — `source_url` is attacker-influenced data in an `href`.
  Rejected, never sanitised.
- **DECISION-11** — `lead_engine` with no citation is `unknown`, not "entered".

⚠️ **Rule 4's purpose is not only that we avoid fabricating — it is that a stored
value can be CHECKED.** A citation nobody can reach did not achieve that.

## Still open going into Phase 4

- **12 of 64 production emails are honestly backfillable**; the other 52 have no
  source lead and are already correct. An owner decision, now bounded.
- ~~**Role-based denial with a real under-privileged user** (Phase 1).~~
  **Closed 2026-09-05** — and it found a real leak, recorded below.
- ~~**Most company evidence has no home**~~ **Closed 2026-09-05** — funding,
  tech stack, news and socials now render in a "More details" section on both
  the company and the contact page, each item carrying its citation.
  `company_links` and `company_signals` remain on the unused-schema allowlist.
- **DECISION-04** — no mailbox.
- ⚠️ **The `agency` plan's limits blob is malformed**; inactive with zero users.
  ⚠️ **The outage risk is fixed** (2026-09-05): `listActivePlans` skips a plan
  it cannot read instead of throwing, so activating it no longer takes /admin
  and /dashboard/access down for everyone. The blob itself is unchanged — the
  allowance is a pricing decision, and 0002 seeded the row as "PLACEHOLDER —
  pending final pricing".
- ⚠️ **43 legacy `outlio-test-*` accounts in production.**
- ⚠️ **`PRODUCT_SPEC.md` still does not exist.**

## Work already done outside this contract

This repo was worked extensively before the contract was adopted. That work is
not retro-labelled `VERIFIED` — §4 applies from adoption forward. The prior
state is recorded in `docs/SYSTEM_HANDOFF.md`, which distinguishes what was
verified against production from what was not.


---

## Role denial, closed 2026-09-05 — and what it found

`e2e/role-denial.spec.ts` closes the gap Phase 1 recorded and Phase 2 deferred:
a real `setter`, a real member of somebody else's workspace, refused by the
server rather than by a hidden button.

**It found a leak on its first probe.**

`/dashboard/settings/developers` called `requireWorkspace()` and used the
`workspace.settings.manage` permission only to decide which CONTROLS rendered.
Measured on staging, as a `setter` — the second-lowest role:

```
LEAKS   api key NAME
LEAKS   api key PREFIX
LEAKS   webhook URL (token-bearing)
safe    webhook signing secret
```

⚠️ **A webhook URL is a credential.** Slack, Teams and Zapier put a bearer token
in the path; holding the URL is holding the secret. The API key itself was never
at risk — the hash is not selected and a prefix cannot be used — so the exposure
was the inventory plus one live secret.

⚠️ **The notifications page one directory over already knew this**, and passes
only `hostOf(url)` with a comment saying exactly why. Same repo, same risk,
opposite handling, and nothing compared the two.

⚠️ **`requireWorkspacePermission` existed the whole time.** It is named in
`context.ts`'s own header as the guard pages call, it sits in
`action-authorization.test.ts`'s allowlist — and it had **zero callers**. The
defect class this project keeps finding.

**Fixed:** both `workspace.settings.manage` pages now gate the route.
`tests/unit/settings-route-guard.test.ts` fails if either reverts, including the
partial revert that imports the strong guard and calls the weak one.

**Measured and NOT changed:** 61 server actions call `assertWorkspacePermission`,
so mutations were never exposed. `/crm/contacts/[id]` correctly 404s a setter
who types another member's contact id. `/dashboard/settings/team` already gates
its content on `workspace.member.view`.

**Still open:** eleven other pages load at 200 for a setter
(`/flows`, `/crm/reports`, `/crm/duplicates`, `/crm/import`, `/email/inbox` and
others). Their mutations are guarded and several render deliberately read-only,
so whether the VIEW should also be gated is a product decision per page, not a
defect — recorded here rather than changed unilaterally.
