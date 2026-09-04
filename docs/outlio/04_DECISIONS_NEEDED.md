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

The remote `supabase_migrations.schema_migrations` table does not record the
109 migrations in this repo, because every one was applied by pasting into the
SQL editor. Consequence, established 2026-09-04: **`supabase db push` tries to
replay from `0001` against production.** It was attempted and failed at 0080's
trigram index before doing damage. That was luck.

**Options**
1. Repair the migration history (`supabase migration repair --status applied`
   for each), so `db push` becomes safe and DoD 9 is mechanical.
2. Keep applying by hand and document the SQL-editor path as the official one.

**Recommendation:** 1, done in Phase 0.5 — but it touches production migration
metadata, so it needs an explicit go-ahead.

---

## DECISION-03 — No seed fixtures · `OPEN`

**Blocks:** §7 in full. Every numeric target ("100k rows, filtered, < 800 ms")
is unmeasurable without the fixture set §7 requires *before Phase 2*.

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

## DECISION-05 — `PROD_ACCESS: FORBIDDEN` conflicts with how this repo is worked · `OPEN`

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

## DECISION-07 — Where does the existing gap matrix go? · `OPEN`

`docs/OUTLIO_FUNCTIONAL_GAP_MATRIX.md` already exists from the earlier ADVANCE
brief, in prose. §8 requires `02_GAP_MATRIX.csv`, machine-checkable, one row per
capability with `file:line`.

**Recommendation:** generate the CSV fresh in Phase 0 and keep the prose file as
history. Phase 0 has not been started.

---

## Not blocking, but worth knowing

- **`docs/SYSTEM_HANDOFF.md`** (written 2026-09-04) already covers much of what
  Phase 0's narrative audit asks for, with production-verified claims. It is a
  head start on Phase 0, not a substitute for the CSV.
- **§6.2 email law** — I have not yet checked whether `List-Unsubscribe` and a
  postal address are emitted on send. That is a Phase 7/8 finding and I have not
  claimed either way.
- **Three of §5's decisions already match the repo**: 5.1 (Postgres-native
  queues with `FOR UPDATE SKIP LOCKED`), 5.4 (hybrid custom fields — the repo
  has both `crm_custom_field_definitions` and `crm_custom_field_values`), and
  5.8 (`Message-ID`/`In-Reply-To` threading, migration 0104). No conflict.
