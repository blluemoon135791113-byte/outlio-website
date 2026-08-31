# Outlio Functional Gap Matrix — R0

**Date:** 2026-09-01
**Method:** static inspection of routes, server actions, engine modules, database
tables and tests. **Nothing here is inferred from a page existing.** Every
"functional end-to-end" claim was checked by tracing a caller from a UI surface
down to a mutation.

> **The Ledger equivalent named in the brief** (`OUTLIO_PLATFORM_IMPLEMENTATION.md`)
> is `docs/PROGRESS.md` in this repository. Same role, different filename.

---

## The headline finding

**Six major engines have no caller outside their own module.** They are built,
they are covered by integration tests that invoke them directly, and **no user
can reach any of them**:

| Engine | Module | Reachable from UI |
|---|---|---|
| `ingestExtractionJob` | `lib/crm/ingest.ts` | ❌ none |
| `runCsvImport` | `lib/crm/ingest.ts` | ❌ none |
| `undoBatch` | `lib/crm/ingest.ts` | ❌ none |
| `buildImportPlan` | `lib/crm/csv-import.ts` | ❌ none |
| `createOpportunity` | `lib/crm/opportunities.ts` | ❌ none |
| `createPipeline` | `lib/crm/opportunities.ts` | ❌ none |

This is exactly the brief's thesis, confirmed with evidence rather than
asserted: the modules are pages, not workflows.

## The finding that outranks it

**`runSendWorker` is never called outside its own file and the tests. There is
no cron, no `after()` trigger, and no `vercel.json`.**

```
runSendWorker  → lib/email/send.ts (definition)
               → tests/integration/email-send-worker.test.ts (5 calls)
               → nothing else in the entire repository
```

**`syncWorkspaceReplies` has zero callers anywhere — not even a test.**

Consequences, in order of severity:

1. A campaign can be created, enrolled and **launched, and no email is ever
   sent**. Messages accumulate in `email_messages` with `status = 'queued'`
   forever.
2. Replies are never fetched, so **"stop on reply" can never fire** — the M6
   criterion that stops a sequence when someone answers is unreachable in
   production even though it passes in test.
3. The unified Inbox (built 2026-08-31) will **always be empty**, because
   nothing writes inbound mail.

⚠️ **Why the Ledger says M5 criteria 3 and 4 passed, and was not lying:** the
tests call `runSendWorker` directly. The worker is correct. It is simply never
invoked. This is the same class of defect as `/email` 404ing on the software
domain for months — the code was right and unreachable, and every test,
typecheck and build stayed green.

---

## Matrix

Status values: `COMPLETE` · `PARTIAL` · `UI_ONLY` · `BACKEND_ONLY` · `BROKEN` · `NOT_IMPLEMENTED`

### CRM — contacts and companies

| Feature | UI | Backend | DB | End-to-end | Tested | Missing behaviour | Phase | Status |
|---|:-:|:-:|:-:|:-:|:-:|---|:-:|---|
| Contacts list | ✅ | ✅ | ✅ | ✅ | ✅ | No bulk select, no saved views, no column config, no owner/lifecycle/list/campaign filters | R2 | PARTIAL |
| Contact detail | ✅ | ✅ | ✅ | ⚠️ | ✅ | Full page, not a drawer; brief asks for a drawer so CRM work is not constant navigation | R2 | PARTIAL |
| Contact quick actions | ⚠️ | ⚠️ | ✅ | ❌ | ⚠️ | Only assign, request-reassign, add-note exist. No send email, create task, create opportunity, add to list, add tag, change lifecycle, archive | R2 | PARTIAL |
| Create contact | ❌ | ⚠️ | ✅ | ❌ | ⚠️ | No manual "+ Contact" anywhere in the product | R2 | NOT_IMPLEMENTED |
| Companies list | ✅ | ✅ | ✅ | ✅ | ❌ | Read-only. No company detail view, no owner, no associated opportunities | R2 | PARTIAL |
| Company detail | ❌ | ⚠️ | ✅ | ❌ | ❌ | No route at all | R2 | NOT_IMPLEMENTED |
| Contact import (CSV) | ❌ | ✅ | ✅ | ❌ | ✅ | **Engine complete and tested; zero UI.** No upload, mapping, validation report, preview or undo screen | R1 | BACKEND_ONLY |
| Lead Engine → CRM | ❌ | ✅ | ✅ | ❌ | ✅ | **`ingestExtractionJob` has no caller.** No "Add to CRM" on a batch, no selection, no pre-commit summary, no sync-mode setting | R1 | BACKEND_ONLY |
| Lists | ✅ | ⚠️ | ✅ | ❌ | ⚠️ | Read-only list of lists. Cannot create, add contacts, bulk add, remove, or use as campaign audience | R2 | UI_ONLY |
| Duplicate Center | ✅ | ✅ | ✅ | ✅ | ✅ | Detection scan has no scheduled trigger | R2 | COMPLETE |
| Tags / lifecycle | ❌ | ⚠️ | ✅ | ❌ | ⚠️ | Schema exists; no UI | R2 | BACKEND_ONLY |

### Team and permissions

| Feature | UI | Backend | DB | End-to-end | Tested | Missing behaviour | Phase | Status |
|---|:-:|:-:|:-:|:-:|:-:|---|:-:|---|
| Invitations | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | COMPLETE |
| Roles | ✅ | ✅ | ✅ | ✅ | ✅ | 5 roles, 44 permissions, matrix-tested | — | COMPLETE |
| Only-assigned-data | ⚠️ | ✅ | ✅ | ⚠️ | ✅ | Enforced for inbox and tasks. **Not applied to contacts, opportunities or search** | R3 | PARTIAL |
| Followers / collaborators | ❌ | ❌ | ❌ | ❌ | ❌ | No table, no concept | R3 | NOT_IMPLEMENTED |
| Reassign active records | ❌ | ⚠️ | ✅ | ❌ | ⚠️ | No bulk reassignment on member removal | R3 | PARTIAL |

### Opportunities and pipelines

| Feature | UI | Backend | DB | End-to-end | Tested | Missing behaviour | Phase | Status |
|---|:-:|:-:|:-:|:-:|:-:|---|:-:|---|
| Create pipeline | ❌ | ✅ | ✅ | ❌ | ✅ | **`createPipeline` has no caller. This is the bug reported by the user.** The board renders an empty state with no way out of it | R5 | BACKEND_ONLY |
| Configure stages | ❌ | ⚠️ | ✅ | ❌ | ⚠️ | Schema has `sort_order`, `default_probability`; no editor, no colours, no stale threshold | R5 | BACKEND_ONLY |
| Create opportunity | ❌ | ✅ | ✅ | ❌ | ✅ | **`createOpportunity` has no caller.** None of the 8 creation sources in the brief exist | R4 | BACKEND_ONLY |
| Kanban board | ✅ | ✅ | ✅ | ⚠️ | ✅ | Renders and drag-to-move works. No stage totals, no card field config, no collapse/resize, no filters, no search | R5 | PARTIAL |
| Opportunity list view | ❌ | ⚠️ | ✅ | ❌ | ❌ | No alternative to the board | R5 | NOT_IMPLEMENTED |
| Opportunity detail | ❌ | ✅ | ✅ | ❌ | ✅ | `getOpportunity` exists; no drawer or page | R4 | BACKEND_ONLY |
| Opportunity import | ❌ | ❌ | ✅ | ❌ | ❌ | Not built at any layer | R4 | NOT_IMPLEMENTED |
| Opportunity custom fields | ❌ | ⚠️ | ⚠️ | ❌ | ❌ | `crm_custom_fields` exists for contacts; not wired to opportunities | R4 | NOT_IMPLEMENTED |
| Conditional stage fields | ❌ | ❌ | ❌ | ❌ | ❌ | Not built | R4 | NOT_IMPLEMENTED |

### Tasks and notes

| Feature | UI | Backend | DB | End-to-end | Tested | Missing behaviour | Phase | Status |
|---|:-:|:-:|:-:|:-:|:-:|---|:-:|---|
| Task list + views | ✅ | ✅ | ✅ | ⚠️ | ❌ | Open/overdue/mine/completed views render; complete/reopen works | R6 | PARTIAL |
| Create task | ❌ | ⚠️ | ✅ | ❌ | ❌ | **No "+ Task" anywhere.** Tasks can only arrive from a flow | R6 | NOT_IMPLEMENTED |
| Notes | ⚠️ | ✅ | ✅ | ⚠️ | ✅ | `addNoteAction` exists on contact detail only | R6 | PARTIAL |

### Email

| Feature | UI | Backend | DB | End-to-end | Tested | Missing behaviour | Phase | Status |
|---|:-:|:-:|:-:|:-:|:-:|---|:-:|---|
| **Send worker execution** | ❌ | ✅ | ✅ | ❌ | ✅ | **NOTHING TRIGGERS IT. No cron, no `after()`, no `vercel.json`. Launched campaigns never send.** | R10 | BROKEN |
| **Reply sync execution** | ❌ | ✅ | ✅ | ❌ | ✅ | **`syncWorkspaceReplies` has zero callers.** Stop-on-reply can never fire; the Inbox is permanently empty | R10 | BROKEN |
| Mailbox connection (SMTP) | ✅ | ✅ | ✅ | ✅ | ✅ | Gmail/Microsoft adapters not built (OAuth credentials absent) | R10 | PARTIAL |
| Mailbox readiness | ⚠️ | ✅ | ✅ | ⚠️ | ✅ | Engine complete: SPF/DKIM/DMARC, ramp, gate. Thin UI; no per-domain rollup screen | R10 | PARTIAL |
| Campaign create / launch / pause | ✅ | ✅ | ✅ | ⚠️ | ✅ | Launch enqueues but nothing sends (see above) | R12 | PARTIAL |
| Sequence builder | ❌ | ✅ | ✅ | ❌ | ✅ | Steps/waits/branches exist in schema; **no builder UI**, no variants, no per-step editor | R12 | BACKEND_ONLY |
| Campaign leads tab | ❌ | ✅ | ✅ | ❌ | ✅ | `enrolContacts` exists; no leads table, no audience picker, no per-contact status | R12 | BACKEND_ONLY |
| Campaign schedule / options | ❌ | ✅ | ✅ | ❌ | ✅ | Windows, timezone, ramp and limits are enforced server-side; **no settings UI** | R13 | BACKEND_ONLY |
| Inbox | ✅ | ✅ | ✅ | ⚠️ | ✅ | Views, permissions, keyset paging, assign/resolve all work — but **no thread view and no reply composer**, and it stays empty while sync never runs | R11 | PARTIAL |
| Email analytics | ❌ | ✅ | ✅ | ❌ | ✅ | `email_campaign_report`, `email_mailbox_report`, `email_batch_funnel` all exist; no screen | R14 | BACKEND_ONLY |
| Suppression | ❌ | ✅ | ✅ | ⚠️ | ✅ | Enforced at enqueue and claim; no management UI | R14 | BACKEND_ONLY |
| Unsubscribe | ✅ | ✅ | ✅ | ✅ | ✅ | RFC 8058 one-click, HMAC tokens | — | COMPLETE |
| Auto-reply detection | — | ✅ | ✅ | ⚠️ | ✅ | Deterministic, header-first, anchored subject matching. Unreachable while sync never runs | R10 | BACKEND_ONLY |

### Flows

| Feature | UI | Backend | DB | End-to-end | Tested | Missing behaviour | Phase | Status |
|---|:-:|:-:|:-:|:-:|:-:|---|:-:|---|
| Flow runtime | — | ✅ | ✅ | ✅ | ✅ | Claim, backoff, loop protection, pinned versions, at-most-once | — | COMPLETE |
| Flow actions | — | ✅ | ✅ | ✅ | ✅ | CRM, email, Hubble, notify handlers registered | — | COMPLETE |
| Flow builder | ⚠️ | ✅ | ✅ | ❌ | ⚠️ | **Vertical step list, no canvas.** No node library, no branch drawing, no config panel, no undo/redo | R9 | PARTIAL |
| Flow templates | ❌ | ❌ | ❌ | ❌ | ❌ | None of the 10 starter templates exist | R9 | NOT_IMPLEMENTED |
| Flow test mode | ❌ | ❌ | ⚠️ | ❌ | ❌ | No dry run, no simulated steps | R9 | NOT_IMPLEMENTED |
| Flow run history | ❌ | ✅ | ✅ | ❌ | ✅ | `flow_step_runs` records input/output/status/attempt per step; **no screen** | R8 | BACKEND_ONLY |
| Trigger coverage | — | ⚠️ | ✅ | ⚠️ | ⚠️ | Manual and list triggers work. Most of the brief's 20 triggers are not wired to real events | R8 | PARTIAL |

### Reporting

| Feature | UI | Backend | DB | End-to-end | Tested | Missing behaviour | Phase | Status |
|---|:-:|:-:|:-:|:-:|:-:|---|:-:|---|
| Fixed dashboards | ✅ | ✅ | ✅ | ✅ | ✅ | Forecast, win rates, leaderboard, batch funnel | — | COMPLETE |
| Report export (CSV) | ✅ | ✅ | ✅ | ✅ | ✅ | Synchronous; record-level export deferred (DR17) | — | COMPLETE |
| Custom dashboards | ❌ | ❌ | ❌ | ❌ | ❌ | No builder, no widgets, no saved dashboards, no custom metrics | R7 | NOT_IMPLEMENTED |
| Custom-field reporting | ❌ | ❌ | ⚠️ | ❌ | ❌ | No SUM/AVG/MIN/MAX aggregation over custom fields | R7 | NOT_IMPLEMENTED |
| Attribution to lead batch | — | ✅ | ✅ | ✅ | ✅ | Frozen owner/team at event; batch funnel proven end-to-end | — | COMPLETE |

### Platform

| Feature | UI | Backend | DB | End-to-end | Tested | Missing behaviour | Phase | Status |
|---|:-:|:-:|:-:|:-:|:-:|---|:-:|---|
| Public API v1 | ✅ | ✅ | ✅ | ✅ | ✅ | Scopes, rate limits, workspace scoping | — | COMPLETE |
| Outbound webhooks | ✅ | ✅ | ✅ | ✅ | ✅ | Signed, retried, stable event id, delivery logs | — | COMPLETE |
| Slack / Teams notify | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | COMPLETE |
| Meetings / Calendly | ❌ | ✅ | ✅ | ⚠️ | ✅ | Webhook + normalisation complete; no UI, no unmatched-invitee queue screen | R17 | BACKEND_ONLY |
| Calendar sync | ❌ | ❌ | ❌ | ❌ | ❌ | Blocked: no Google/Microsoft OAuth credentials | R17 | NOT_IMPLEMENTED |
| Onboarding / first run | ✅ | ✅ | ✅ | ⚠️ | ✅ | **Its "Set up your pipeline" step is a dead end** — it links to a board with no create button | R5 | PARTIAL |

---

## Cross-cutting gaps

**Event gaps.** `publishEvent` exists and is wired to webhooks, but most domain
events in the brief's trigger list are never emitted, so the flow triggers that
depend on them can never fire.

**Permission gaps.** ⚠️ **CORRECTED 2026-09-01 — the original claim here was
wrong.** It said "only assigned data" was not enforced on contacts or
opportunities and that a setter could read every contact. That was a bad read:
`dataScope` **is** applied to the contacts list, contact detail, the pipeline
board and reports.

The real gap was narrower and newer: **`/crm/companies` had no owner filter**,
shipped that way on 2026-08-31. `crm_companies` carries `owner_user_id` and is
indexed on it, so a setter saw every company in the workspace. Fixed in R5.
Still unscoped: global search and Hubble context.

**Test gaps.** Coverage is strong at the engine layer (2,213 unit + ~350
integration) and **absent at the wiring layer**. Every one of the failures above
is a wiring failure, and none of them was caught. Specifically missing: a test
that asserts each engine has a reachable caller, and a test that asserts each
background worker has a trigger.

**Verification gap (KI9).** Twelve screens have never been rendered in a browser
by anyone during development. Visual and interaction correctness is unverified.

---

## Repair order

The brief's R1–R19 stand, with two changes justified by the evidence above:

1. **R10 (worker execution) moves to the front.** It is the only `BROKEN`
   entry. Every email phase after it — campaigns, sequences, inbox, analytics —
   is unverifiable until something actually sends.
2. **Pipeline and opportunity creation (R4/R5) come next**, because the
   onboarding checklist currently sends a new customer to a dead end, and
   because a CRM that cannot create a deal is not a CRM.

Revised order: **R10 → R5 (pipeline create) → R4 (opportunity create) → R1
(Lead Engine → CRM) → R2 → R3 → R6 → R12 → R11 → R13 → R14 → R8 → R9 → R7 →
R15 → R16 → R17 → R18 → R19.**
