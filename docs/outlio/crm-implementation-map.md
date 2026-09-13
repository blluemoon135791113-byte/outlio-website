# CRM implementation map — Pipedrive-informed spec vs. this repository

Phase 0 output required by `Outlio_CRM_Pipedrive_Master_Implementation.md` §0.

**Source spec:** `Outlio_CRM_Pipedrive_Master_Implementation.md` (731 lines, Part II §§0–20)
**Mapped:** 2026-09-13
**Method:** six parallel read-only agents, one per spec section group, each required to
cite `path:line` or record GAP. No status below was inferred from a document; every
EXISTING claim has a code citation.

---

## The headline

**This spec is a gap list, not a build list.** The repository already contains a
working workspace-scoped CRM: 119 migrations (`0001`→`0119`), 23 modules under
`lib/crm/`, 231 test files (186 unit / 45 integration), and a prior phased build
recorded in `docs/outlio/05_PHASE_STATUS.md` that reached Phase 9.

Roughly **60% of the specification is already implemented**, often to a higher
standard than the spec asks for. The remaining work divides into three very
different piles, and conflating them is the main risk to this project:

| Pile | Size | Character |
|---|---|---|
| **A. Real defects in shipped code** | ~10 items | Wrong answers today. Fix first. |
| **B. Absent subsystems** | ~6 areas | Large, additive, low risk to existing behaviour. |
| **C. Spec/repo conflicts** | 4 items | The repo made a *different* decision. Needs an owner ruling, not code. |

Pile C must be resolved by the owner before any code is written against it —
implementing the spec literally would regress deliberate, documented decisions.

---

## Pile A — defects in shipped code

Ranked by blast radius. Each is a wrong answer produced by code that currently runs.

| # | Defect | Evidence | Why it matters |
|---|---|---|---|
| A1 | **Multi-currency values are summed without grouping.** `round(coalesce(sum(o.value_amount * o.probability / 100.0), 0), 2)` with no `group by currency`. | `supabase/migrations/0084_crm_forecast.sql:51`; also `0082` | A €10,000 and a $10,000 deal sum to 20,000. The repo documents this itself in `tests/unit/money-single-currency.test.ts:22-24`. Latent only because `lib/crm/opportunities.ts:236` forces `'USD'`. Ships as a live bug the moment a currency picker appears. |
| A2 | **Deal staleness resets on any edit.** `row.updated_at < staleBefore`. | `lib/crm/opportunities.ts:470`; badge at `components/crm/PipelineBoard.tsx:216-218` | Renaming a deal clears its Stale badge. §8 explicitly forbids this. `stage_age` and `engagement_age` are not distinguished; one badge exists where the spec requires three. |
| A3 | **Ownership change is not atomic with its audit event.** `recordActivity` then `update`, two statements, no transaction. | `lib/crm/activities.ts:183-198` | The activity is written *first*, so a failed update leaves a false `OWNER_ASSIGNED` row in an append-only table. |
| A4 | **Membership is hard-DELETEd and sessions are never revoked.** No `status` column; `DELETE` at `lib/workspaces/actions.ts:326-332`; no `signOut`/token revocation anywhere. | `supabase/migrations/0070_workspaces.sql:72-82` | A removed member keeps a live session. Workers never re-read membership (no `workspace_memberships` read in any worker path), so their queued jobs continue to act. |
| A5 | **Published flows freeze the publisher's authority.** `stampSendAuthority` / `stampBillingUser` bake `actorAuthorized` and `userId` into the immutable version. | `lib/flows/definition.ts:397,421` | A departed member's send permission and credit account survive in every published flow until someone re-publishes. Directly contradicts §12. |
| A6 | **Duplicate detection discloses records the viewer cannot see.** No visibility filter in `lib/crm/duplicates.ts`/`dedupe.ts`; the create path returns the matched id regardless of owner. | `lib/crm/contact-actions.ts:213` | Fails acceptance test T04. "Already in your CRM — opening them instead" leaks the existence and identity of another owner's record. |
| A7 | **Identity conflicts resolve silently instead of holding.** LinkedIn match is tried first and wins; if the email resolves to a *different* contact the row is attached to the LinkedIn match and the email insert is `on conflict do nothing`. | `supabase/migrations/0072_crm_ingestion.sql:305-321,381` | §4's "profile→A, email→B ⇒ hold for resolution" case merges two different people without review. Fails T07. |
| A8 | **Webhook publication is non-transactional and non-idempotent.** Fan-out is an in-process `await` after the business write; `enqueue_webhook_delivery` takes no idempotency key. | `lib/events/emit.ts:97-132` (documented in-code at ~`:110`) | A retried operation double-publishes. No outbox, no consumer dedup ledger. `grep outbox` → zero hits. Fails T17. |
| A9 | **Deal probability cannot express "unknown".** `probability integer not null default 0`, overwritten from `default_probability` on every stage move. | `supabase/migrations/0076_crm_opportunities.sql:143,369-372` | Unknown is indistinguishable from 0%. §8's `effective_probability` precedence chain (deal → stage → unknown) is unimplementable, and forecasts cannot report unknown-probability coverage. |
| A10 | **Custom-field options are matched by label text, not ID.** `matchOption` compares trimmed lowercase strings; `options jsonb` is an array of strings. | `lib/crm/custom-fields.ts:154`; `0071_crm_core_identity.sql:498` | Renaming an option breaks saved values and filters — the exact failure §9 forbids. |

**Cross-cutting:** `row_version` exists only on `crm_opportunities`
(`0076:155`). Contacts, companies and tasks have none, so no `expected_version`
check is possible and acceptance test **T09 (stale write rejected) cannot pass**
for contacts. `crm_move_opportunity_stage` (`0076:284-423`) is the repo's one
genuinely transactional command and is the correct reference implementation.

---

## Pile B — absent subsystems

Large but additive. These do not contradict anything; they simply do not exist.

| Area | Status | Notes |
|---|---|---|
| **§13 deal files / proposals / line items** | Essentially unimplemented | No deal-file table, no document versioning, no status model, no line items. The primitives to reuse *do* exist — `lib/upload/sniff.ts`, `lib/upload/limits.ts`, signed URLs at `lib/profile/avatar.ts:7`, `0012_storage_policies.sql` — nothing connects them to `crm_opportunities`. |
| **Social profiles as first-class records** | GAP | Only `crm_contacts.linkedin_url` + a single-column unique index (`0071:225`) that actively prevents a second profile. Blocks every §5 social column, social search, and add/edit/remove requirement. |
| **Contact lifecycle + archive state** | GAP | No `lifecycle` column anywhere; only `deleted_at`. "Archived" and "Needs Review" saved views have no state to read. |
| **My Work surface** | GAP | `app/(product)/crm/tasks/page.tsx:16` offers seven mutually-exclusive filter views, not a ranked reason-annotated queue. No snooze, no task reassign action. Blocked structurally by the missing FK below. |
| **`crm_tasks.opportunity_id`** | GAP | `crm_tasks` carries only `contact_id`/`company_id` (`0075:212`). This single missing FK blocks next-action indicators, next-action coverage, and "deals without a next action". |
| **Hubble → workflow generation** | GAP | Nothing in `lib/hubble` or `app/api/hubble` imports `FlowDefinition`/`validateFlowDefinition`. No visual builder — `components/flows/FlowEditor.tsx:10-19` is an honest JSON textarea. No contextual Ask Hubble on contacts/companies/deals. |
| **Stage requirements (required fields to enter a stage)** | GAP | Zero hits for `stage_requirement`/`required_field`. So `crm_move_opportunity_stage` validates version, workspace, pipeline membership and lost-reason — but never required fields. |
| **Admin review queue** | GAP | Required by §16 (ambiguous tenant/owner), T04 (hidden duplicates) and T10 (reassignment review). `app/admin/` contains only `extension/`. |
| **Intake routing model** | GAP | No routing-rule table, no rule version, no eligible-pool record, no once-per-intake guard. `ROUND_ROBIN` (`lib/flows/actions/crm.ts:93-142`) is a non-transactional least-loaded picker — it counts at `:102-116` then updates at `:118-122`, so two concurrent runs pick the same person. |
| **Company merge** | GAP | `crm_merge_contacts` exists (`0074:158`); there is no company equivalent, although `crm_duplicate_candidates.entity` and `scoreCompanyPair` (`lib/crm/dedupe.ts:341`) already support companies. |

### Orphaned code — built, tested, and reachable by nothing

This repo has a documented recurring defect class ("correct, tested and
unreachable"). Three live instances:

1. **Custom fields.** Schema (`0071:484,520`) + validator (`lib/crm/custom-fields.ts`)
   exist with **no write path**. `grep crm_custom_field_values` in `.ts/.tsx` hits
   only the file's own comment, `types/database.ts:2308`, and tests. The repo's own
   `tests/unit/orphan-module.test.ts:8-9` documents both tables as empty in production.
2. **Six dead trigger types.** `scheduled`, `no_activity`, `list_added`,
   `batch_added`, `campaign_enrolled`, `webhook` are publishable in
   `lib/flows/definition.ts:32-50` with **no producer that ever starts a run**.
   Date triggers and F12 renewal reviews are therefore impossible today.
3. **Two competing metric registries.** `lib/reporting/registry.ts:57` (13 rollup
   metrics) and `lib/reports/metrics.ts:80` (9 dashboard metrics) share no type and
   no source; CSV export (`lib/crm/report-export.ts`) bypasses both and hard-codes
   columns.

---

## Pile C — spec/repo conflicts requiring an owner decision

**Do not write code against these until they are ruled on.** In each case the
repo made a deliberate, documented choice that the spec contradicts.

| # | Conflict | Repo position | Spec position |
|---|---|---|---|
| C1 | **Default record visibility** | `lib/workspaces/permissions.ts:282-285` hard-codes setter *and* viewer to `dataScope: 'assigned'` — owner-only visibility. Not configurable. | §2 default is a **shared** directory with owner-only *editing*, and owner-only visibility as an opt-in mode. |
| C2 | **Workspace-wide unique email on people** | `crm_contact_emails_identity_uniq` (`0071:290`) enforces it, and it is load-bearing for ingest race-handling (`0072:355`). | §4 and T06 explicitly forbid a universal unique email constraint on people (shared switchboard / role addresses). |
| C3 | **Workspace-wide unique company domain** | `crm_companies_domain_uniq` (`0071:137`). | §4 forbids treating a domain as globally unique — subsidiaries and distinct legal entities share domains. |
| C4 | **Safeguard numbers** | 200 nodes (`definition.ts:228`), 90-day max wait (`:193`), no run-lifetime cap, no side-effect-per-path ceiling. | §10 specifies 25 nodes, 10 side-effect nodes per path, 30-day max wait, 90-day run lifetime. |

C1 is the largest: every list, detail, export and report in the product was built
against the `assigned` assumption. C2 and C3 are not one-line edits — each index
is relied upon by existing ingest logic.

---

## Where the repo *exceeds* the spec

Worth recording so this work does not "fix" it:

- **Composite FKs `(id, workspace_id)`** for cross-tenant rejection — `0071:209,220-223` — exactly the pattern §2 asks for.
- **Append-only enforcement** with an erasure escape hatch — `0075:92`, `crm_erase_contact` at `:426`.
- **Flow at-most-once semantics** — `flow_step_runs_once_idx` + `flow_claim_step` with `on conflict do nothing` (`0093:281,290`), lease-as-update at `lib/flows/engine.ts:575-586`.
- **Deterministic reply-stop before any AI call** — `lib/email/reply-sync.ts:13-17`.
- **Evidence/citation loop for contact details** — `lib/crm/evidence-bridge.ts:20-23,40,76` + `0113_contact_value_citations.sql` + `lib/crm/provenance.ts`. Covers `work_email` and `mobile_phone` only; any new stored lead field needs the same treatment.
- **Production-ref refusal in two places** — `scripts/seed-volume.mjs:24` and `.github/workflows/integration.yml`.
- **`rehearse-migration.mjs`** — applies against the real DB in a transaction and always rolls back.

---

## CI reality

`.github/workflows/ci.yml` gates on `typegen → typecheck → lint → npm test (unit) → build`.
Integration runs **nightly only**, and **skips silently** when `STAGING_SUPABASE_URL`
is unset (`integration.yml`, `echo "ready=false"`).

Consequence: a green repo proves nothing about suppression bypass, webhook
signing, or flow at-most-once — all three are launch-gate invariants in §18.

---

## Recommended order

1. **Owner ruling on Pile C** (blocks everything downstream).
2. **Pile A defects**, in listed order. A1/A2/A9 are self-contained. A4/A5 are security.
3. **`crm_tasks.opportunity_id`** — one migration that unblocks My Work and next-action coverage.
4. **Pile B subsystems**, largest-value first.

Per `CLAUDE.md`: one phase per session, `docs/PROGRESS.md` updated at the end of
each, and no phase advanced with a failing build.
