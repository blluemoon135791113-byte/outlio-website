# Architecture decision records

Append-only. Newest last. An ADR is required to override anything in §5 of the
build contract, and per §2.1 it must show that the repo already does otherwise.

---

## ADR-000 — Adopting the build contract

**Date:** 2026-09-04
**Status:** Accepted

`00_BUILD_CONTRACT.md` is adopted as the engineering contract. `§2` authority
order applies: running code beats the contract, the contract beats the phase
brief, the brief beats the product spec.

**Consequence worth stating plainly:** several §5 decisions describe a system
that does not exist yet, and at least one (§5.2, `permissions.yaml`) describes a
mechanism the repo already solves differently and adequately. Those are logged
in `04_DECISIONS_NEEDED.md` rather than silently followed or silently ignored,
because silently doing either is the failure mode the contract was written to
prevent.

No ADRs supersede §5 yet. Candidates: DECISION-06 (permissions source of truth).

---

## ADR-001 — Production access is owner-authorized, not forbidden

**Date:** 2026-09-04
**Status:** Accepted (owner decision)
**Supersedes:** §3.6's "never connect to prod" and §3's `PROD_ACCESS: FORBIDDEN`
**Implemented in:** §3.7

### Context

The contract as written forbids production access. This repo has exactly one
environment: `.env.local` carries a live service-role key, all 43 integration
suites run against production, and there is no staging project.

Adopting `FORBIDDEN` unchanged would have meant a rule that is violated by the
test suite on every run. A rule nobody can follow does not constrain anything —
it gets ignored quietly, and takes the rest of the document's authority with it.

### Decision

`PROD_ACCESS: READ + OWNER-AUTHORIZED WRITES`. Reads and session-scoped writes
proceed; destructive and bulk writes require an explicit instruction in the
session, per operation, not carried between sessions. Full rules in §3.7.

### Consequences

- The contract now describes the system as it is, so §4's evidence protocol has
  something real to attach to.
- **DECISION-03 is not unblocked by this.** §7 requires 100k contacts and 1M
  activities seeded before Phase 2. Authorizing writes does not make it sensible
  to put a million synthetic activity rows in the database serving real
  customers. That still needs either a second Supabase project or a decision to
  drop the §7 targets.
- The safeguards in §3.7 are written from failures that already happened on
  2026-09-04, not from theory: a pattern-matched selection that would have
  caught real customers had it used one signal instead of two, and a reported
  count that was wrong because state was not re-read after a cascade.

### Alternative rejected

Standing up a staging Supabase project (option 1). Still the better end state,
and the right precondition for §7's fixtures — deferred, not dismissed.

---

## ADR-002 — Unreachable modules: keep, guard, or delete, decided per module

**Date:** 2026-09-04 · **Status:** Accepted · **Phase:** 0.5 item 3.3

### Context

Phase 0 found one orphan module by hand. The `orphan-module` guard built in
Phase 0.5 found five, and the `schema-without-code` guard found nine unused
tables where Phase 0 found one.

The brief said deletion was "a legitimate answer and probably the right one".
Working through them individually showed that a blanket answer would have been
wrong, and in one case actively harmful.

### Decision

Per module, not per category.

| Module | Decision | Why |
|---|---|---|
| `lib/fastspring/access.ts` | **KEEP, now guarded** | Not dead code. It mirrors `public.fastspring_subscription_grants_access`, the SQL function that decides whether a paying customer has access. |
| `lib/crm/custom-fields.ts` | **Owner decision** | 321 lines, a complete typed validator for a feature with no UI and two empty tables. |
| `lib/jobs/lead-pagination.ts` | **Owner decision** | 163 lines of paging and `ilike` escaping for a leads table that was never built. |
| `lib/companies/links.ts` | **Owner decision** | 212 lines classifying URLs into link kinds. |
| `lib/integrations/catalogue.ts` | **Owner decision, and read it first** | Its own header states `INTEGRATION_PROVIDERS` promises five integrations and three exist. |

### The one that changed my mind

`lib/fastspring/access.ts` is twenty lines and its comment says: *"This mirrors
`public.fastspring_subscription_grants_access` in SQL. Both must change
together."*

Nothing made that true. The SQL is what runs — migration 0068 calls it in two
places to gate access for paying customers — and the TypeScript was imported by
nothing.

⚠️ **A dead mirror is worse than no mirror.** It reads as a second opinion that
agrees. Someone changing the billing rule updates the file they can see, ships
nothing, and the SQL keeps deciding. The symptom is customers keeping or losing
access wrongly, and the code review that approved it looked correct.

Deleting it was the obvious move and the wrong one. `fastspring-access-parity.test.ts`
now parses the accepted-state list out of the migration and asserts both
definitions agree across every state × active combination. The list is never
hard-coded in the test — that would be a third definition, and then two of three
could drift while the test stayed green. Verified non-vacuous by flipping
`canceled` to `overdue` in the TypeScript: three assertions fail.

The module stays uncalled on purpose and is listed in `KNOWN_ORPHANS` with that
reason attached.

### Why the rest are not decided here

They are product decisions, not engineering ones. Whether Outlio should have
custom fields is not something to settle by noticing the validator is uncalled.
What Phase 0.5 owes is that the situation is **visible and cannot grow**, and
both guards do that: allowlists are asserted in both directions, so wiring a
module up without removing its entry fails and says so.

⚠️ The cost of leaving them is not the bytes. It is that the next reader finds a
tested module, a populated schema and a passing suite, and concludes the product
has custom fields. Phase 0 had to check production row counts to establish that
it does not.

### Consequences

- One billing rule that was silently unenforced across two definitions is now
  checked on every `npm test`.
- Four modules and nine tables are listed, each with a decision owed.
- `crm_custom_field_values` is **not** on the unused-table list while
  `crm_custom_field_definitions` is — it appears in a SQL function body. Half
  the feature is reachable from the database and half is not, which is worth
  knowing before anyone decides to finish or drop it.
