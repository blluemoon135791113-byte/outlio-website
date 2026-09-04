# Phase status

One line per phase. `status ∈ NOT_STARTED | IN_PROGRESS | BLOCKED | COMPLETE`.
A phase is `COMPLETE` only when every DoD item in §10 is `VERIFIED` and
`PHASE_<n>_EVIDENCE.md` exists.

| Phase | Name | Status | Branch | Evidence |
|---|---|---|---|---|
| 0 | Reality audit | **COMPLETE** | `platform-m1-workspaces` | [`02_GAP_MATRIX.csv`](02_GAP_MATRIX.csv) · [`PHASE_0_EVIDENCE.md`](phases/PHASE_0_EVIDENCE.md) · [`PHASE_0_AUDIT.md`](phases/PHASE_0_AUDIT.md) |
| 0.5 | Safety net | **COMPLETE** | `platform-m1-workspaces` | [`PHASE_0.5.md`](phases/PHASE_0.5.md) · [`PHASE_0.5_EVIDENCE.md`](phases/PHASE_0.5_EVIDENCE.md) |
| 1 | Wiring sweep + authorization core | NOT_STARTED | — | — |
| 2–25 | see §9 | NOT_STARTED | — | — |

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

## Still open going into Phase 1

- **DECISION-03 is the binding constraint.** It blocks §7's fixtures, the
  sign-up and mailbox E2E journeys, and safely clearing the test accounts.
- **DECISION-04** — no mailbox. Email is proven by construction and by GreenMail,
  never against a real provider.
- **DECISION-06** — `permissions.yaml` vs TypeScript. No behaviour rides on it.
- ⚠️ **43 `outlio-test-*@example.com` accounts in production**, left by test runs
  across 2026-09-04. Corrects an earlier report of "six", which came from
  counting against a stale baseline. The number matters less than the mechanism:
  **integration runs leak accounts into production.**
- ⚠️ **`PRODUCT_SPEC.md` does not exist and cannot be written** without the
  original prompt's sections E–CE. §2's authority order has a hole at level 4,
  so every status in the gap matrix is measured against the code's own intent
  rather than a specification.
- **39 profiles still have a null name, phone and LinkedIn URL** from the 0070
  window. The values survive in `auth.users.raw_user_meta_data`; a backfill is a
  separate migration with its own review, and guessing is worse than a visible
  null.

## Work already done outside this contract

This repo was worked extensively before the contract was adopted. That work is
not retro-labelled `VERIFIED` — §4 applies from adoption forward. The prior
state is recorded in `docs/SYSTEM_HANDOFF.md`, which distinguishes what was
verified against production from what was not.
