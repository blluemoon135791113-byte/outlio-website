# Phase 0.5 — Safety net

**Status:** BRIEF — awaiting owner approval. Nothing here is implemented.
Contract §13 step 4. Per §13 step 5, Phase 1 does not start until this is
approved.

---

## What Phase 0.5 is for

Phase 0 found five defects that no type check, no linter and no build could
see, in a repo with 2,563 passing unit tests and a clean `tsc`. Four of them no
test could see either. They are all the same shape:

> **Code that is correct, tested, and never called — or rejected by the runtime
> while every check passes.**

The session that produced Phase 0 found several more of the same kind:
`SUGGESTED_STAGES` exported from a `'use server'` file (which killed every action
on the pipeline page while `tsc`, ESLint, `next build` and the whole suite stayed
green); `claimWaitingRuns` selecting only `waiting` runs so every triggered flow
hung at step one; `actorAuthorized` read by the send gate and written nowhere;
`userId` read by every AI step and written nowhere; 190 Tailwind classes pointing
at two tokens that did not exist.

The fifth — the signup gate (evidence #1) — is the one that should change how
this brief is read. A test **did** catch it, three assertions failing with
`expected null not to be null`. It had been failing for eleven days, because the
integration suite takes 25 minutes and so nobody ran it. The detection existed.
The feedback loop did not, which made the detection worthless.

Phase 0.5 is therefore not "add tests". It is: **build the specific instruments
that would have caught these, and make the instruments cheap enough to actually
run**, then close the gaps that are unsafe to carry into Phase 1. Item 2.2 —
splitting the suite so the fast half is affordable — is not housekeeping; it is
the reason a control could sit broken in production for eleven days.

## Ordering principle

Blocking items first, cheapest instrument first within a tier. Nothing in
Tier 1 is optional; nothing in Tier 3 blocks Phase 1.

---

## Tier 1 — must land before Phase 1

### 1.0 Apply migration `0110` — restore the signup gate

**The only item here that is broken in production right now**, rather than
waiting to break. Everything else in Tier 1 is exposure ahead of us.

Since 2026-08-24, `handle_new_user()` has not validated the signup reservation
token, has not claimed the device fingerprint, has not blocked email / phone /
LinkedIn reuse, and has not written the profile contact fields — because
`0070_workspaces.sql` replaced it. 915 reservations created, 19 consumed. 39 of
60 profiles with a null name, phone and LinkedIn URL. Evidence #1.

`supabase/migrations/0110_restore_signup_gate.sql` merges the gate, the profile
fields and the workspace bootstrap into one function and verifies itself against
`pg_proc`, raising `0110 failed: …` naming whichever responsibility is missing.

⚠️ **It makes signup stricter, deliberately.** After it runs, any signup without
all four 64-hex hashes and a live reservation is refused — which is what shipped
between 0019 and 0070. The server path already sends all five values on every
attempt, so the sign-up form is unaffected. What will start failing, correctly:
`admin.createUser()` without signup metadata (including seed scripts), and any
second account reusing a device, email, phone or LinkedIn URL.

**Owner action** — §3.7 puts schema changes with the owner.

**Already landed alongside it:** `tests/unit/signup-gate-intact.test.ts`, which
asserts the *last* definition of `handle_new_user` carries all five
responsibilities. Verified non-vacuous by removing 0110: 9 of 12 assertions
fail, each naming the dropped responsibility and the migration that added it.

**Not backfilled, deliberately.** The 39 profiles cannot be repaired from this
migration. The values still exist in `auth.users.raw_user_meta_data`, so a
backfill is possible — as a separate data migration with its own review. Guessing
is worse than a visible null (CLAUDE.md rule 4).

### 1.1 Email compliance: header transport, body link, postal address

**Why here and not in Phase 7:** Phase 7 sends real mail. DECISION-04 is one
Google app password away from being answered. The moment a mailbox connects, the
first message Outlio sends is non-compliant with CAN-SPAM §7704(a)(3) and (a)(5)
and with Gmail's and Yahoo's bulk-sender rules — and it damages deliverability,
which CLAUDE.md rule 1 names as the asset the whole scraping revision was written
to protect.

Three pieces, in order:

1. **`OutboundMessage` gains a `headers: Record<string,string>` field**
   (`lib/email/provider.ts:52`) and every adapter passes it to the transport.
   Without this the other two are decorative.
2. **`send.ts` calls `shouldIncludeUnsubscribe()` and `unsubscribeHeaders()`**
   and attaches them. Both functions already exist and are already tested.
3. **A sender postal address**: a workspace-level column, a settings field, a
   render into the message footer alongside the unsubscribe link, and a launch
   check that refuses to start a bulk campaign without one.

**Rollback:** items 1 and 2 are additive to a nullable field. Item 3 adds a
column and a launch precondition; the precondition is the only breaking part and
is gated on campaign type.

**Definition of done:** a message sent through the GreenMail integration test is
asserted — at the received end, not at the call site — to carry
`List-Unsubscribe`, `List-Unsubscribe-Post`, a resolvable unsubscribe URL in the
body, and a postal address.

### 1.2 Apply migration `0109`

Written, unit-tested, **unapplied**. Until it runs, any user who has performed a
CRM action cannot be deleted, and the error names the append-only guard rather
than the foreign key.

**Owner action.** §3.7 puts schema changes with the owner; the file is
`supabase/migrations/0109_fix_user_fk_append_only.sql` and it verifies itself,
raising `0109 failed: N ON DELETE SET NULL foreign key(s) remain` if any survive.

### 1.3 Reachability guards

Five structural tests. Each must be verified non-vacuous by breaking the thing it
watches — a guard that passes against a deliberately broken input is worse than
no guard, and three guards written in this session were wrong the first time in
exactly that way.

| Guard | Fails when | Would have caught |
|---|---|---|
| **Trigger producer** | a `TRIGGER_TYPES` member has no `dispatchFlowTrigger`/`startRun` producer | evidence #3 (11 triggers) |
| **Orphan module** | a file under `lib/` has zero importers outside its own tests | evidence #4 (custom fields) |
| **Schema without code** | a table in the migrations is referenced by no `.from('…')` | evidence #5 (saved views) |
| **Field consumed, never produced** | a config/fact key is read and never written | `actorAuthorized`, `userId`, and the send-path headers |
| **Trigger responsibility** | the last `create or replace` of a trigger function drops a job an earlier one added | evidence #1 (the signup gate) — **already written and proven** |

The first three are mechanical. The fourth is the hardest and the most valuable
— it is the shape of the majority of this repo's real defects. The fifth exists
already as `tests/unit/signup-gate-intact.test.ts` and is currently
`handle_new_user`-specific; generalising it to every replaced function in
`supabase/migrations/` is the Phase 0.5 work.

**Expected initial state: the first four fail.** They should be landed with an
explicit allowlist of today's known offenders, so each guard blocks *new*
instances immediately and the backlog is worked down against a list rather than
a memory.

---

## Tier 2 — should land in Phase 0.5

### 2.1 `npm run typecheck`

`"typecheck": "tsc --noEmit"`. CLAUDE.md has listed this as required before the
Phase 3 gates for some time. It passes today; it is one line; there is no reason
it is not a script.

### 2.2 Split the test suite

Evidence #6: the integration suite costs roughly 25 minutes — 44 files run
serially against production over the network, ~39s each, almost all of it
round-trips. It is not broken; it is unaffordable, and a gate nobody runs is not
a gate.

- `npm test` → unit only (141 files, 2,563 tests, **37.6s**). This is the
  pre-commit gate.
- `npm run test:integration` → explicit, and honest in its name about the fact
  that it talks to production.

This is also a §3.7 matter: today, running the default test command writes to the
production database.

### 2.3 E2E harness — **DECISION-01, needs an answer**

§4 requires "Playwright test file path + passing run output" for any UI claim.
There is no harness, so **every UI row in the gap matrix is `ui=YES` on the
strength of code reading, and none is `VERIFIED` under §4**.

My recommendation remains option 1: add Playwright here, and cover exactly three
journeys to start — sign-up → workspace, upload → parsed leads, and connect
mailbox → send → reply-sync. Not a suite. A tripwire on the three paths where a
silent failure is invisible to the owner.

---

## Tier 3 — Phase 0.5 if time allows, otherwise later

### 3.1 Migration history repair — **DECISION-02, needs an answer**

`supabase migration repair --status applied` for each of the 109, so `db push`
stops trying to replay from `0001` against production. It touches production
migration metadata and therefore needs an explicit go-ahead under §3.7.

### 3.2 Seed fixtures — **DECISION-03, still open, still blocked**

§7's targets ("100k rows, filtered, < 800 ms") are unmeasurable without a fixture
set. ADR-001 authorised owner-approved production writes and **explicitly did not
unblock this**: 100k synthetic contacts and 1M activities do not belong in a
database serving 27 real workspaces. This needs either a second Supabase project
or a change to §7's targets. It is the one item I will not resolve by choosing a
default.

### 3.3 Decide the fate of dead code

`lib/crm/custom-fields.ts` and `crm_saved_views`. **Deleting them is a legitimate
answer** and probably the right one — an unused 326-line module with a passing
test file is a standing invitation to assume a feature exists. Whichever way it
goes, it should be a decision with an ADR, not a drift.

---

## Out of scope, stated so it is not assumed

- No UI design work (§13: "Do **not** design UI").
- No changes to the flow runtime beyond the trigger guard, which only observes.
- No LinkedIn work.
- No new features. Phase 0.5 adds instruments and closes two safety gaps.

---

## What I need from the owner to start

1. **Approve this brief** (§13 step 5).
2. **Apply migrations `0110` and `0109`** — 1.0 and 1.2. `0110` first; it is the
   only production defect currently in effect.
3. **Answer DECISION-01** (E2E harness) — decides 2.3.
4. **Answer DECISION-02** (migration repair) — decides 3.1.
5. **Answer DECISION-03** (a second Supabase project, or amended §7 targets) —
   decides 3.2 and unblocks Phase 2.
6. **A Google app password** for DECISION-04, whenever convenient — it does not
   block Phase 0.5, and 1.1 should land before it is used.

Items 1.1 and 1.3 need no answer and are ready to start on approval.
