# Phase status

One line per phase. `status ∈ NOT_STARTED | IN_PROGRESS | BLOCKED | COMPLETE`.
A phase is `COMPLETE` only when every DoD item in §10 is `VERIFIED` and
`PHASE_<n>_EVIDENCE.md` exists.

| Phase | Name | Status | Branch | Evidence |
|---|---|---|---|---|
| 0 | Reality audit | NOT_STARTED | — | — |
| 0.5 | Safety net | NOT_STARTED | — | — |
| 1 | Wiring sweep + authorization core | NOT_STARTED | — | — |
| 2–25 | see §9 | NOT_STARTED | — | — |

## Before Phase 0 can start

§13 step 1 requires the Environment Contract to be confirmed. It is filled
(2026-09-04) and honest, but it records five `NONE`s and one direct conflict
with §3.6 — see `04_DECISIONS_NEEDED.md`, DECISION-01 through DECISION-05.

DECISION-05 (production access) is the one that changes what any later phase is
allowed to do, and it should be answered before Phase 0.5.

## Work already done outside this contract

This repo was worked extensively before the contract was adopted. That work is
not retro-labelled `VERIFIED` — §4 applies from adoption forward. The prior
state is recorded in `docs/SYSTEM_HANDOFF.md`, which distinguishes what was
verified against production from what was not.
