# Phase 2 — CRM table: filter, sort, pagination, bulk actions, saved views

Per §10. Status: **BRIEF — contains one open question with a cost implication,
so it needs approval before implementation.**

---

## GOAL

§9: *"CRM table: server-side filter/sort/pagination, bulk actions, saved views"*.

⚠️ **Most of the first third already exists.** The honest goal is therefore
narrower than the phase title suggests, and saying so up front is the point of a
brief:

1. **Measure** the existing list against §7's target on real hardware.
2. **Widen filters and sorts** to what a CRM table needs.
3. **Bulk actions** beyond the single one that exists.
4. **Saved views** — currently a table with no code at all.

## OUT OF SCOPE

- Opportunity/Kanban work (Phase 6).
- Contact and company detail surfaces (Phase 3).
- The 1M-activity fixture — see the open question.
- Wiring the 11 dead flow triggers (Phase 4).

---

## CURRENT STATE

`VERIFIED` by reading the code and measuring staging on 2026-09-04.

**Server-side filtering, sorting and pagination are largely built.**
`lib/crm/contacts-list.ts:84` already supports `search`, `ownerUserId`,
`unassignedOnly`, `page`, `pageSize`, `sort`, `direction` — all applied in
Postgres, none in the browser. `app/(product)/crm/contacts/page.tsx:63`
validates `sort` against an allowlist before it reaches `.order()`.

⚠️ **Only two columns are sortable (`full_name`, `created_at`), and that is a
deliberate decision I should not casually reverse.** The file explains why:
company, email, owner and last-activity are resolved in four batched lookups
*after* the page is fetched, so sorting on them could only sort the 25 rows
already in hand — which looks identical to a real sort and is wrong the moment
there is a second page. Widening the sort set means moving those resolutions
into the query, not relaxing the allowlist.

**One bulk action exists:** `bulkAssignAction` (`lib/crm/contact-actions.ts:247`).

**Saved views are a table and nothing else.** `crm_saved_views` has zero
references in `app/`, `lib/` and `components/` — Phase 0 evidence #5, and still
on `schema-without-code`'s allowlist.

**The count strategy is already tuned.** `count: 'estimated'` at
`contacts-list.ts:147`, with a comment recording that an exact count was
measured touching all 100,000 rows on every page load.

**Indexes present on `crm_contacts`:** workspace+created, owner, company,
name trigram, linkedin unique, merged-into, source-lead.

**Volume tooling exists — and its own limitation is now removable.**
`scripts/volume-test.sh` replays the real schema into a throwaway local Postgres
and asserts on query *plans*. Its header says plainly that this "does NOT prove
wall-clock latency on Supabase's hardware over the network". That was correct
when written, because the only alternative was seeding production. **ADR-005
changed that** — staging is real Supabase hardware, and §7's target is stated in
milliseconds.

## WHAT ALREADY WORKS (`VERIFIED`)

- Filtering, sorting, paging in Postgres — `lib/crm/contacts-list.ts:84`
- Sort allowlist validation — `app/(product)/crm/contacts/page.tsx:63`
- Tenant scoping through `TenantScope` — Phase 1, `lib/auth/scope.ts`
- Tenant isolation for contacts, proven at the data layer and at a URL
- `bulkAssignAction`, permission-gated

## WHAT IS MISSING

1. **A measurement.** No wall-clock number exists for §7's "< 800 ms, 100k rows,
   filtered". The `estimated` count comment implies prior local measurement; §7
   asks for server latency at scale.
2. **Filter dimensions** — no tag, company, created-range, has-email, or
   source filter.
3. **Sortable columns** beyond two, which needs the join work described above.
4. **Bulk actions** — no bulk tag, bulk list-add, bulk delete, or export-selection.
5. **Saved views** — nothing.
6. **Scale fixtures** — no seed script exists at all.

## ARCHITECTURE TO REUSE

- `lib/crm/contacts-list.ts` — extend `ListContactsOptions`, do not fork it
- `lib/auth/scope.ts` — `TenantScope` / `scopedFrom`
- `lib/crm/contact-actions.ts` — `bulkAssignAction` is the model for bulk work
- `scripts/volume-test.sh` + `volume-queries.sql` — the query shapes are already
  copied from the real modules; point them at staging rather than rewriting
- `components/crm/ContactsTable.tsx` — `contactsHref()` is the single URL builder

## DO-NOT-TOUCH

- The sort allowlist's *reasoning*. Widen it by fixing the query, never by
  adding a column the base query cannot order by.
- `crm_activities` and the other append-only tables — `ON DELETE SET NULL` is
  incompatible with them (0091, 0109).
- The flow runtime; the landing page (CLAUDE.md rule 5).
- Production. Fixtures go to staging only.

## MODELS / MIGRATIONS / APIs / EVENTS / PERMISSIONS / WORKERS / PROVIDERS

- **Migrations:** likely two — indexes to support new filters, and whatever
  `crm_saved_views` needs to be usable. Owner-applied; now also testable on
  staging first, which no previous migration in this project has been.
- **Permissions:** saved views need at least `crm.view.manage`. Shared vs
  private views is a product question I will raise rather than assume.
- **APIs / events / workers / providers:** no change expected.

## TESTS TO WRITE

| Kind | Test |
|---|---|
| Unit | every filter combination builds the intended query; the sort allowlist rejects unknown input |
| Reachability | each declared filter is reachable from the UI, and each has a producer |
| RBAC | bulk actions refuse a role lacking the permission |
| Tenant | a saved view cannot be read or applied across workspaces |
| Performance | §7's target, measured on staging, reported as a number |
| E2E | filter → sort → page 2 → bulk-select → act, from a real URL |

⚠️ Every guard verified non-vacuous by breaking what it watches. Seven scanner
versions were wrong in Phase 1 and every one accused correct code.

## E2E ACCEPTANCE JOURNEY

1. Sign in; open Contacts with 100k rows seeded.
2. Filter by owner — results and count both change.
3. Add a second filter — they compose, not replace.
4. Sort by a column; confirm page 2's first row follows page 1's last.
5. Select rows across a page boundary; apply a bulk action.
6. Save the current filter set as a view; reload; it restores.
7. A second workspace cannot see or apply that view.

## SECURITY + COMPLIANCE NOTES

- Saved views store user-authored filter state that is later interpolated into a
  query. It must be validated as an allowlist, never passed through — the
  existing `isContactSort` guard is the model.
- Bulk actions multiply the cost of a missing permission check by the selection
  size.

## COST IMPACT

**Potentially one recurring cost — see the open question.** Nothing else.

## OPEN QUESTIONS

**1. ⚠️ §7's fixture does not fit on the free tier, and I have measured rather
than guessed.**

§7 requires *"100k contacts, 30k companies, 20k opportunities, 1M activities in
one workspace"* before Phase 2.

Measured on staging: `crm_contacts` averages **146 bytes/row**, `crm_activities`
**213 bytes/row**. So the heap alone is ~15 MB + ~213 MB, and `crm_contacts`
carries nine indexes including a trigram index, which are typically larger than
the heap they cover. Realistic total: **400–550 MB**.

**Supabase's free tier caps a database at 500 MB**, and the project goes
read-only when exceeded. Staging is currently 23 MB.

Three ways forward:

| Option | Cost | Consequence |
|---|---|---|
| **A. Seed what Phase 2 actually measures** (100k contacts, 30k companies, 20k opportunities; activities deferred) | none | §7's list-latency target is fully measurable. The 1M-activity figure exists for dashboard rollups, which is **Phase 14**. |
| B. Seed all of §7 | none until it breaks | Likely exceeds 500 MB mid-run and leaves staging read-only. |
| C. Upgrade staging to Pro | **~$25/month** | Everything in §7 measurable now. |

**Recommendation: A.** It measures every target Phase 2 is judged against, costs
nothing, and defers the one figure Phase 2 does not use. If Phase 14 needs 1M
activities, C is a decision to take then, with the reason visible.

**2. Saved views: shared or private?** A view a manager saves for the team is a
different feature from one an individual saves for themselves — different
permissions, different tenancy, different UI. I will not guess. Default
recommendation: **private first**, with a `shared` flag deferred, because the
private case is a strict subset and shipping it does not foreclose the other.
