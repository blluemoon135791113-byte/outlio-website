# Phase 2 — Evidence

Date: 2026-09-04 · Branch: `platform-m1-workspaces` · Brief: `PHASE_2.md`

---

## What ran

| Command | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | 0 errors, 98 warnings |
| `npm test` (unit) | **154 files, 2,844 tests** |
| `npm run test:e2e` | **9 passed, 44s** |
| `npm run build` | clean |
| `node scripts/measure-list-latency.mjs` | worst p95 **5.0ms** vs §7's 800ms |

## Delivered

**Fixture** — `scripts/seed-volume.mjs`: 100k contacts, 30k companies, 20k
opportunities into a dedicated staging workspace in 18s. DECISION-08 option A.
Refuses to run unless the connection string contains the staging project ref.

**§7 measured** — all five list scenarios on an index, worst p95 5.0ms.

**Migration 0112** — an index for `full_name`, the sort that had none.
⚠️ **Applied to staging only; production still needs it.**

**Filters** — tag (AND), company, created range, `hasEmail`, source. Validated at
the URL boundary and again in `parseDefinition`.

**Bulk actions** — tag, add-to-list, soft delete, behind one `bulkSelection`
helper holding the permission, the 200-row bound and the empty-selection refusal.

**Private saved views** — DECISION-09. `is_shared` always written `false`; every
read filters by `owner_user_id` as well as `workspace_id`.

**Filter UI** — a plain `<form method="get">`, no client JavaScript.

## The measurement was wrong first, and wrong in the flattering direction

The original benchmark timed `supabase-js` calls **from a laptop** and compared
them against a budget written for server latency. Measured floor on that path for
a one-row query from a five-row table:

```
p50 312ms · p95 749ms · min 290ms
```

It reported **PASS at 766ms and FAIL at 1149ms for the same query on the same
data**, an hour apart, having changed nothing.

Rewritten to take the verdict from `EXPLAIN (ANALYZE, BUFFERS)`. Client RTT is
printed as context and explicitly excluded.

⚠️ **The plan check earned its keep immediately.** Dropping 0112's index to test
the guard: p95 **397.5ms — under budget, so the clock says PASS** — while doing a
seq scan over 3,102 buffers. The guard fails it anyway and names the scan.
`scripts/volume-test.sh` already said this in its header — *"The assertion is on
the PLAN, not the clock"* — and I rediscovered it the expensive way.

## DoD status

| # | Item | Status |
|---|---|---|
| 1 | E2E journey from production entry point | VERIFIED — `e2e/contact-filters.spec.ts` |
| 2 | Reachability chain named and unbroken | VERIFIED |
| 3 | RBAC matrix passes, allow and deny | VERIFIED |
| 4 | Tenant isolation via API and direct URL | VERIFIED — Phase 1 suite still green |
| 5 | Persistence survives reload | VERIFIED — filters live in the URL |
| 6 | Typecheck, lint, unit, E2E green | VERIFIED |
| 7 | No new dead exports | VERIFIED — `crm_saved_views` left the allowlist |
| 8 | Feature flag, works with it off | N/A — additive filters, no flag |
| 9 | Migration applied + rollback stated | ⚠️ **staging only**; 0112 rollback is `drop index concurrently` |
| 10 | Docs updated | VERIFIED |
| 11 | This file | VERIFIED |

⚠️ **Item 9 is the one blocking a clean `COMPLETE`.** `0112` is applied to
staging and not production. Until it is, the production contact list still does a
parallel seq scan over the whole workspace whenever anyone sorts by name.

## What I could not verify, and why

**The production plan.** Every measurement here is staging — same schema, same
migrations, free-tier compute. Production has different hardware and 49 contacts
rather than 100,000, so its *plans* should match and its *timings* will not be
comparable. That is the trade §7 accepts by asking for a budget rather than a
ranking.

**Bulk actions at scale.** They are bounded to 200 and tested for permission,
bound and workspace scoping — structurally, not by executing 200 writes.

**Role-based denial with a real under-privileged user.** Still open from Phase 1.
Every fixture creates workspace OWNERS; proving a `viewer` is refused needs a
second member and the invitation flow.

**Saved views end to end.** The module and actions are unit-tested and the table
left the unused-schema allowlist, but no E2E journey saves a view, reloads, and
restores it. The UI for views is not built — only the storage and actions are.

## Guards added, and the ones that caught something

| Guard | Caught |
|---|---|
| `bulk-action-safety` | its own blind spot — a fixed window credited one statement's safety to another |
| `contacts-href-carries-filters` | a filter in the type but not the URL builder — the bug the builder's comment already describes |
| `saved-views` | an `is_shared: true` write; a missing owner filter |
| `schema-without-code` | **shrank for the first time** when `crm_saved_views` gained code |

⚠️ **Three guards were wrong before they were right this phase**, each in the
direction of accusing correct code. That is now the expected first outcome rather
than a surprise.
