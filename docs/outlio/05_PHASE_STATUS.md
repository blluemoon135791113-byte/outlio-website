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


---

## A module layout does not stop its pages running (2026-09-05)

Finishing the role audit — nine pages were still unprobed after the first two
found a leak — turned up a bug one level below the one it was looking for.

All three module layouts (`crm`, `email`, `flows`) refuse by rendering an
EmptyState **instead of** `{children}`. Each calls itself "THE ACCESS BOUNDARY".

⚠️ **Next renders the layout and the page together.** Dropping `{children}`
hides the page's output; it does not stop the page component executing,
querying, or having its result serialised into the RSC flight payload that
ships to the browser. Measured on staging:

```
/flows as a setter        visible: false   payload: TRUE
                          → "children":"ZZFLOW Owners Secret Automation"
/crm/contacts, module off visible: false   payload: TRUE
                          → contact rows, under "not included in your plan"
```

⚠️ **The second case uses the OWNER** — the highest role there is. Only the
module is missing. A workspace that downgrades, or never had CRM, still has its
contact data sent to the browser on every visit, readable in View Source. That
is an entitlement bypass rather than a cross-tenant leak: it is the customer's
own data, shown to a customer we told could not see it.

**Fixed** across 20 pages with `workspaceContextIfPermitted`, which returns
`null` rather than redirecting — the layout still distinguishes "not in your
plan" from "not your role", and support needs those to stay different.
`tests/unit/module-page-guard.test.ts` covers every page under all three
surfaces and pins each layout's permission, so a page gated on the *wrong*
permission cannot pass by agreeing with itself.

### Two things that looked like product bugs and were not

- **Sign-in "failing" in the E2E.** `RULES.signIn` is 5 attempts per 15 minutes
  per (IP, email); the suite signed one user in seven times. The product was
  right and the fixture was wrong. ⚠️ It is invisible from outside because the
  sign-in action reports every failure with one deliberately-vague message —
  correctly, so it cannot become an account-enumeration oracle — so
  rate-limited and wrong-password are indistinguishable. The suite now signs in
  twice per file and replays cookies.
- **`waitForURL` hanging.** It waits for `load`, which the App Router never
  fires on a soft navigation. Real, and already recorded in
  `contact-filters.spec.ts` — but not the cause here. Polling the URL proved it.

### Still open

Nine pages return 200 to a setter with their mutations guarded and their data
correctly scoped. `/crm/lists` shows list names, which is right —
`crm.list.manage` is a setter permission. Whether any remaining VIEW should be
narrowed is a product decision per page, not a defect.


### What is verified about the twenty-page gating change (4a94fb0)

**Runtime, 2026-09-05.** Signed in as an entitled owner (custom plan, all
modules) and loaded every page under the three module layouts:

```
ok 200 /crm/contacts   734c   ok 200 /crm/reports             1495c
ok 200 /crm/companies  537c   ok 200 /crm/reports/dashboards   626c
ok 200 /crm/pipeline   729c   ok 200 /email                   1082c
ok 200 /crm/tasks      508c   ok 200 /email/campaigns          532c
ok 200 /crm/lists      560c   ok 200 /email/inbox              507c
ok 200 /crm/import     571c   ok 200 /email/analytics          677c
ok 200 /crm/duplicates 625c   ok 200 /flows                    589c
                                             failures: 0
```

⚠️ **The character counts are the control, not decoration.** The first attempt
at this reported ten of fourteen "passing" while every page returned an
identical 931 characters — because sign-in had silently failed and all fourteen
were the same sign-in page, matching on a word in the nav. Distinct lengths are
what proves these are fourteen different pages that actually rendered.

Each page was additionally asserted NOT to contain the layout's refusal copy, so
"gated on a permission the owner lacks" fails loudly instead of looking like a
heading that did not match.

**Statically.** `module-page-guard.test.ts` derives each page's required
permission FROM its layout and asserts they are the same string. That makes the
silent-blank-page regression structurally impossible: identical permission,
identical context, identical `decidePermission` result — so a layout that
renders `{children}` can never sit above a page that refuses.

**Not shipped.** A fourteen-page Playwright smoke test covering the same ground
was written and removed. It could not be made reliably green against `next dev`
here — sign-in intermittently failed inside the Playwright harness while
succeeding through a plain script and through the direct API seconds apart. The
evidence above was gathered the way that worked. Shipping a test I could not
stand behind would have been worse than recording the gap.


---

## Public API v1 — reviewed 2026-09-05, no defects found

Checked because it is the one authenticated surface this session had not looked
at, and it is reachable by anyone holding a key.

**Sound.** All six routes go through `apiRoute`, each declares the `:read` scope
matching its resource, and each runs exactly one query filtered by
`context.workspaceId` — a value the handler is given and cannot ask to change.
`api_key_for_hash` filters `revoked_at is null` and the expiry in SQL, and is
revoked from `public`, `anon` and `authenticated`, so only the service role can
call it. Rate limiting deliberately runs BEFORE the scope check, so a caller
hammering an endpoint they lack the scope for is still metered.

**And it is tested.** `tests/integration/public-api.test.ts` — 35 assertions,
run 2026-09-05, all passing in 105s. It already covers cross-tenant reads, a
revoked key, a missing key, a key that was never issued, a key lacking the
route's scope, a workspace id smuggled in the query string, the same in a
header, the paging cap, nonsense paging, log hygiene (no query strings, no
activity metadata) and soft-deleted records. I did not add to it; there was
nothing missing worth adding.

### ⚠️ One thing to decide: six `:write` scopes with no endpoint

`api_scope` declares `contacts:write`, `companies:write`, `opportunities:write`,
`activities:write`, `tasks:write` and `lists:write`. **No write endpoint exists** —
all six routes are `GET`.

The developer settings UI offers a `write` checkbox for every resource, so a
customer can create a key granting `contacts:write`, reasonably believe the API
accepts writes, and find that nothing does. Not a security hole: an unused scope
grants nothing, and the enforcement is `scopes.includes(required)` against a
scope no route ever requires.

It is not tracked anywhere. `schema-without-code.test.ts` watches unused TABLES,
so an unused enum value falls through it — the same defect class this project
keeps finding, one type-system level down.

**Not changed, because it is a product call.** The UI's own comment shows write
was anticipated by design ("an integration that only needs to read contacts
could also delete them"). Either hide the write checkboxes until the endpoints
land, or ship the endpoints. Leaving it offers a capability that does nothing.


---

## The integration suite, actually run (2026-09-05)

470 tests, 45 files, ~17 minutes, twice. **4 failed, 420 passed, 46 skipped —
the same four both times.**

This project lost eleven days to a broken signup gate because the suite that
caught it was never run. It had not been run this session either, across a
twenty-page authorization change and an edit to `lib/workspaces/context.ts`.
Neither of those is implicated in any failure below.

### 1. `tenant-isolation` — a security assertion that could pass against nothing ⚠️ FIXED

```
A cannot read B's contact by listing everything
AssertionError: expected [] to include '7703bc22-…'
```

The unfiltered read was returning **HTTP 500, `57014: canceling statement due to
statement timeout`** after ~8.7s, because staging carries 100,016 contacts from
the §7 volume fixture. Reproduced directly: unfiltered → 500 in 8691ms; the same
select filtered by `workspace_id` → 1 row in 344ms.

⚠️ **The test discarded the error.** `const { data } = …` turns a 500 into
`data: null`, so `ids` is `[]`, so `not.toContain(b.contactId)` PASSES — an empty
list contains nothing. The central claim, that an unfiltered list does not leak
another tenant, would have been reported as holding by a query that never ran.

Its positive control is the only reason anyone noticed. The error is now
asserted, matching the sibling test three lines above which always did. The
failure message is now the diagnosis rather than a riddle.

⚠️ **It still fails, and that is correct.** Two things are worth deciding:

- The staging volume fixture makes this query untenable today.
- **The query will not survive production growth either.** "Select every row and
  check what comes back" is the right attack to model and the wrong way to ask
  it at scale — at a million contacts it times out for everyone. Bounding it
  with `.limit()` would let it run and would weaken it: with 100k rows visible
  in another workspace, a broken RLS policy could fill the page without ever
  including B's specific contact. I did not weaken a security test to make it
  green.

### 2–3. `webhook-delivery` — two failures, shared cause

`deliverPendingWebhooks()` selects every pending delivery due now, across all
workspaces, with `limit = 20` and no workspace filter. Correct for a worker;
it makes the test sensitive to anything else pending in the shared database.
The first test got `delivered: 0`, its delivery stayed pending, and the second
then received 4 payloads where it expected 3 — consistent with the first test's
undelivered row arriving late.

### 4. `company-backfill` — `admits truncation instead of reporting a complete scan`

`listUsersWithUnlinkedLeads(1, SMALL_PAGE)` expected `truncated: true` and got
`false`, meaning it found at most one account with unlinked leads. Also a global
scan over shared state.

### The pattern, and what I did not do

All four depend on accumulated state in a shared database rather than on product
behaviour. **Only the first was traced to root cause and fixed**; for the other
three the mechanism is identified and consistent with the symptoms, but I did
not isolate them, and I am not claiming they are harmless on that basis.

I did not delete the 100k-row volume fixture to make the suite green. It is
named, deliberate, referenced by the §7 latency work, and reseedable via
`scripts/seed-volume.mjs` — removing it is the owner's call, and it would hide
the scaling question in point 1 rather than answer it.


---

## 0115 — workspace RLS could not use an index (2026-09-05)

Chasing the tenant-isolation timeout to root cause found something bigger than
the test.

**Every workspace RLS policy was O(rows-in-table), not O(rows-you-can-see).**

`is_workspace_member(workspace_id)` is `security definer`, and PostgreSQL NEVER
inlines a security-definer SQL function. So it stayed an opaque per-row call: the
planner could not turn it into an index condition, and it ran a two-table join
once per row. On staging that is 100,048 joins for one user's single contact.

Isolated by predicate — same user, same data:

```
where is_admin()                        → completes
where (select public.is_admin())        → completes
where is_workspace_member(workspace_id) → TIMES OUT      ← the culprit
```

⚠️ **`limit` did not help, which is the tell.** `limit 100`, `limit 500` and
`limit 1000` all timed out at ~8.4–8.6s: the policy must be evaluated before rows
can be discarded, so a bounded query still visits every row. That also ruled out
"just bound the test" as a fix.

### The change

```
before:  is_workspace_member(workspace_id) or is_admin()
after:   workspace_id in (select public.my_workspace_ids())
           or (select public.is_admin())
```

Both halves become uncorrelated subqueries, evaluated ONCE as InitPlans instead
of once per row, and `workspace_id in (<constant set>)` is an index condition.

**Semantically identical**, which is the only thing that matters:
`is_workspace_member(w)` is true exactly when `w` is in the caller's set of
non-deleted workspaces, and `my_workspace_ids()` returns that set from the same
two tables with the same predicates.

Applied by matching the exact predicate text, not a table list — a list of 56
tables is a list that rots. **56 policies rewritten.** The two with bespoke
predicates (email accounts; the one keyed on `id`) are deliberately untouched.
The migration refuses to report success if it matched nothing or left any old
shape behind.

### Evidence

Same query, same user, same 100,048 rows:

```
before:  Seq Scan → 57014 canceling statement due to statement timeout, ~8.7s
after:   Index Only Scan using crm_contacts_id_workspace_id_key
         Filter: ((ANY (workspace_id = (hashed SubPlan 1).col1)) OR (InitPlan 2).col1)
         actual rows=1, buffers shared hit=1486, completes
```

⚠️ **Isolation re-proven, not assumed.** Rewriting 56 security policies is the
highest-stakes change of this session; a subtly weaker predicate is a
cross-tenant leak on 56 tables. `tenant-isolation` (14) and `companies-rls` (10)
both run green afterwards — 24 of 24 — including the test that was failing,
which now passes because the query COMPLETES rather than because it returned
nothing.

### ⚠️ Status: STAGING ONLY

Applied to staging and verified there. **Not applied to production** — schema
changes are the owner's, per §3.7. The migration is self-verifying and will
raise rather than half-apply.

### What this did not fix

The other three integration failures are unrelated and remain: two in
`webhook-delivery`, one in `company-backfill`. Both come from workers that scan
globally — `deliverPendingWebhooks` and `listUsersWithUnlinkedLeads` take no
workspace filter, which is right for a worker and makes those tests sensitive to
shared-database state. Confirmed still failing after 0115.

I did not delete the 100k-row volume fixture. It is what made this visible, and
removing it would have turned a real production scaling problem back into an
invisible one.


---

## The integration suite is green (2026-09-05)

**424 passed, 0 failed, 46 skipped.** It was 420/4 this morning. All three
remaining failures were traced to root cause, and none was what I first assumed.

### `webhook-delivery` (2 tests) — two clocks in one comparison ⚠️ REAL BUG

My first guess was leftover pending deliveries; `webhook_deliveries` was empty
and `webhook_subscriptions` was zero. My second was the SSRF guard;
`assertSafeWebhookUrl` reports ALLOWED for the loopback test server, because it
permits loopback whenever `NODE_ENV` is not production. **Both plausible, both
wrong.**

`enqueue_webhook_delivery` writes `next_attempt_at` defaulting to `now()` — the
DATABASE clock. `deliverPendingWebhooks` filtered
`.lte('next_attempt_at', new Date().toISOString())` — the APPLICATION clock.
Measured skew against staging: **1914ms, 1836ms, 1887ms**. So a delivery queued
one moment was invisible to its own worker the next:

```
queued  = 1
row     = pending, attempts 0, next_attempt_at 10:40:08.595Z
outcome = { delivered: 0, retrying: 0, exhausted: 0 }   ← found nothing
row     = pending, attempts 0, untouched
```

Mild in production — both sides are NTP-synced and the next tick collects
whatever was missed, so nothing is lost — but a due-time comparison spanning two
clocks does not belong in a retry loop, and it fails deterministically on any
developer machine whose clock has drifted. **0116** adds
`due_webhook_deliveries()`, which compares on the clock that wrote the value.

### `company-backfill` (1 test) — a test that had never demonstrated its claim

`SMALL_PAGE` was 50 and the fixture seeds **6** rows (3 accounts × 2 leads), so
the first page was never full, `truncated` was always false, and the truncation
assertion could not pass. Its sibling "spans multiple pages" test passed while
paging exactly once, which is not paging.

⚠️ **It used to pass, and that is the interesting part.** The scan is global —
no user filter — and until Phase 1 this suite ran against `.env.local`, which
points at PRODUCTION, where `extracted_leads` holds 1,193 rows. Somebody else's
data filled the page. Moving to staging removed the accident and left both tests
asserting something they had never actually shown. `SMALL_PAGE` is now below the
fixture's own row count, so they hold on an empty database and on a busy one.

### The pattern across all four failures

Every one was a test that could not fail for the reason it claimed, or could
only pass because of data it did not create. Two were fixed by fixing the
product (0115, 0116); two by making the test self-sufficient. **None was fixed
by relaxing an assertion.**

⚠️ **0115 and 0116 are applied to STAGING ONLY.** Production is the owner's, per
§3.7. Staging and production schemas now differ by these two migrations.


### 0115 — the two policies it deliberately did not touch

"56 rewritten" invites "what about the rest?", so the audit, run against staging
after the migration:

```
policies now using my_workspace_ids            56
policies still calling is_workspace_member      2
WITH CHECK clauses with the old shape           0   ← writes were never affected
```

Neither remaining policy is an oversight:

- **`workspaces_select_member`** — `(is_workspace_member(id) OR is_admin())`, on
  `workspaces` itself, keyed on `id` rather than `workspace_id`. 39 rows, bounded
  by customer count. ⚠️ **And it must not be rewritten to use
  `my_workspace_ids()`, which reads `workspaces`.** The helper is
  `security definer` so it would not recurse through RLS, but a policy on a table
  defined in terms of a function that reads that table is a trap to leave
  un-set.
- **`email_accounts_select_member`** — a compound predicate that also checks
  `scope`, ownership and workspace role per row. Semantically richer than the
  shape 0115 matched, and the table holds one row per connected mailbox.

⚠️ **`WITH CHECK` was never affected, which is worth stating explicitly.** Writes
validate a single row, so the per-row cost that made reads time out never applied
to them — and confirming that is why 0115 matched on `qual` alone rather than
rewriting every predicate it could find.


---

## The E2E "dev server is on staging" guard is vacuous (2026-09-05)

Three specs — `contact-filters`, `company-details`, `tenant-isolation` — carry:

```ts
expect(
  [...supabaseHosts].filter((h) => h !== expectedHost),
  'the dev server is not on staging — use `npm run dev:staging`',
).toEqual([])
```

`supabaseHosts` is populated from browser requests during `page.goto('/sign-in')`.
**Loading that page makes no request to `*.supabase.co` at all** — confirmed
twice, once by a network listener at `networkidle` plus 1.5s, and once by reading
the network log of a live preview tab. Sign-in is a server action, so the
credentials go to Next, and Next talks to Supabase server-side.

So the filter runs over an empty set and compares it to `[]`. It passes for every
possible server, including the wrong one. ⚠️ **It is not a weak check; it is not
a check.**

### Why it is not being repaired

The protection it claims is already structural. Every E2E spec builds its admin
client from `.env.staging` explicitly — none reads `process.env` for the
service-role key — so fixtures are created in staging no matter where the app
under test points. A mismatch means the app cannot find the user that was just
created, and sign-in fails loudly on the first test.

Repairing the assertion means moving it after an authenticated page load in three
files, to detect a condition that already announces itself. Recorded instead, so
nobody reads those three lines as evidence of something they do not establish.

### ⚠️ And a correction: I built a global guard on a false premise

I wrote `e2e/global-setup.ts` to refuse any non-staging server, on the stated
grounds that "run the suite and it signs up test users in the customer database".
**That is wrong.** It describes the INTEGRATION suite's historical accident —
`.env.local` pointing at production, which is where the 43 `outlio-test-*`
accounts came from and which Phase 1 fixed. The E2E specs never had that
exposure, because each one reads `.env.staging` by name.

The implementation was also broken: with no Supabase request to observe, its
fail-closed branch refused every run, staging included. Reverted. The finding
above is what survived it, and it is worth more than the guard would have been.
