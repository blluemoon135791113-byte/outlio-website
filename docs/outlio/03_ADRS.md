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
