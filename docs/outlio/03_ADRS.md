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

---

## ADR-003 — Permissions stay in TypeScript; §5.2 is amended

**Date:** 2026-09-04 · **Status:** Accepted · **Supersedes:** §5.2 · **Closes:** DECISION-06

§5.2 names `permissions.yaml` as the single source of truth for authorization,
with types generated from it. The repo instead holds 45 permissions in
`lib/workspaces/permissions.ts` as a typed `Record`, resolved by one pure
function (`decidePermission`, `:246`) over a total role hierarchy, with matrix
tests.

**Decision: keep TypeScript.** §2.1 already settles this — running code outranks
the contract — but the contract text was corrected rather than quietly ignored,
which is the point of writing it down.

The repo satisfies §5.2's *intent* by a different mechanism: one source, one
resolver, types that cannot drift from it. Moving to YAML would add a generation
step, a build-time failure mode and a second file to keep in sync, in exchange
for nothing a reader or a test can detect.

⚠️ **What the decision does not excuse.** §5.2's real requirement is that
authorization has exactly one definition. TypeScript satisfies that for
*permissions* and did **not** satisfy it for *tenancy*, which had no single
definition at all until `lib/auth/scope.ts`. The YAML question was the less
important half of §5.2 and answering it should not imply the other half was fine.

---

## ADR-004 — Phase 1's tenant-isolation journey is filed `INFERRED`

**Date:** 2026-09-04 · **Status:** Accepted · **Closes:** DECISION-03 for Phase 1 only

DoD item 4 requires a tenant-isolation test "via API and via direct URL". That
needs two workspaces, two roles and seeded contacts.

`.env.local` points at production. Ordinary test runs have already left **43
`outlio-test-*` accounts** there. Building a tenant-isolation suite would mean
manufacturing tenants in the live database in order to prove tenants are
isolated.

**Decision: do not create the fixtures. File the journey `INFERRED`, not
`VERIFIED`,** and say so wherever the status appears.

**Options rejected and why:**
- *A second Supabase project* — the right answer, and a recurring cost the owner
  declined for now.
- *Reuse the 27 real workspaces* — a cross-tenant test that writes to a
  customer's workspace to prove it is protected is self-evidently unacceptable,
  and a read-only version cannot test writes, which is where isolation fails.

⚠️ **What this costs, stated plainly.** Phase 1's subject is tenant isolation,
and it will close with its central property unproven by test. What *is* proven:

- **Zero tables leak rows to an anonymous client** — measured against production,
  86 rejected outright, 21 positively protected, 17 inconclusive because empty.
- **Every table's tenancy is classified and checked against the real schema** —
  `tests/unit/tenant-scope.test.ts`, 131 assertions, verified non-vacuous both
  ways.
- **The v1 API cannot express a cross-tenant read** — `apiRoute` takes the
  workspace from the key and handlers have no way to read one from the request.

What is **not** proven is the runtime behaviour of a signed-in member of
workspace A requesting workspace B's record. That remains an inference from the
code, and it is exactly the kind of inference Phase 0 was written to distrust.

**Revisit when** DECISION-03 is answered with a second project. This ADR is a
concession to circumstance, not a judgement that the test is unnecessary.

---

## ADR-005 — A staging Supabase project, and integration tests move off production

**Date:** 2026-09-04 · **Status:** Accepted · **Closes:** DECISION-03 · **Supersedes:** ADR-004's premise

### Context

`.env.local` pointed at production and `tests/setup.ts` loaded it, so **`npm test`
wrote to the database serving real customers.** A census found **43
`outlio-test-*@example.com` accounts** left there by ordinary runs. ADR-004 had
already conceded Phase 1's tenant-isolation journey to `INFERRED` because proving
tenants are isolated would have meant manufacturing tenants in production.

### Decision

Create `outlio-staging` (`ahfyvhibzgxrhfjobbqn`, `us-east-2`, Outlio org) and
point the integration suite at it.

**Cost: none.** The Outlio organisation is on the **free plan** — established
not by reading docs but by the API refusing `--size micro` with *"Instance size
cannot be specified for free plan organizations"*. Free tier allows two active
projects per org and this is the second.

`us-east-2` matches production, so latency behaviour stays comparable.

### How the switch works

`tests/setup.ts` prefers `.env.staging` when it exists, falls back to
`.env.local`, and `OUTLIO_TEST_TARGET=production` forces the old behaviour.

⚠️ **The default is the safe one, deliberately.** A developer who has not set
staging up still runs against `.env.local` and nothing breaks; anyone who has
gets isolation without remembering a flag. The suite now prints a warning when
it is about to write to production, because 43 accounts accumulated there
precisely by nobody being told.

**Verified by observation, not by reading the code:** default run reports
`https://ahfyvhibzgxrhfjobbqn`, `OUTLIO_TEST_TARGET=production` reports
`https://ptewhpmxzenbmxlizxhu`.

### The thing this incidentally proved

⚠️ **All 111 migrations applied cleanly to an empty database, in order, for the
first time ever.** Production was built by hand over months; nobody had run the
set start to finish. It works — including `0080`'s trigram index, which failed
against production during the `db push` attempt and applies fine here because
`0024_move_pg_trgm_extension` runs before it in a clean sequence.

That is a real check on the migration set that the repaired history (DECISION-02)
made possible and that no amount of reading could have produced.

### Consequences

- Phase 1's tenant-isolation journey can now be **built and `VERIFIED`**, which
  ADR-004 conceded as `INFERRED`. That concession is withdrawn.
- §7's scale fixtures have somewhere to go.
- The 43 production test accounts are still there. They are now *legacy* rather
  than an ongoing leak, and clearing them is a separate owner decision.
- ⚠️ **Staging holds no customer data and must never be pointed at by
  `.env.local`.** Both files carry a header saying so.
- The staging database password lives in `.staging-db-password`, gitignored and
  `chmod 600`. It was generated, never reused from anywhere.
