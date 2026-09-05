# Phase 3 — Contact + Company workspaces; evidence/provenance surfacing

Per §10. Status: **BRIEF — contains open questions, so it needs approval before
implementation.**

---

## GOAL

§9: *"Contact + Company workspaces; evidence/provenance surfacing"*.

The substance is the second half. Production holds **2,294 research evidence
rows across 91 runs**, every one carrying the provider and URL it came from — and
**a CRM user cannot see any of it.** The detail page shows a value and gives no
way to ask where it came from.

Four things:

1. **Make a bridged value citable** — today the citation is lost at the CRM layer.
2. **Surface provenance** on contact and company detail.
3. **Bring the company detail page up to the contact page's level** (173 lines vs 365).
4. **A "missing data" state that is honest** rather than an empty cell.

## OUT OF SCOPE

- The Hubble console and research runs themselves (Phase 6 for qualification).
- Opportunity or pipeline surfaces (Phases 5–6).
- Any new provider or fetching. Phase 3 displays what has already been observed.
- Saved-views UI, carried over from Phase 2 and noted below.

---

## CURRENT STATE

`VERIFIED` against production and staging on 2026-09-05.

### ⚠️ The finding that shapes this phase: the citation does not survive the bridge

`research_evidence` carries full provenance:

```
source_provider · source_url · source_confidence · confidence
retrieved_at · research_run_id
```

`crm_contact_emails` carries:

```
address · identity_key · is_primary · source
```

**`source` is an enum, not a citation.** There is no `evidence_id`, no
`source_url`, no `retrieved_at`. A search across every column in the database
for `%evidence%`, `%citation%` or `%source_url%` returns nothing on any `crm_*`
table.

So once `syncContactEvidenceToCrm` copies an address into the CRM, **the link to
the page it came from is gone.** Re-deriving it means matching on
`user_id + entity_id + field + value` across a tenancy boundary, which is fragile
and would silently return the wrong row if a value were ever observed twice.

⚠️ **This is in tension with CLAUDE.md rule 4**, which says a value may be stored
only if literally observed *"and the evidence row naming the provider and URL is
kept as its citation"*. The evidence row is kept — in a different table, reachable
only by inference. The rule's intent is not met at the CRM layer, and Phase 3 is
where that is either fixed or consciously accepted.

### The two tenancy models meet here, and this is the seam

Phase 1 established that 64 tables are `workspace_id`-scoped and 42 are
`user_id`-scoped. **Evidence surfacing crosses that line**: `research_evidence`
is `user_id`-keyed and its `entity_id` points at `extracted_leads`, while
`crm_contacts` is `workspace_id`-keyed.

`lib/crm/evidence-bridge.ts:102` already documents the safe direction —
*"contacts first, evidence second… starting from `crm_contacts` scoped to this
workspace makes the workspace boundary the first filter rather than the last"*.
Any read path built in this phase must follow the same order. Reading evidence
first and looking up contacts after would take a tenant id from another table's
row, which is the shape of a cross-tenant leak.

### What already works (`VERIFIED`)

- `lib/crm/evidence-bridge.ts` — recovered 12 emails and 7 phones that were
  stranded; runs on the tick as `sync_contact_evidence`.
- Contact detail (365 lines): identity, company, owner, emails, phones, tags,
  notes, activity, tasks.
- `MIN_EVIDENCE_CONFIDENCE = 0.7` — a threshold that already exists and is not
  shown to anyone.
- Tenant isolation for contact detail, proven at a URL (Phase 1).

### What is missing

1. **No provenance UI anywhere in the CRM.** `research_evidence` is read only by
   `components/intelligence/HubbleConsole.tsx`.
2. **No citation column** on any CRM table (above).
3. **Company detail is thin** — 173 lines against the contact page's 365.
4. **No missing-data indicator.** CLAUDE.md rule 4 requires `NULL` *plus an
   indicator*; the pages render an empty cell, which reads as "not applicable"
   rather than "we never found this".

## ARCHITECTURE TO REUSE

- `lib/crm/evidence-bridge.ts` — the ordering rule and `MIN_EVIDENCE_CONFIDENCE`
- `lib/auth/scope.ts` — `TenantScope`; every new read takes one
- `lib/crm/contacts-list.ts` — `getContactDetail` is where detail loading lives
- `components/ui/Monogram.tsx`, `LocalTime.tsx` / `RelativeTime`

## DO-NOT-TOUCH

- The bridge's contacts-first ordering (`evidence-bridge.ts:102`).
- `MIN_EVIDENCE_CONFIDENCE` without a stated reason — it is a product judgement,
  not a tuning knob.
- CLAUDE.md rule 4: **no inference, no LLM gap-filling.** A surfaced value must
  be one that was observed. Phase 3 makes provenance visible; it must not invent
  any.
- The flow runtime; the landing page.

## MODELS / MIGRATIONS / APIs / EVENTS / PERMISSIONS / WORKERS / PROVIDERS

- **Migrations:** one, if open question 1 is answered "add the column" — an
  `evidence_id` on `crm_contact_emails` and `crm_contact_phones`, nullable,
  `ON DELETE SET NULL`. ⚠️ Neither table is append-only (checked), so SET NULL is
  safe here — unlike the four tables 0109 had to repair.
- **APIs / events / workers / providers:** no change.
- **Permissions:** provenance is visible to anyone who can already see the value.
  A source URL is not more sensitive than the address it produced.

## TESTS TO WRITE

| Kind | Test |
|---|---|
| Unit | evidence→display mapping; a value with no evidence renders the missing-data state, not a blank |
| Reachability | every provenance field the UI claims to show is actually produced |
| Tenant | evidence for workspace B never appears on workspace A's contact, **via the user_id seam specifically** |
| RBAC | a role that cannot see a contact cannot see its evidence |
| E2E | open a contact with bridged data, reveal the source, follow the URL |

⚠️ Every guard verified non-vacuous by breaking what it watches.

## E2E ACCEPTANCE JOURNEY

1. Sign in; open a contact whose email came from research.
2. The email is shown **with an indicator that it was discovered, not entered**.
3. Reveal provenance: provider, source URL, when it was retrieved, confidence.
4. The source URL is a real link to the page the value came from.
5. Open a contact with no research: the same fields show the missing-data state,
   never a blank cell.
6. A second workspace's contact shows none of workspace A's evidence.

## SECURITY + COMPLIANCE NOTES

- ⚠️ **A `source_url` is attacker-influenced data rendered as a link.** It comes
  from a fetched page, not from us. It must be validated as `http(s)` and carry
  `rel="noopener noreferrer"` — a `javascript:` URL in an `href` is stored XSS.
- The user_id/workspace_id seam is the highest-risk join in this phase.
- **GDPR Art. 14** is already accepted exposure (CLAUDE.md, 2026-09-03). Showing
  provenance in-product *helps* here: it makes the source of a person's data
  answerable rather than opaque.

## COST IMPACT

**NONE.** No new dependency, no new provider call. Phase 3 displays data already
collected and paid for.

## OPEN QUESTIONS

**1. ⚠️ Should a bridged value carry a citation column, or be re-derived?**

| Option | Cost | Consequence |
|---|---|---|
| **A. Add `evidence_id`** to `crm_contact_emails` / `_phones` | one migration | The citation is a foreign key. Cheap reads, exact answers, and rule 4's intent is met structurally. Existing rows get `NULL` — honestly "we don't know where this came from" rather than a guess. |
| B. Re-derive by matching value + field + entity | none | No migration, but a cross-tenancy match that returns the wrong row when a value was observed twice, and gets slower as evidence grows. |

**Recommendation: A.** B is the option that looks cheaper and is wrong
occasionally, which is the worst combination — and this project has spent three
phases finding exactly that shape.

**2. What should a value with *no* provenance say?**

Most CRM data has none: manually entered, CSV-imported, or bridged before an
`evidence_id` existed. Options are "Added manually", "Source unknown", or no
indicator at all.

**Recommendation: distinguish them.** `source` already records `manual`,
`csv_import`, `lead_engine`, `api`, `flow` — so "added by hand" and "we have lost
track" are different statements and the data can already tell them apart. Saying
"unknown" for a value someone typed would be a small lie repeated on every row.

**3. Does company detail get the same treatment this phase, or does it wait?**

The company page is less than half the contact page's size, and `company_links`
and `company_signals` are both on the unused-schema allowlist — so companies have
a provenance story that was never built at all.

**Recommendation: contact first, company second, in this phase if it fits.** If
it does not, company detail moves to its own phase rather than shipping a half
version — but I would rather discover that with the contact page finished than
guess now.
