# Phase status

One line per phase. `status ∈ NOT_STARTED | IN_PROGRESS | BLOCKED | COMPLETE`.
A phase is `COMPLETE` only when every DoD item in §10 is `VERIFIED` and
`PHASE_<n>_EVIDENCE.md` exists.

| Phase | Name | Status | Branch | Evidence |
|---|---|---|---|---|
| 0 | Reality audit | **COMPLETE** | `platform-m1-workspaces` | [`02_GAP_MATRIX.csv`](02_GAP_MATRIX.csv) · [`PHASE_0_EVIDENCE.md`](phases/PHASE_0_EVIDENCE.md) · [`PHASE_0_AUDIT.md`](phases/PHASE_0_AUDIT.md) |
| 0.5 | Safety net | **BLOCKED** — brief awaiting approval | — | [`PHASE_0.5.md`](phases/PHASE_0.5.md) |
| 1 | Wiring sweep + authorization core | NOT_STARTED | — | — |
| 2–25 | see §9 | NOT_STARTED | — | — |

## Phase 0 result (2026-09-04)

Ran: `tsc --noEmit` exit 0 · `npm run lint` 0 errors / 97 warnings ·
`vitest run tests/unit` 141 files, 2,563 tests, all passed, 37.6s ·
42-table read-only production census. The integration suite exceeded 10 minutes
without completing and is itself a finding.

Four defects found that no type check, linter, build or test could see:

1. **No message Outlio sends can carry `List-Unsubscribe`** — the header
   builders are called by nothing and `OutboundMessage` has no field to carry
   them. No body link, no postal address. CAN-SPAM and bulk-sender exposure,
   ahead of us rather than behind us (0 rows in `email_accounts`).
2. **Eleven of seventeen flow triggers can never fire**, all of them selectable
   in the builder.
3. **`lib/crm/custom-fields.ts` has zero importers** — 326 lines, passing tests,
   two empty tables.
4. **`crm_saved_views` is a table with no code of any kind.**

Phase 0 is `COMPLETE` in the §13 sense — the deliverables exist. It is **not**
`COMPLETE` in the §10 DoD sense and is not claimed as such: there is no E2E
harness, so no UI row in the gap matrix is `VERIFIED` under §4.

## Blocking Phase 0.5

Per §13 step 5, Phase 1 does not start until the Phase 0.5 brief is approved.
Open: DECISION-01 (E2E harness), DECISION-02 (migration history repair),
DECISION-03 (§7 fixtures — still blocked after ADR-001), DECISION-04 (mailbox),
DECISION-06 (`permissions.yaml` vs TypeScript).
DECISION-05 (production access) was answered 2026-09-04 → ADR-001, §3.7.

⚠️ **Migration `0109` is written, unit-tested and unapplied.** Until it runs, a
user who has performed any CRM action cannot be deleted and the error blames the
append-only guard instead of the foreign key.

⚠️ **`PRODUCT_SPEC.md` does not exist and cannot be written** without the
original prompt's sections E–CE. §2's authority order therefore has a hole at
level 4, and every status in the gap matrix is measured against the code's own
intent rather than against a specification.

## Work already done outside this contract

This repo was worked extensively before the contract was adopted. That work is
not retro-labelled `VERIFIED` — §4 applies from adoption forward. The prior
state is recorded in `docs/SYSTEM_HANDOFF.md`, which distinguishes what was
verified against production from what was not.
