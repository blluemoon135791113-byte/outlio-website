# Phase 3 — Evidence

Date: 2026-09-05 · Branch: `platform-m1-workspaces` · Brief: `PHASE_3.md`

---

## What ran

| Command | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | 0 errors, 98 warnings |
| `npm test` (unit) | **155 files, 2,857 tests** |
| `npm run test:e2e` | **10 passed, 47s** |
| `npm run build` | clean |
| `vitest --project integration evidence-citation` | 3 passed, against staging |

## The gap was not "unsurfaced" — it was unsurfaceable

`research_evidence` carries `source_provider`, `source_url`,
`source_confidence`, `confidence`, `retrieved_at`, `research_run_id`.
`crm_contact_emails` carried `source`, an enum. Once the bridge copied an
address into the CRM, the page it came from was gone.

CLAUDE.md rule 4 permits storing a value only if literally observed *"and the
evidence row naming the provider and URL is kept as its citation"*. The row was
kept — in another table, reachable only by matching value + field + entity across
the `user_id`/`workspace_id` seam.

⚠️ **Rule 4's purpose is not only that we avoid fabricating. It is that a stored
value can be CHECKED.** A citation nobody can reach does not achieve that.

## Delivered

**`0113`** — `evidence_id` on `crm_contact_emails` / `_phones`. Nullable
(backfilling a guess is the fabrication rule 4 forbids) and `ON DELETE SET NULL`
(evidence expires and is pruned; the address stays true). Safe only because
neither table is append-only — verified, their sole trigger is `set_updated_at`.

**Contacts** — the bridge writes the citation; the page resolves and renders it.

**Companies — and they needed no migration.** `crm_companies.source_company_id →
companies.id = research_evidence.entity_id` is an *exact structural link*, so
DECISION-10's objection to re-deriving (matching on **value**) does not apply.
952 of 1,000 sampled production evidence rows are company-level, covering exactly
the fields that page displays.

⚠️ **But a column can be edited after import**, so `companyCitations` compares
the observed value against the stored one and reports `unknown` on a mismatch.
Crediting a provider for a person's edit is a fabrication about provenance, and
rule 4 does not distinguish that from fabricating the value.

**`safeSourceUrl`** — `source_url` is attacker-influenced data in an `href`,
written once by a crawl and rendered to every user thereafter. `javascript:`,
`data:` and `file:` are **rejected, never sanitised**: a repaired URL points
somewhere nobody chose and the reader cannot tell.

**DECISION-11** — `entered` and `unknown` stay apart. `lead_engine` with no
citation is `unknown`, not "entered": calling it entered would claim a person
typed something a crawler found.

## DoD status

| # | Item | Status |
|---|---|---|
| 1 | E2E journey from production entry point | VERIFIED — `e2e/provenance.spec.ts` |
| 2 | Reachability chain named and unbroken | VERIFIED — round trip proven in integration |
| 3 | RBAC matrix passes | VERIFIED — unchanged; provenance follows the value |
| 4 | Tenant isolation | VERIFIED — plus a `user_id` filter on the seam |
| 5 | Persistence survives reload | VERIFIED |
| 6 | Typecheck, lint, unit, E2E green | VERIFIED |
| 7 | No new dead exports | VERIFIED |
| 8 | Feature flag | N/A — additive display |
| 9 | Migration applied + rollback stated | ⚠️ **staging only** — 0113 not on production |
| 10 | Docs updated | VERIFIED |
| 11 | This file | VERIFIED |

⚠️ **Item 9 blocks `COMPLETE`.** Production holds 64 emails, 22 phones and 2,294
evidence rows that cannot be connected until `0113` is applied there.

## What I could not verify, and why

**Contact citations in production.** `0113` is on staging. The round trip is
proven there; production has the data and not the column.

**Existing production rows will show `unknown`, not a citation.** They were
bridged before `0113` and their `evidence_id` is `NULL`. That is the honest
outcome — a backfill would have to guess which of 2,294 evidence rows produced
each of 64 addresses, and a plausible citation is worse than an absent one
because nobody can tell it is wrong. ⚠️ **Re-running the bridge will not fix
them**: `attachContactEmails` skips addresses that already exist, so the
citations attach only to values bridged from now on. Backfilling is a separate,
reviewable decision.

**Company provenance beyond three fields.** `industry`, `employee_count` and
`headquarters` are cited. `funding_*`, `tech_stack`, `recent_news` and the rest —
the majority of the 952 rows — have no home on the company page yet.

**`company_links` and `company_signals`** remain on the unused-schema allowlist.
Companies have a provenance story that was never built; this phase surfaced the
part that maps onto fields the page already shows.

## Mistakes worth recording

**Three fixture bugs, all found by running rather than reading:**
`extracted_leads` needs `extraction_job_id`; `dedupe_strategy` and `dedupe_mode`
are two enums with confusingly overlapping values; `value_json` is keyed per
field (`email`, `phone`, `count`, `headquarters`) and a generic `value` key is
**silently ignored** — the bridge reports "nothing usable" rather than erroring.

⚠️ **The first fixture discarded insert errors**, so a failed insert surfaced
three statements later as "cannot read properties of null", pointing at the wrong
line. Now every insert reads its error.
