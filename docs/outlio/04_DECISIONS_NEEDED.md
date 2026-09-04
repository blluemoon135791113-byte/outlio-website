# Decisions needed

Per §11 of the build contract. Each item blocks something specific. I have
continued all unblocked work; what I continued is noted per item.

Status: `OPEN` until the owner answers here.

---

## DECISION-01 — There is no E2E harness · `ANSWERED 2026-09-04`

**Answered by building it.** Playwright landed in Phase 0.5 (`e2e/auth.spec.ts`)
and grew a tenant-isolation journey in Phase 1 (`e2e/tenant-isolation.spec.ts`),
proven non-vacuous by removing `.eq('workspace_id', …)` from `getContactDetail`.
`npm run test:e2e`, 7 tests. The original text is kept below as the reasoning
that led there.

---


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

## DECISION-02 — Migrations are applied by hand · `CLOSED 2026-09-04`

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

## DECISION-03 — No seed fixtures · `ANSWERED 2026-09-04`

**Answered by building it.** `outlio-staging` (`ahfyvhibzgxrhfjobbqn`) exists, on
the free plan at no cost, with all 111 migrations applied. The integration suite
targets it by default. See **ADR-005**.

⚠️ ADR-004's concession — filing Phase 1's tenant journey `INFERRED` — is
**withdrawn**. It can now be built and `VERIFIED`.

**Superseded detail.** The text that stood here described the problem — no seed
script, no non-production database, and the escalation when it began blocking
DoD item 4. All of it is resolved by ADR-005 and preserved in that ADR.

⚠️ **What is NOT resolved: §7's fixture size.** A staging project existing is not
the same as §7's 1M activities fitting on it. That is **DECISION-08**, raised
with measurements in Phase 2's brief.

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

## DECISION-06 — §5.2 requires `permissions.yaml`; the repo uses TypeScript · `ANSWERED 2026-09-04`

**Answer: keep TypeScript.** Recorded as ADR-003, which amends §5.2.

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

## DECISION-08 — §7's fixture does not fit on the free tier · `OPEN`

**Blocks:** Phase 2's performance measurement, and §7 in full.

§7 requires 100k contacts, 30k companies, 20k opportunities and **1M activities**
seeded before Phase 2.

⚠️ **Measured on staging, not estimated from documentation:** `crm_contacts`
averages **146 bytes/row**, `crm_activities` **213 bytes/row**. Heap alone is
~15 MB + ~213 MB; `crm_contacts` carries nine indexes including a trigram index.
Realistic total **400–550 MB** against Supabase's **500 MB free-tier cap**,
beyond which the project goes read-only. Staging is currently 23 MB.

| Option | Cost | Consequence |
|---|---|---|
| **A. Seed only what Phase 2 measures** — contacts, companies, opportunities | none | Every §7 target Phase 2 is judged on becomes measurable. 1M activities is a **Phase 14** figure. |
| B. Seed all of §7 | none until it breaks | Likely exceeds the cap mid-run, leaving staging read-only. |
| C. Upgrade staging to Pro | **~$25/month** | All of §7 measurable now. |

**Recommendation: A.** It costs nothing, measures everything Phase 2 needs, and
defers the one number Phase 2 does not use to the phase that does.

---

## DECISION-09 — Saved views: shared or private? · `OPEN`

**Blocks:** the saved-views half of Phase 2.

A view a manager saves for the team and a view an individual saves for themselves
are different features — different permissions, different tenancy, different UI.

**Recommendation: private first.** The private case is a strict subset, so
shipping it does not foreclose sharing later, and `crm_saved_views` has no code
at all today so there is nothing to migrate either way.

---

## DECISION-10 — Does a bridged value carry a citation, or get re-derived? · `OPEN`

**Blocks:** Phase 3's provenance surfacing.

⚠️ **The citation does not survive the bridge today.** `research_evidence` carries
`source_provider`, `source_url`, `source_confidence`, `confidence`,
`retrieved_at` and `research_run_id`. `crm_contact_emails` carries `source` — an
enum, not a citation. A search of every column in the database for `%evidence%`,
`%citation%` or `%source_url%` returns nothing on any `crm_*` table.

So once `syncContactEvidenceToCrm` copies an address into the CRM, the link to
the page it came from is gone.

This is in tension with **CLAUDE.md rule 4**: a value may be stored only if
literally observed *"and the evidence row naming the provider and URL is kept as
its citation"*. The row is kept, in another table, reachable only by inference.

| Option | Cost | Consequence |
|---|---|---|
| **A. Add `evidence_id`** to `crm_contact_emails` / `_phones` | one migration | The citation becomes a foreign key. Exact, cheap, and rule 4's intent is met structurally. Existing rows get NULL — honestly "unknown" rather than a guess. |
| B. Re-derive by matching value + field + entity | none | Crosses the user_id/workspace_id tenancy seam, returns the wrong row when a value was observed twice, and degrades as evidence grows. |

**Recommendation: A.** B looks cheaper and is wrong occasionally — the worst
combination, and the exact shape this project has spent three phases finding.

⚠️ Neither table is append-only (checked), so `ON DELETE SET NULL` is safe here,
unlike the four tables migration 0109 had to repair.

---

## DECISION-11 — What does a value with no provenance say? · `OPEN`

**Blocks:** the missing-data state Phase 3 owes CLAUDE.md rule 4, which requires
`NULL` **plus an indicator** — the pages currently render an empty cell, which
reads as "not applicable" rather than "we never found this".

Most CRM data has no evidence: typed by hand, CSV-imported, or bridged before a
citation column existed.

**Recommendation: distinguish "entered" from "unknown".** `crm_contacts.source`
already records `manual`, `csv_import`, `lead_engine`, `api`, `flow`, so the data
can already tell them apart. Labelling a hand-typed value "source unknown" would
be a small lie repeated on every row.

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
