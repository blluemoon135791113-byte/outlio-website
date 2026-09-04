# Phase 1 — Evidence

Date: 2026-09-04 · Branch: `platform-m1-workspaces` · Brief: `PHASE_1.md`

---

## What ran

| Command | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | 0 errors, 97 warnings |
| `npm test` (unit) | **150 files, 2,797 tests** |
| `npm run test:e2e` | 6 passed |
| `npm run build` | clean |
| Read-only anon probe, 124 tables | completed |

## Delivered

**`lib/auth/scope.ts`** — `TenantScope`, producible only by `scopeFor` from an
authenticated `WorkspaceContext`. `listContacts` previously took
`workspaceId: string`, which is indistinguishable from any other string at a
call site; it now takes a scope. `scopedFrom` applies the filter and picks the
right column.

**The two-tenancy-model finding.** 64 tables carry `workspace_id` (CRM era), 42
carry only `user_id` (extraction era), 18 are global. Nothing named that split
before. ⚠️ `.eq('workspace_id', …)` against a user-scoped table matches nothing
and renders as an empty state — the wrong filter looks like a tenant with no
data.

**`tenant-scope.test.ts`** — 131 assertions, every table's classification checked
against its real columns including ones added by later `alter table`.

**`service-role-scoping.test.ts`** — guards service-role reads with no filter at
all.

**`action-authorization.test.ts`** — all 45 server actions and all API routes
gated, with two documented credential-exchange exceptions that assert their own
rate limiting.

**RLS, measured by behaviour:**

```
leaked to anon                                     0
rejected outright by PostgREST (42501)            86
proven protected (has rows, anon saw none)        21
inconclusive (table empty, proves nothing)        17
```

## DoD status

| # | Item | Status |
|---|---|---|
| 1 | E2E journey from production entry point | ⚠️ **INFERRED** — ADR-004 |
| 2 | Reachability chain named and unbroken | VERIFIED |
| 3 | RBAC matrix passes, allow and deny | VERIFIED |
| 4 | Tenant isolation via API and direct URL | ⚠️ **INFERRED** — ADR-004 |
| 5 | Persistence survives reload; events consumed | N/A |
| 6 | Typecheck, lint, unit, E2E green | VERIFIED |
| 7 | No new dead exports | VERIFIED — see below |
| 8 | Feature flag, works with it off | N/A |
| 9 | Migration applied + rollback | N/A — no migrations |
| 10 | Docs updated | VERIFIED |
| 11 | This file | VERIFIED |

⚠️ **Phase 1 is not `COMPLETE` under §10.** Items 1 and 4 are `INFERRED`. Its
subject is tenant isolation and its central property is unproven by test.

## What I could not verify, and why

**The tenant-isolation journey.** ADR-004. Proving it needs two workspaces, two
roles and seeded contacts; `.env.local` points at production, which already holds
43 leaked `outlio-test-*` accounts from ordinary test runs. Manufacturing tenants
in the live database to prove tenants are isolated is not a trade worth making
silently. Blocked on DECISION-03.

**Whether the *right* permission is checked.** `action-authorization.test.ts`
proves every action establishes a caller. It does **not** prove the action then
checks the appropriate permission — that `deleteContact` requires
`crm.contact.delete` rather than merely a logged-in user. Deciding that
statically needs intent, not syntax. Covered by review and by
`workspace-permissions.test.ts` at the matrix layer, with the gap stated here.

**Service-role reads filtered by something other than the tenant column.** The
guard asks "filtered at all?", not "filtered by tenant". The stricter question
produced 32 findings of which the first three inspected were all correct, each
safe by a different mechanism — most commonly "fetch parent scoped, read children
by parent id", which is not decidable without dataflow analysis.

**The 17 inconclusive RLS tables.** Empty, so an anon read returning nothing
proves nothing. Most are already on the dead-schema list.

## Guards written this phase, and how many were wrong first

Four corrections across two scanners, **every one wrong in the alarming
direction** — accusing correct code:

| Scanner | Wrong version | Effect |
|---|---|---|
| service-role | fixed 600-char window | 92 false "unscoped" |
| service-role | comments → blank lines, blank line ends a chain | better-documented scoping was *more* likely flagged |
| service-role | asked "filtered by tenant column?" | 32 findings, first 3 all correct |
| service-role | `storage.from('avatars')` treated as a table | flagged correct code |
| action-auth | GATES guessed, not enumerated | whole intelligence API called public |
| action-auth | read only the action's own body | a helper-centralised gate called public |
| action-auth | looked only for gate functions | missed 4 valid mechanisms |

⚠️ **The pattern is worth naming: a scanner's first draft is confidently wrong,
and its errors are frightening rather than reassuring.** Publishing any of these
runs unchecked would have reported a security emergency that did not exist.

**My own Phase 0.5 orphan guard caught me** leaving `lib/auth/scope.ts` with no
production importer — the authorization core, written and wired to nothing. That
is DoD item 7 and precisely the defect class this project keeps producing.
Allowlisting it was the wrong answer; it is now on `WorkspaceContext` and
consumed by the contacts list.
