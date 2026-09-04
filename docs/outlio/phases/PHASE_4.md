# Phase 4 — Lead Engine → CRM control

Per §10. Status: **BRIEF — contains open questions, so it needs approval before
implementation.**

---

## GOAL

§9: *"Lead Engine → CRM control (identity resolution + merge first, then
Manual/Ask/Auto)"*.

⚠️ **The headline measurement, taken from production on 2026-09-05:**

```
extraction jobs          87
extracted leads       1,193
crm_lead_batches          3
batch members            49
crm_contacts             98
```

**87 extraction jobs produced 1,193 leads. Three batches ever reached the CRM,
carrying 49 records.** The product's whole premise is that saved LinkedIn pages
become a working lead database, and roughly **4% of what it extracted has
crossed into the CRM.**

That is the phase. Not "build a pipeline" — the pipeline exists and works. The
question is why almost nothing goes through it.

## OUT OF SCOPE

- New extraction or parsing. Phase 4 moves what has already been extracted.
- LinkedIn automation of any kind (CLAUDE.md rule 1).
- Company ingest (`ingestAccounts`) beyond what contact flow requires.
- Opportunity and pipeline surfaces (Phases 5–6).

---

## CURRENT STATE

`VERIFIED` against production and code on 2026-09-05.

### Identity resolution and merge are built, and lightly used

| Capability | Where | Production |
|---|---|---|
| Trigram similarity | `lib/crm/dedupe.ts:52` | — |
| Duplicate scan | `lib/crm/duplicates.ts:200` | 6 candidates |
| Merge with conflict detection | `duplicates.ts:410` | 6 merge events |
| Ignore a candidate | `duplicates.ts:369` | — |
| Collision policy | `crm_collision_settings` | 3 workspaces |

§9 says "identity resolution + merge **first**". It is largely done — which
means Phase 4's real work is the second half, and saying so now avoids
rebuilding something that already functions.

### ⚠️ There is no automatic path from a finished extraction to the CRM

`ingestExtractionJob` has exactly two callers: the import page, and
`SendToCrmButton` on the extraction dashboard. Both are **a person clicking**.
`lib/worker/process-job.ts` ingests *companies* on completion (`ingestAccounts`,
line 304) and does nothing equivalent for contacts.

So every one of those 1,193 leads needed somebody to notice a finished job and
press a button. 49 got pressed.

⚠️ **`SendToCrmButton`'s own header records that `ingestExtractionJob` "was built
and tested in M2 and had no caller"** — the same defect class Phase 0 catalogued,
already found and fixed here. The button exists now; the habit of pressing it
does not.

### `crm_collision_mode` is the shape Manual/Ask/Auto wants, for a different question

The enum is `off | warn | require_approval`, and it governs **two reps touching
the same contact** — not how leads enter. It is a good precedent for a
per-workspace policy stored in a settings table, and it is not the setting this
phase needs.

## WHAT ALREADY WORKS (`VERIFIED`)

- `ingestExtractionJob`, `runCsvImport`, `undoBatch`, `createContactManually`
- Batch attribution — `crm_lead_batches` / `crm_batch_members`, so an import can
  be undone as a unit
- Duplicate scan, merge, conflict detection, ignore
- Contact provenance (Phase 3), so an auto-ingested contact arrives citable

## WHAT IS MISSING

1. **A policy.** No per-workspace setting says what should happen when an
   extraction finishes.
2. **The automatic path.** Nothing calls `ingestExtractionJob` without a click.
3. **The "Ask" path.** No notification, no queue, no "12 new leads are ready".
4. **A reason for the 4%.** ⚠️ I do not know whether leads are not ingested
   because nobody noticed, because they were reviewed and rejected, or because
   the button is somewhere people do not look. **That is a question about
   humans, and the answer changes what to build.**

## ARCHITECTURE TO REUSE

- `lib/crm/ingest.ts` — `ingestExtractionJob` is the engine; do not fork it
- `lib/crm/duplicates.ts` — resolution already handles the collision case
- `crm_collision_settings` — the model for a per-workspace policy row
- `lib/workers/tick.ts` — where an automatic path would run, alongside the six
  existing jobs
- `lib/crm/evidence-bridge.ts` — already runs on the tick and already scopes
  contacts-first

## DO-NOT-TOUCH

- The bridge's contacts-first ordering, and Phase 3's citation write path.
- `undoBatch` semantics — batch attribution is what makes an automatic import
  reversible, and automation without undo is worse than no automation.
- CLAUDE.md rule 1. Nothing here fetches from LinkedIn.
- The flow runtime; the landing page.

## MODELS / MIGRATIONS / APIs / EVENTS / PERMISSIONS / WORKERS / PROVIDERS

- **Migrations:** one — a `crm_ingest_settings` row per workspace (`mode`,
  `updated_by`), modelled on `crm_collision_settings`.
- **Workers:** one new tick job for the automatic path. ⚠️ It must claim like
  the others and be idempotent; `undoBatch` exists precisely because an import
  can be wrong.
- **Events:** `batch_added` is a declared flow trigger that **has never fired**
  (Phase 0, finding #3). An automatic ingest is its natural producer, and wiring
  it would shrink `trigger-producer`'s allowlist by one.
- **Permissions:** changing the policy needs a workspace-level permission;
  `crm.contact.create` is the closest existing one.

## TESTS TO WRITE

| Kind | Test |
|---|---|
| Unit | each mode selects the right behaviour; an unknown mode falls back to the safest |
| Reachability | the automatic path has a producer — and `batch_added` leaves the allowlist |
| Idempotency | a job ingested twice creates one batch, not two |
| RBAC | a role that cannot create contacts cannot change the policy |
| Tenant | one workspace's policy never affects another's ingest |
| E2E | set the policy, finish a job, see contacts arrive, undo the batch |

⚠️ Every guard verified non-vacuous by breaking what it watches.

## E2E ACCEPTANCE JOURNEY

1. Sign in; set ingest policy to **Auto**.
2. Complete an extraction job.
3. Contacts appear in the CRM without anyone pressing anything.
4. They carry their citation (Phase 3) and their batch.
5. Undo the batch; they leave cleanly.
6. Set the policy to **Manual**; complete another job; nothing is ingested.
7. A second workspace's policy is unaffected throughout.

## SECURITY + COMPLIANCE NOTES

- ⚠️ **Automatic ingest moves personal data further into the product without a
  human in the loop.** GDPR Art. 14 (accepted exposure, CLAUDE.md 2026-09-03)
  requires notifying a person whose data was collected without their knowledge
  within a month. Automation increases the volume that clock applies to.
- An unbounded automatic import is a plan-limit and cost question as well as a
  correctness one. `plans.limits.records_per_month` already exists and must be
  honoured by the automatic path, not only the manual one.

## COST IMPACT

**NONE** in new dependencies. ⚠️ It may materially increase `records_per_month`
consumption, which is a *customer-facing* cost — see the second security note.

## OPEN QUESTIONS

**1. ⚠️ Why is it 4%? This is the question I most want answered and cannot answer
from the data.**

1,193 leads, 49 ingested. The possibilities lead to different builds:

- **Nobody noticed** → the fix is a notification, not automation.
- **They were reviewed and rejected** → 4% is *correct* and automating it would
  flood the CRM with records a human deliberately declined.
- **The button is somewhere people do not look** → the fix is placement.

I can measure that jobs completed and were not ingested. I cannot measure
whether that was a decision. **If you know which it is, that answer is worth more
than anything I would infer.**

**2. What should the default mode be?**

**Recommendation: `manual`, unchanged.** Automation that arrives switched on
changes the product's behaviour for existing workspaces without anyone choosing
it — and given question 1, the 4% may be a considered rate rather than a failure.
Opt-in makes the change visible.

**3. Should `Auto` respect the duplicate scan, or ingest and let the scan catch
up?**

**Recommendation: ingest, then scan** — which is what the manual path already
does. Blocking an automatic import on resolution would stall it on the first
ambiguous record with nobody watching, and `crm_duplicate_candidates` plus the
merge UI already exist to handle the aftermath.
