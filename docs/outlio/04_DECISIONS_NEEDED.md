# Decisions needed

Per §11 of the build contract. Each item blocks something specific. I have
continued all unblocked work; what I continued is noted per item.

Status: `OPEN` until the owner answers here.

---

## DECISION-01 — There is no E2E harness · `OPEN`

**Blocks:** §4's evidence requirement for *every* UI action, and DoD item 1
("E2E acceptance journey passes from the real production entry point") for
every phase.

No Playwright, no Cypress, no `e2e/` directory. The contract requires
"Playwright test file path + passing run output" for any UI claim. Today that
evidence cannot be produced, so under §4 every UI claim must be filed
`BLOCKED`.

I have been verifying UI behaviour by driving the deployed app in a browser and
reading back the DOM and the database. That is stronger than code-reading and
weaker than a committed test: it is repeatable by me, not by CI.

**Options**
1. Add Playwright in Phase 0.5 and accept the setup cost. The contract already
   schedules this — it is what Phase 0.5 is for.
2. Amend §4 to accept "browser-driven check + pasted DOM/DB assertion" as
   `VERIFIED` for UI, reserving Playwright for regression-critical journeys.
3. Leave as-is and accept that every UI item reads `BLOCKED`, which makes the
   status field useless.

**Recommendation:** 1. Option 3 defeats the protocol; option 2 weakens the one
mechanism the document calls its most important contribution.

---

## DECISION-02 — Migrations are applied by hand · `OPEN`

**Blocks:** DoD item 9 ("migration applied + rollback path stated") as a
repeatable step, and §5.15's expand→backfill→contract discipline.

⚠️ **Corrected 2026-09-04 (Phase 0.5).** The first version of this item said
the remote table records none of this repo's migrations and that `db push`
replays from `0001`. `supabase migration list --linked` shows the truth:
**0001–0079 are recorded; 0080–0111 are not.** The `db push` attempt failed at
`0080`'s trigram index because that is where it correctly started — not because
it went back to the beginning.

The hazard stands, smaller and better understood: `db push` would replay **32**
migrations against production, several of which are not idempotent. It was
attempted and stopped at the first one.

Hand-applying does not record anything: `0110` was applied by the owner and
verified working, and still shows `remote: ""`.

**Options**
1. Repair the migration history (`supabase migration repair --status applied`
   for each), so `db push` becomes safe and DoD 9 is mechanical. The set is
   `0080`–`0108` plus `0110` — 30 migrations, all confirmed applied. `0109` is
   **excluded because its status is unconfirmed**, and `0111` because it has not
   been applied. Marking either as applied when it is not would be worse than
   the current state: `db push` would then skip it forever.
2. Keep applying by hand and document the SQL-editor path as the official one.

### Done 2026-09-04 — option 1, and verified by behaviour

Owner ran `supabase migration repair --linked --status applied` for `0080`–`0108`
plus `0110`. Verified: **109 of 111 recorded, no version mismatches, only `0109`
and `0111` outstanding.**

The count is not the proof. `supabase db push --linked --dry-run` is:

```
LegacyDbPushMissingRemoteError: Found local migration files to be inserted
before the last migration on remote database.
  supabase/migrations/0109_fix_user_fk_append_only.sql
```

⚠️ **That refusal is the success condition, not a problem.** Before the repair,
`db push` would have replayed 32 migrations against production, several not
idempotent. Now it declines to touch anything and names one file.

The reason it names `0109` is the hazard predicted when `0109` was deliberately
excluded from the repair set: `0110` is recorded and `0109` is not, so `0109`
now sorts *before* the last remote migration and counts as out-of-order. Push
requires `--include-all` to apply it. `0111` is not mentioned — it sorts after
`0110` and is an ordinary pending migration.

### Closed — `0109` resolved 2026-09-04

A read-only `pg_constraint` query settled it by asking the database what it
currently does rather than what anyone remembered doing: **zero `ON DELETE SET
NULL` references remain** on the six append-only tables. `0109` had been applied
all along and was simply never recorded.

Recorded with `supabase migration repair --linked --status applied 0109`.

⚠️ `--include-all` was deliberately **not** used to clear the out-of-order
warning. It would have applied `0109` without anyone establishing whether it
should be — the silent-action class this item exists to prevent. The check cost
one query and produced a fact instead of an assumption.

**End state, verified:**

```
migration list : 110 of 111 recorded, only 0111 outstanding
db push --dry-run : Would push these migrations:
                      • 0111_sender_postal_address.sql
```

`db push` is now a normal tool rather than a loaded gun: it proposes exactly one
migration, the one genuinely pending. DoD item 9 is mechanical from here.

---

## DECISION-03 — No seed fixtures · `OPEN` · ⚠️ **now blocking Phase 1**

**Blocks:** §7 in full, and — as of Phase 1's brief — **DoD item 4**, the
tenant-isolation test, which needs two workspaces, two roles and seeded contacts.

⚠️ **Escalated 2026-09-04.** This was a Phase 2 concern. It is now the thing
standing between Phase 1 and a `VERIFIED` acceptance journey, because building a
tenant-isolation suite means manufacturing tenants — in the database that already
holds **43 leaked `outlio-test-*` accounts** from ordinary test runs. Creating
more tenants in production to prove tenants are isolated is not a trade I will
make silently.

**Two ways forward:** a second Supabase project, or Phase 1's journey is checked
by hand once and filed `INFERRED` rather than `VERIFIED` — which weakens §4 for
the one phase where isolation is the whole subject.

**Still open after DECISION-05.** Owner-authorized writes do not make it sensible
to put 100k contacts and 1M activities into production alongside 23 real
workspaces.

There is no seed script. The live workspace has 44 contacts.

**Recommendation:** build the generator in Phase 0.5, against a
non-production database (see DECISION-05). Seeding 100k contacts and 1M
activities into production is not something I will do.

---

## DECISION-04 — No mailbox connected · `OPEN`

**Blocks:** Phase 7 entirely, which the contract deliberately moved up to
position 7 precisely because nothing downstream is real until email is proven.

As of 2026-09-04: 0 rows in `email_accounts`. An attempt was made and failed;
the cause was a misleading error message, now fixed — Gmail returns `535` for a
bad app password and the classifier was reporting it as a permanent message
rejection. Retrying needs a Google **app password**, not an account password.

`npm run test:email` runs SMTP send and reply-sync against a local GreenMail
container. That proves the mechanics; it does not prove deliverability,
threading against a real provider, or bounce handling.

**Owner action:** two authorized mailboxes, ideally on two providers.

---

## DECISION-05 — `PROD_ACCESS: FORBIDDEN` conflicts with how this repo is worked · `ANSWERED 2026-09-04`

**This is the item I would answer first.**

§3.6 says "never connect to prod" and §3 sets `PROD_ACCESS: FORBIDDEN`. That is
not the current reality, and pretending otherwise would make the contract
decorative from day one:

- `.env.local` holds a live `SUPABASE_SERVICE_ROLE_KEY`. Every integration test
  runs against production.
- Work done on 2026-09-04 against production includes: deleting 121 test
  workspaces and their users, running `runTick()`, creating and soft-deleting
  test contacts, publishing a flow version, and deleting a flow and a deal at
  the owner's instruction.
- There is no staging environment to move that work to.

**Options**
1. Stand up a staging Supabase project, point `.env.local` at it, and make
   `PROD_ACCESS: FORBIDDEN` true. Cost: one more Supabase project.
2. Amend §3 to `PROD_ACCESS: READ + OWNER-AUTHORIZED WRITES`, and add a rule
   that destructive production operations require an explicit instruction in
   the session — which is how the workspace cleanup was actually handled.

**Recommendation:** 1 before Phase 2, because §7's fixtures (DECISION-03)
cannot go into production. Until then, 2 is the honest description of what is
happening.

### Answer — option 2

`PROD_ACCESS: READ + OWNER-AUTHORIZED WRITES`. Recorded as ADR-001 and
implemented as §3.7, which sets out what proceeds without asking, what needs an
explicit instruction every time, and the standing requirements — inspect before
destroying, two signals for a pattern-matched selection, test one before many,
re-read state after a bulk write.

⚠️ **This does not unblock DECISION-03.** Authorizing writes is not the same as
it being wise to seed 1M synthetic activities into the database serving real
customers. §7's fixtures still need a second project or a change to the targets.

---

## DECISION-06 — §5.2 requires `permissions.yaml`; the repo uses TypeScript · `OPEN`

**Authority conflict.** §2.1 says running code beats the contract. §5.2 says
`permissions.yaml` is "the single source of truth" and that types are generated
from it.

The repo has 45 permissions in `lib/workspaces/permissions.ts` as a typed
`Record`, with one pure resolver (`lib/auth/decide.ts`) and a total role
hierarchy. It satisfies §5.2's *intent* — one source, one function, generated
types — by a different mechanism, and it already has matrix tests.

**Options**
1. Keep TypeScript, amend §5.2, note it as an ADR. No behaviour changes.
2. Generate `permissions.yaml` from the TS and make YAML the source. Real churn
   for no functional gain.

**Recommendation:** 1. §2 already decides this — the repo wins — but the
contract text should be corrected rather than silently ignored.

---

## DECISION-07 — Where does the existing gap matrix go? · `RESOLVED 2026-09-04`

`docs/OUTLIO_FUNCTIONAL_GAP_MATRIX.md` already exists from the earlier ADVANCE
brief, in prose. §8 requires `02_GAP_MATRIX.csv`, machine-checkable, one row per
capability with `file:line`.

**Resolved by doing it.** Phase 0 generated `docs/outlio/02_GAP_MATRIX.csv`
fresh — 78 capability rows, every one carrying a `file:line`. The prose file is
kept as history and is not maintained. No owner answer was needed; this was mine
to decide and the recommendation stood.

---

## Not blocking, but worth knowing

- **`docs/SYSTEM_HANDOFF.md`** (written 2026-09-04) already covers much of what
  Phase 0's narrative audit asks for, with production-verified claims. It is a
  head start on Phase 0, not a substitute for the CSV.
- **§6.2 email law — checked in Phase 0, and the answer is bad.** Neither
  `List-Unsubscribe` nor a postal address is emitted on send. The header
  builders (`lib/email/unsubscribe.ts:134`, `lib/email/campaign-policy.ts:131`)
  are called by nothing, and `OutboundMessage` (`lib/email/provider.ts:52`) has
  no `headers` field to carry them through, so this is not a one-line
  reconnection. A sender postal address does not exist anywhere in the codebase.
  Nothing has been sent — `email_accounts` is 0 rows — so the exposure is ahead
  of us. Moved from "Phase 7/8 finding" to **Phase 0.5 Tier 1**, because
  DECISION-04 is one app password away from making it live.
- **Three of §5's decisions already match the repo**: 5.1 (Postgres-native
  queues with `FOR UPDATE SKIP LOCKED`), 5.4 (hybrid custom fields — the repo
  has both `crm_custom_field_definitions` and `crm_custom_field_values`), and
  5.8 (`Message-ID`/`In-Reply-To` threading, migration 0104). No conflict.
