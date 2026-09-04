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
