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

## DECISION-12 — Why has only 4% of extracted leads reached the CRM? · `WITHDRAWN 2026-09-05`

⚠️ **The question was malformed and I withdrew it after measuring the dates.**

```
extracted_leads    2026-08-09 → 2026-08-18
crm_contacts       2026-08-30 → 2026-09-04
```

The CRM did not exist while those leads were extracted. Since it shipped, ONE
extraction job has run (25 leads kept) and the CRM holds 44 `lead_engine`
contacts — more than that job produced, because people pulled from the backlog.

So the ingest path has been used *more* than post-CRM extraction volume. The 4%
was a two-week extraction history divided by a CRM that shipped afterwards: an
accurate number about nothing. The three human explanations I offered were all
wrong because the real answer was a fourth — **chronology**.

**Nothing to decide.** See `PHASE_4.md`, which is withdrawn pending usage.

### The original question, kept as written

**Blocks:** what Phase 4 should actually build.

Measured on production 2026-09-05:

```
extraction jobs          87
extracted leads       1,193
crm_lead_batches          3      (49 records)
crm_contacts             98
```

`ingestExtractionJob` has two callers and both are **a person clicking**. There
is no automatic path — `process-job.ts` ingests companies on completion and does
nothing equivalent for contacts.

⚠️ **The three explanations lead to different builds:**

| If… | then the fix is |
|---|---|
| Nobody noticed the job finished | a notification, not automation |
| Leads were reviewed and rejected | **nothing** — 4% is correct, and automating it floods the CRM with records a human declined |
| The button is somewhere people do not look | placement |

I can measure that jobs completed and were not ingested. I cannot measure whether
that was a decision. **This is a question about humans and the owner's answer is
worth more than anything I would infer from the tables.**

---

## DECISION-13 — Default ingest mode · `OPEN`

**Recommendation: `manual`, unchanged.** Automation that arrives switched on
changes behaviour for existing workspaces without anyone choosing it — and per
DECISION-12 the current rate may be considered rather than accidental. Opt-in
makes the change visible.

---

## DECISION-14 — Does Phase 5 proceed, or defer like Phase 4? · `OPEN`

Raised 2026-09-06 while writing `PHASE_5.md`.

**The fact:** production holds 3 pipelines and **0 opportunities**, 0 stage
history rows, 0 custom field definitions and 0 values. Phase 5 adds contact
roles, custom fields, conditional fields, files and followers to a record type
nobody has created once.

**Why it is not obviously the Phase 4 situation:** Phase 4 proposed changing
behaviour on a misread ratio. Phase 5 adds capability, and usage cannot precede
capability. That objection fails on a verified fact — the capability exists.
`createOpportunity` is reachable from the board via `NewOpportunityButton`
today. Nobody has used it.

**Options, with the cost of being wrong:**

1. **Defer, trigger at 20 opportunities created after 2026-09-06** (mirrors
   Phase 4's standard). Wrong if a missing field is the reason nobody creates
   one — nothing suggests that, and nothing rules it out.
2. **Smallest slice: custom fields only.** Gives the two written validators
   (`lib/crm/custom-fields.ts:166,265`, currently zero callers) a caller. Wrong
   if adoption does not follow, leaving five empty tables instead of four.
3. **Reorder to Phase 6 first.** Wrong on the same numbers — forecasting zero
   opportunities is equally hollow.

**Recommendation: 1.** The blocker is not a missing feature; opportunities are
not part of anyone's workflow yet, and schema does not fix that.

⚠️ **Flagged for the owner rather than acted on.** Deferring two consecutive
phases on the same argument is how a plan quietly stops moving, and "there is
no data" can become a reason never to build anything. Whether the pipeline is a
priority at all is a product question — §11 says stop rather than guess it.

## DECISION-15 — Chase the flow engine's missing first run before Phase 10? · `RESOLVED 2026-09-08`

Raised 2026-09-07 while surveying Phase 10. **Resolved 2026-09-08: the engine
works; the zero was an accounting artifact.** Full evidence below — every step
was run against production, not inferred.

**The fact:** one published flow, trigger `contact_created`, live since
2026-09-03. Three contacts created in that workspace since, all `manual`. The
manual path does dispatch `contact_created`, the dispatch query returns the
flow, the definition validates, and `flow_runs` is **0** — verified with the
error checked.

`startRun` writes a row even when it HALTS. Zero rows means nothing reached the
insert, so this is not a flow being refused; it is a chain that stops somewhere
between the dispatch call and the first write.

**Why it is a decision and not just a bug:** Phase 10 adds company,
opportunity, activity, task and conversation facts to the flow engine. Adding
facts to an engine that has never executed is the same mistake as building
features for a population of zero — but chasing the defect needs a production
action (create a contact, then read `flow_runs` and the Vercel logs), which is
the owner's to take.

**Recommendation:** settle the defect first. It is one contact and one query.

⚠️ **No fix proposed.** Mid-investigation I concluded the manual path never
dispatched and started patching it — the dispatch was already there, one call
deeper. Nearly adding a duplicate trigger while hunting a missing one is why
this stops at evidence.

### Resolution (2026-09-08, verified against production)

**The premise "the engine has never executed" was false.** It executed twice —
once per qualifying contact — and the `OWNER_ASSIGNED` activities the runs
wrote are still in `crm_activities`:

| Contact | Created (UTC) | Flow action executed | run_id (from activity metadata) |
|---|---|---|---|
| "Flow Verify Three" `91dcac4f` | 2026-09-03 17:38:20 | OWNER_ASSIGNED 17:40:35, `by: flow` | `59f87a48-421f…` |
| "Vars Proof Contact" `7d8c864a` | 2026-09-03 23:49:08 | OWNER_ASSIGNED 23:51:47, `by: flow` | `9b965940-d6e2…` |

`by: flow` + `run_id` in metadata is written by **exactly one** code path —
`lib/flows/actions/crm.ts` ASSIGN_OWNER — so these are genuine engine
executions, not manual reassignments (the manual path writes
`{from, to}` metadata). Both fired ~2 min after creation, consistent with the
pg_cron worker tick advancing runs.

**Why `flow_runs` shows zero:** the two run rows and the two step rows were
removed after the fact. No code path in the repo deletes from `flow_runs`
(checked `lib/`, `app/`, `scripts/`, every migration); `crm_undo_batch`
soft-deletes contacts only. Both test contacts were also soft-deleted minutes
after the test, and both runs are absent — consistent with manual cleanup in
the Supabase SQL editor after the owner's verification sessions. The third
contact ("Reply Test Prospect") was created by `scripts/seed-reply-test.mjs`
via **raw insert** into `crm_contacts`, deliberately bypassing the manual
path, so it never dispatched anything — correct behaviour, not a defect.

**Live re-verification of every link, against production, 2026-09-08:**
`crm_ingest_contacts` RPC → created=true; the exact FK-hint dispatch query →
returns the published flow; `flow_check_loop_protection` → null;
`flow_runs` insert → row created. Probe rows removed afterward;
`flow_runs` back to zero, as expected.

**Live-code caveat:** the re-verification travelled the DB path a request
travels, but not through the deployed Next.js action. The strongest remaining
proof is one contact added via the production UI at outlio.io — an owner
action, 30 seconds, zero risk (the run can be soft-deleted with the contact).
Until then, treat the engine as **working with production evidence**, not
"never executed".

**Phase 10 is unblocked.** The fact expansion should proceed against an
engine that demonstrably runs.

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

---

## DECISION-16 — What do the four AI HTTP routes cost? · `STARTING ANSWER ADOPTED 2026-09-08`

**Resolved to its recommended option 2 — meter but do not charge — as the
starting point, not the final answer.** The three HTTP entries
(`hubble.ask`, `intelligence.plan`, `intelligence.summarize`) are priced at 0
in registry version 2, the four routes run inside `hubbleExecute`, and
`hubble_calls` now records every call. **The real price remains OPEN**: when
the ledger holds a month of real rows, the owner picks the number with
evidence under it, and raising it is a one-line registry change with a
test pinning the current 0. Delivery detail in `phases/PHASE_12.md`, item 4.

What this does NOT settle, unchanged: the provider bill to date (owner's
console), and the eventual non-zero price.

Raised 2026-09-07 while surveying Phase 12.

**The fact:** `hubble_spend_credits` is the only credit-spending call in the
codebase, and it is reached from exactly one module, `lib/hubble/execute.ts`,
which only the flows path imports. Import-closure analysis of
`/api/hubble/ask` (49 modules), `/api/intelligence/query` (76) and
`/api/intelligence/clarify` (74) finds no metering module in any of them, while
the same scan finds it on the flows path — so the scan works.

All three call a model. `research` costs **3 credits** through a flow and **0**
through the route, and the route does more work: search, crawl, embed, then the
model call. The only limit is the rate limiter, 20 per 10 minutes per user —
about 2,880 model calls per user per day, charged to the provider account and to
no plan.

**Why it is a decision and not a bug:** the fix is mechanical, but item 4 of
Phase 12 turns a feature customers use for free today into a charged one. That
is pricing, and pricing is not mine to change. Items 1–3 of the brief (registry,
one guarded entry point, structural guard) do not depend on the answer.

**Options, with the cost of being wrong:**

1. **Charge the routes at flow parity** (`ask` = 3, `clarify` = 1). Consistent,
   and the pool already exists. Wrong if Hubble's value is that asking is free —
   metering the exploratory path could suppress the usage this product is short
   of, and it is short of usage in four separate phases already.
2. **Meter but do not charge** — pass a credit context, record the spend, set
   the price to 0 for now. Nothing changes for customers today; the number
   needed to price it correctly starts accumulating; the structural guard still
   lands. Wrong only in that it defers revenue.
3. **Leave the routes unmetered, document the exemption.** Cheapest. Wrong if
   one user with a script discovers the ratio between a rate limit and a
   provider bill.

**My recommendation: option 2.** It is the only one that does not require
guessing. The disagreement between options 1 and 3 is entirely about a number
nobody has — what these routes actually cost per month — and option 2 produces
that number within a billing cycle while closing the structural hole
immediately. Charging can then be a decision with evidence behind it, which is
the standard every other phase in this project has been held to.

⚠️ **What it does not settle:** the provider bill to date. That is in the
provider's console, and reading it is an owner action.

### Update 2026-09-08 — the count was wrong, and the rest of the phase shipped

⚠️ **There are FOUR unmetered routes, not three.**
`/api/intelligence/runs/[id]/summary` reaches a model through
`lib/hubble/summarize.ts`; its 25-module closure reaches `hubbleExecute` zero
times. The first scan missed it because it grepped for the identifier and
counted a hit in `lib/hubble/reason.ts`, which only names it in a **comment**.
Three modules serve the four routes — `planner.ts` serves both `/query` and
`/clarify`.

Phase 12 items 1–3 are delivered and do not depend on this decision. The
registry now carries the three unpriced entries explicitly (`hubble.ask`,
`intelligence.plan`, `intelligence.summarize`), each naming DECISION-16, and
`hubbleExecute` **refuses** an unpriced capability rather than running it free.
`tests/unit/model-call-boundary.test.ts` prevents a fifth route appearing.

**This does not change the recommendation** — still option 2, *meter but do not
charge*. It strengthens it: the count of unmetered paths was itself uncertain
until a structural guard existed, which is the argument for measuring before
pricing rather than after.

**What answering it now costs:** item 4 only — moving the three modules inside
the boundary and setting a number. The exemption list in the boundary test is
the checklist; shrinking it to empty completes the phase.

---

## DECISION-17 — Does Outlio enter the LinkedIn channel at all? · `OPEN`

Raised 2026-09-08 on completing Phase 15. Blocks Phases 16–20.

**The fact:** Outlio holds no LinkedIn account, has never sent a LinkedIn
message, holds no credentials or cookies, and integrates no automation vendor.
Its entire LinkedIn surface is an extension with `storage` and `activeTab` that
parses pages the user opened themselves. **Today it is an observer. Phase 16
changes that.**

**Why it is a decision and not a plan:** of five access methods, exactly one is
compliant with LinkedIn's User Agreement — the official partner APIs — and
Outlio does not have that access. Every other route means the customer's account
carries a restriction risk that we cannot reverse and did not bear. §6.3 requires
that risk be named rather than managed away; `RISK_REGISTER.md` names it.

**Options, with the cost of being wrong:**

1. **Do not enter the channel.** Wrong if LinkedIn is the reason customers would
   buy — but nothing measured says that yet, and the email channel that already
   exists has sent 2 messages.
2. **Apply for official partner access first**, and decide afterwards. Slowest;
   the only route where the customer bears no ToS risk. Wrong only in that
   approval may never come, and the wait is unbounded.
3. **Proceed on a non-compliant access method with the §6.3 controls.** Fastest
   to a demo. Wrong in the one way that cannot be undone: the first restricted
   account is a customer's, not ours, and no refund restores it.

**My recommendation: option 1, revisited when the email channel is actually in
use.** Not on squeamishness — on the same evidence six other phases were
deferred for. This is the most expensive phase in the plan, the only one whose
failure mode is irreversible for someone who is not us, and the population it
would serve is a product with 2 sent emails and 0 flow runs.

If the owner chooses 3, the order is not negotiable: 16 connection → **17
dry-run and safety engine, complete and `VERIFIED` by breaking each control** →
18 campaigns. Live mode must not exist before 17 passes.

⚠️ **What it does not settle:** the legal reading. This register states the
widely-documented position, not advice. If the answer is 2 or 3, it is the brief
to hand a lawyer.

---

## DECISION-18 — What is the payload contract for the three `meeting.*` webhook events? · `OPEN`

Raised 2026-09-09 while sourcing the last webhook events (Phase 23, second
half).

**The fact:** `meeting.booked`, `meeting.cancelled` and `meeting.rescheduled`
are offered in Settings → Developers and have never fired, because no product
moment publishes them. The natural source exists — `lib/meetings/ingest.ts`
processes Calendly events at exactly those moments. What does not exist is a
payload contract: §5.13 specifies the transport (signature, replay window,
retries, circuit breaker) and nothing about bodies. The only shape in the
codebase is `NormalizedMeetingEvent`, a Calendly-normalised internal type.

**Why it is a decision and not a gap to fill:** publishing that type verbatim
freezes an internal representation as a public API nobody agreed to — and a
webhook body IS the API; once a subscriber parses it, changing it is a breaking
release. Inventing a body to close a checkbox is the webhook equivalent of
rule 4's fabricated contact detail: it looks right, and when it is wrong
nobody can tell.

**Options, with the cost of being wrong:**

1. **Publish `NormalizedMeetingEvent` as-is.** Fastest. Wrong if the shape is
   missing what subscribers need (invitee timezone? which calendar?) or carries
   what they must not see (cancellation reason is personal correspondence) —
   and every gap becomes a v2 later.
2. **Specify a minimal contract deliberately** — e.g.
   `{ meetingId, inviteeEmail, contactId?, scheduledAt, endsAt?, type }` —
   documented in `docs/EXTENSION.md` or the developer settings page, then
   wired through `emit.ts`'s mapping. Wrong only in the time it takes to
   decide; the three events stay dark until then.
3. **Withdraw the three events from the catalogue.** Honest: don't offer what
   doesn't exist. Wrong if meeting webhooks are a near-term promise — the
   catalogue is also the product's face.

**My recommendation: option 2, whenever meeting notifications matter to a
customer.** It is the same standard the wired nine now meet: a source, a key
that names the occurrence, and a payload that is a contract. There is no
evidence anyone needs these events today (the production census shows zero
webhook subscribers), so deciding the shape under no pressure beats guessing
under one.

⚠️ **What it does not settle:** whether the flow trigger `call_booked` should
fan out to webhooks at all — it is currently exempted in
`domain-event-boundary.test.ts` on the same no-contract grounds, and its
`ingestMeetingEvent` call site is behind an option (`triggerFlowId`) no caller
passes. That is a separate, already-recorded defect.

---

## DECISION-19 — Does Outlio need multi-currency deals? · `OPEN`

Raised 2026-09-12 while auditing §5.6.

**The fact:** every opportunity in the product is USD. `crm_opportunities.currency`
defaults to `'USD'`, `createOpportunity` accepts an optional `currency`, and **no
caller passes one** — not the server action, not the flow action — and there is no
update path for it. So the column is a promise of multi-currency that nothing
fulfils.

⚠️ **And it is primed to break silently.** §5.6 requires
`fx_rate_to_workspace_currency` and `fx_rate_date` snapshotted at create and at
close, with rollups using the snapshot. Neither column exists. Migration 0082
rolls up won deals as `coalesce(sum(o.value_amount), 0)` with **no grouping by
currency**, so the day a currency picker is wired, a €10,000 deal and a $10,000
deal sum to 20,000 — a number that is not money in any currency — and nothing
errors. Reporting is simply wrong.

`tests/unit/money-single-currency.test.ts` now fails the moment any caller
supplies a currency, and says what to implement first. So the bug cannot ship by
accident; the question is whether you want the feature.

**Why it is a decision and not a task:** implementing §5.6 needs a **rate
source**. That is a vendor and a cost (a daily fx feed), plus a policy call on
which rate applies — the contract says snapshot at create *and* at close, which
means a deal's reported value changes when it closes and never again.

**Options:**

1. **Stay single-currency.** Free. Correct today. Wrong if you sell outside the
   US and a prospect wants to see their own currency — which is a sales
   objection, not a bug.
2. **Implement §5.6 with a daily fx feed.** Correct and auditable. Costs a
   vendor, a migration with a backfill on a money column, and a rollup rewrite.
3. **Multi-currency display only** — store USD, render a converted figure marked
   as indicative. Cheapest middle. Wrong if anyone treats the displayed number
   as the contract value.

**My recommendation: option 1 until a real prospect asks.** Nothing measured says
they will, the guard makes the silent version impossible, and options 2 and 3
both need a rate source you do not have. Revisit when a non-USD deal is actually
requested.

⚠️ **Recorded deviation, not a gap:** §5.6 asks for `amount_minor BIGINT`; the
column is `numeric(14, 2)`. Both avoid binary floating point, which is what the
spec protects against, and §2's authority order puts running code above the
contract. Pinned by the same test so it cannot drift to a float.
