# Phase 0.5 — Evidence

Approved 2026-09-04. Records what landed, what it cost, and what I got wrong
first. Companion to `PHASE_0.5.md` (the brief).

---

## Verification at the end of the work

| Command | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | 0 errors, 97 warnings |
| `npm test` (unit) | **146 files, 2,639 tests, 12.5s** |
| `npm run build` | clean |
| `npm run test:e2e` | **6 passed, 28s** |

---

## Landed

### 2.1 `npm run typecheck` — already existed

CLAUDE.md and my own brief both said this was missing. It was already in
`package.json`. Recorded because the brief was wrong, not because the work was
hard.

### 2.2 Test suite split — the item that matters most

`vitest.config.mts` now defines two projects. `fileParallelism: false` had been
set **globally** so integration tests would not race on user creation — correct
for them, and it dragged the unit tests, which open no sockets, to the same
serial pace.

- `npm test` → unit only, parallel: **37.6s → 12.5s**, and it no longer pulls in
  the 25-minute integration suite at all.
- `npm run test:integration` → explicit, and honest that it talks to production.

Before this, **the default test command wrote to the production database.**

This is not housekeeping. Finding #1 — a security control deleted by an
unrelated migration — was caught by a test that had been failing for eleven days
because nobody could afford to run the suite.

### 1.3 Reachability guards — three landed, two were wrong first

Every guard was verified non-vacuous by breaking the thing it watches. **Two
were caught being wrong by that step**, which is the entire argument for doing
it:

| Guard | Found | First version's bug |
|---|---|---|
| `trigger-producer` | 17 triggers, 6 wired | Allowlisted `call_booked`, which *does* have a call site — one behind `options.triggerFlowId` that nothing passes. Allowlisting it would have been a green guard describing the code wrongly. It has its own assertion now. |
| `orphan-module` | **5 orphans** (Phase 0 found 1) | Matched only `@/…` specifiers, so it missed relative imports and accused all 17 `lib/intelligence/providers/*`, which `providers/index.ts` imports as `'./github'`. Rewritten as a real import graph. |
| `schema-without-code` | **9 tables** (Phase 0 found 1) | Scanned only `.from()` and accused 26 live tables. `rate_limits` is reached via the `consume_rate_limit` RPC; `fastspring_orders` is written inside a SQL function. Now scans function bodies, which is the correct semantic anyway. |

New orphans beyond Phase 0: `lib/companies/links.ts`, `lib/fastspring/access.ts`,
`lib/integrations/catalogue.ts`, `lib/jobs/lead-pagination.ts`. New unused
tables: `company_links`, `company_signals`, `crm_custom_field_definitions`,
`email_templates`, `email_webhook_deliveries`, `export_destinations`, and three
`web_research_*`.

Every allowlist is asserted **in both directions**, so fixing an entry without
removing it from the list fails and says so. A one-way allowlist rots into a
permanent exemption.

### 1.1 Email compliance — finding #2 closed

- `OutboundMessage.headers` added. **Its absence was the bug**: the header
  builders were correct, tested, passing, and uncallable.
- `lib/email/compliance.ts` — one place deciding what a commercial message
  carries: both RFC 8058 headers, a visible footer link, and the postal address.
  A `manual` one-to-one message is untouched.
- Applied at **send** time, not enqueue — otherwise a message queued before the
  address was set would send without one forever.
- `0111_sender_postal_address.sql` — **written, not applied.**
- `assertLaunchable` refuses any campaign that would carry a footer without an
  address; `SenderAddress` in the email settings is where it is set.

`email-compliance.test.ts` asserts the four links **separately**, verified by
breaking each in turn. The original unsubscribe tests proved the parts; nothing
proved the join.

⚠️ One line worth noting: `hasUnsubscribeSupport: true` at the launch call site,
commented "Outlio adds the RFC 8058 header itself", had been false since it was
written. It is true now.

### 2.3 E2E harness — DECISION-01

Playwright, 6 tests, 28s. Deliberately a **tripwire, not a suite**:

- sign-in **hydrates** — the highest-value assertion here. Next dev refuses
  client chunks to an origin missing from `allowedDevOrigins`, and when it does,
  the page renders perfectly and React never hydrates. Three earlier test results
  in this project were invalidated by exactly that.
- bad credentials do not reveal which field was wrong (anti-enumeration).
- four authenticated routes redirect a signed-out visitor — proving the decision
  is server-side. Verified non-vacuous against `/pricing`, which correctly fails.

---

## Not landed, and why

### The two journeys the brief asked for are missing

Sign-up → workspace, and connect mailbox → send → reply-sync. Both are blocked,
and writing them anyway would have made things worse:

⚠️ **`.env.local` points at production, and the test suites already leave
accounts there.** A census on 2026-09-04 found **43 `outlio-test-*@example.com`
profiles**, from runs across the day. A browser-driven sign-up journey would add
more, to the database serving real customers.

That number is also a correction: I told the owner "six orphan test accounts"
earlier in this session. Six was what I got by counting profiles created after
10:00 against a baseline I had already established was stale. The real figure is
43, and the fact that **integration runs leak accounts into production at all**
is the more important half.

This is DECISION-03's strongest argument to date, and DECISION-03 is still open.

### 1.0 / 1.2 — migrations: all applied, history fully repaired

- **`0110`** applied by the owner, verified 6/6.
- **`0109`** — a read-only `pg_constraint` query showed **zero `ON DELETE SET
  NULL` references remain**, so it had been applied all along and merely never
  recorded. ⚠️ The FK hazard had therefore been closed for some time with no way
  to tell — state and record disagreeing, with nothing to notice. Recorded.
- **`0111`** applied via `supabase db push` and verified: the column is readable
  through the exact query the send path makes.

**`supabase migration list --linked`: 111 of 111 recorded, none outstanding.**
`db push --dry-run` reports up to date. Before Phase 0.5 it would have replayed
32 migrations against production.

### 3.3 — done, and it changed one answer (ADR-002)

The brief said deleting the orphaned modules was "probably the right one".
Per-module review made that wrong once, expensively.

`lib/fastspring/access.ts` mirrors `public.fastspring_subscription_grants_access`
— the SQL function that decides whether a paying customer has access. Its own
comment says "Both must change together"; nothing made that true, and the
TypeScript half was imported by nothing.

⚠️ **A dead mirror is worse than no mirror.** It reads as a second opinion that
agrees, so someone changing the billing rule updates the file they can see and
ships nothing. `fastspring-access-parity.test.ts` now parses the accepted-state
list out of the migration and asserts both agree for every state × active pair.
The list is never hard-coded — that would be a third definition. Verified
non-vacuous by flipping `canceled` → `overdue`: three assertions fail.

The other four are product decisions, recorded in ADR-002 with size and purpose.

### 3.1 — investigated, and it corrected a Phase 0 finding

⚠️ **Phase 0 said the remote migration table records none of this repo's
migrations and that `db push` "replays from 0001". Both were wrong.**
`supabase migration list --linked` shows **0001–0079 recorded, 0080–0111 not**.
The `db push` that failed at `0080`'s trigram index started there because that
is the first unrecorded migration — correct behaviour, not a replay from the
beginning.

I inferred "replays from 0001" from a failure at 0080 without checking, then
wrote it into the audit and DECISION-02 as established fact. Corrected in both.

The hazard is real and smaller: `db push` would replay **32** migrations,
several not idempotent.

The repair set is `0080`–`0108` plus `0110` — thirty migrations, all confirmed
applied. **`0109` is excluded** (status unconfirmed) and **`0111`** (not
applied). Marking either applied when it is not would be worse than doing
nothing: `db push` would skip it permanently. Not run — it writes production
migration metadata.
