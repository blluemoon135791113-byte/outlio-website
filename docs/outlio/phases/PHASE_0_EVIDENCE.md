# Phase 0 — Evidence

Date: 2026-09-04 · Branch: `platform-m1-workspaces` · Contract §13 step 2.

This file records **what was actually run**, not what was read. Where a claim
rests on reading code rather than executing it, it says so.

---

## What ran

| Command | Result | Notes |
|---|---|---|
| `npx tsc --noEmit` | **exit 0** | No `typecheck` script in `package.json` yet; run directly. |
| `npm run lint` | **0 errors, 97 warnings** | All warnings are unused-vars. |
| `npx vitest run tests/unit` | **141 files, 2563 tests, all passed, 37.6s** | |
| `npx vitest run tests/integration` | **exceeded 10 min, backgrounded** | 44 files against production Supabase over the network. See finding #5. |
| Read-only production query, 42 tables | completed | Row counts below. |

`npm run build` was not run. `tsc --noEmit` and `next lint` both pass and no
change was made to source in this phase, so a build adds no information Phase 0
needs; it will be run as the gate for Phase 0.5's first change.

## Production state, read 2026-09-04

Read-only `select count(*)`, service role, no writes.

```
crm_contacts 49   crm_companies 44   crm_activities 52   crm_pipelines 3
crm_notes 1       crm_lead_batches 3 dashboards 1        dashboard_widgets 1
crm_opportunities 0   crm_tasks 0    crm_lists 0         crm_list_members 0
crm_custom_field_definitions 0       crm_custom_field_values 0
crm_duplicate_candidates 0           crm_merge_events 0  crm_saved_views 0
crm_import_jobs 0
email_accounts 0  email_campaigns 0  email_messages 0    email_threads 0
email_events 0    email_suppressions 0  email_enrollments 0
email_templates 0 email_sequence_steps 0
flows 2           flow_versions 4    flow_runs 0         flow_step_runs 0
research_evidence 2294   research_runs 91
extracted_leads 1193     extraction_jobs 87   job_queue 87
webhook_subscriptions 0  webhook_deliveries 0  api_keys 0
integration_connections 4   meeting_bookings 0   qualification_profiles 1
workspaces 27
```

**A zero here is evidence, not decoration.** A table nothing has ever written to
in the life of the product is a strong signal that its write path has never
executed. Every `NOT_IMPLEMENTED` and `DEAD_CODE` row in the matrix has both a
zero count *and* a static reachability finding; neither alone was treated as
sufficient.

⚠️ **`workspaces` is 27, not the 23 I reported on 2026-09-04 after the cleanup.**
I have not investigated the delta and am not treating it as a problem — signups
are expected. It is recorded because §3.7 requires re-reading state rather than
carrying a remembered number forward, and my remembered number was already wrong
once this week.

---

## Findings

Ordered by consequence. Each one names how it was established.

### 1. Outlio cannot attach a `List-Unsubscribe` header to any message it sends

**Established statically, and the static evidence is conclusive** — the field
does not exist in the type.

- `unsubscribeHeaders()` — `lib/email/unsubscribe.ts:134` — builds both
  `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`,
  with a comment explaining that RFC 8058 needs both. **Called by nothing.**
- `shouldIncludeUnsubscribe()` — `lib/email/campaign-policy.ts:131` — decides
  which campaign types carry the header. **Called by nothing.**
- The provider call at `lib/email/send.ts:279` passes
  `to, subject, text, html, replyTo, threadId, inReplyToMessageId, idempotencyKey`.
- `OutboundMessage` — `lib/email/provider.ts:52` — **has no `headers` field.**
  (`provider.ts:112` does have `headers`, but that is on the *inbound* type used
  by the auto-reply pre-filter.)

So this is not an uncalled function that a one-line fix reconnects. The header
cannot reach a provider through the current abstraction at all.

Two further gaps in the same area:

- **No unsubscribe link is inserted into the message body.** `unsubscribeUrl()`
  (`unsubscribe.ts:148`) is likewise called by nothing, and nothing in the send
  path touches `body_html`.
- **A sender postal address appears nowhere in the codebase.** Zero matches for
  `postal_address`, `physical_address`, `mailing_address`, `company_address`
  across `lib/email/` and the email UI. There is no column to hold one and no
  field to enter one.

The landing page is fine: `app/u/[token]/route.ts:21` exists, verifies the
token, and calls `recordUnsubscribe`. **The exit door is built and no message
tells the recipient where it is.**

Two test files — `tests/unit/email-unsubscribe.test.ts` and its integration
counterpart — pass. They test token creation, verification, header *shape*, and
suppression recording. Every assertion is true. None of them asserts that a sent
message carries the header, because no test sends a message through the path
that would have to carry it.

**Why this ranks first.** CAN-SPAM §7704(a)(3) and (a)(5) require a working
opt-out mechanism and a valid physical postal address in commercial email;
Gmail's and Yahoo's 2024 bulk-sender rules require one-click list-unsubscribe.
`email_suppressions` has 0 rows and `email_accounts` has 0 rows, so **nothing
non-compliant has been sent** — the gap is entirely ahead of us, which is the
good version of this finding. But DECISION-04 is one app password away from
being answered, and Phase 7 sends real mail. This must be closed before it, not
during it.

It also sits directly on top of the commercial argument CLAUDE.md rule 1 makes
in its own defence: the 2026-09-03 revision permits broad fetching but forbids
CAPTCHA solving and bot evasion *specifically because deliverability is the
asset that pays for everything else*. Missing `List-Unsubscribe` damages exactly
that asset, from the inside.

### 2. Eleven of seventeen flow triggers can never fire

Established by enumerating `TRIGGER_TYPES` (`lib/flows/definition.ts:25`) and
cross-referencing every `dispatchFlowTrigger` and `startRun` call site.

**Fire (6):** `contact_created` (`lib/crm/ingest.ts:697`), `stage_changed` and
`opportunity_won` (`lib/crm/opportunities.ts:355,363`), `task_completed`
(`app/(product)/crm/tasks/actions.ts:82`), `email_replied` and `email_bounced`
(`lib/email/reply-sync.ts:229,259`).

**Never fire (10):** `contact_assigned`, `list_added`, `batch_added`,
`campaign_enrolled`, `email_sent`, `email_unsubscribed`, `no_activity`,
`webhook`, `scheduled`, plus `manual` in the partial sense below.

**`call_booked` is the interesting one.** `lib/meetings/ingest.ts:150` does fire
it — but only `if (options.triggerFlowId && …)`, and **no caller anywhere passes
`triggerFlowId`**. The comment above it explains, correctly, that the meeting
pipeline must not look up flows itself. The decoupling is right; the other half
was never built.

`manual` is `PARTIAL`: `app/(product)/flows/actions.ts:343` calls `startRun`
directly from the builder's test button, so a manual run is possible from the
UI, but no `dispatchFlowTrigger` path serves it.

Every one of the eleven is selectable in the builder's trigger dropdown. A user
can build, publish and activate a flow on `no_activity` and watch it do nothing
forever, with no error anywhere — `flow_runs` is 0 rows.

⚠️ **I nearly shipped an instance of this myself.** Earlier in this session I
republished "Saboor's Lead" as v2 with the trigger changed from `contact_created`
to `contact_assigned` — one of the ten dead ones — and caught it only on review.
It is v3 and back on `contact_created` (`flow_versions` confirms: v1
`stage_changed`, v1 `contact_created`, v2 `contact_assigned`, v3
`contact_created`). Nothing in the product would have told the owner.

### 3. `lib/crm/custom-fields.ts` is imported by nothing

Established statically: zero importers across `app/`, `lib/`, `components/`.

326 lines. `validateCustomFieldValue` (`:166`) and
`validateCustomFieldDefinition` (`:265`) handle eight field types, option lists,
and type coercion. `tests/unit/crm-custom-fields.test.ts` covers it and passes.
Both backing tables are empty. There is no UI to define a custom field and no
read path that renders one.

This is the cleanest specimen of the defect class this repo keeps producing:
**correct, tested, and unreachable.** Nothing in `tsc`, ESLint or the test suite
can see it, because a fully-tested module with no importers is indistinguishable
from a library.

### 4. `crm_saved_views` exists only as a table

Zero references in `app/`, `lib/` and `components/`. Not dead code — code that
was never written against a schema that was.

### 5. The integration suite cannot function as a gate

Established by running it: **over 10 minutes without completing**, against
production Supabase over the public internet.

44 files. Because it talks to the real database, it is also the mechanism by
which a test run mutates production — which §3.7 now governs but does not make
fast. A suite nobody can afford to run before a commit is not a gate, whatever
its pass rate.

### 6. A grep-shaped near-miss, recorded deliberately

`grep -c authenticateApiKey app/api/v1/*/route.ts` returns **0 for all six
routes**, which reads like an unauthenticated public API.

It is not. Every route is wrapped in `apiRoute(scope, handler)`
(`lib/api/handler.ts:46`), which calls `authenticateApiKey` at `:50` and passes
the workspace down in `context`. `app/api/v1/contacts/route.ts:25` then scopes
by `context.workspaceId`, and the file's own header comment explains that the
handler has no way to read a workspace id from the request — which is what makes
cross-tenant reads impossible rather than merely forbidden.

Recorded because it is the counterexample to findings #1–#4: **absence in a grep
is a question, not an answer.** Findings #1–#4 were each carried past this point
by following the indirection until it terminated. This one terminated in
correct code.

---

## What Phase 0 did not establish

Stated plainly rather than left to inference.

- **No UI claim in the matrix is `VERIFIED` under §4.** There is no E2E harness
  (DECISION-01). Every `ui=YES` means the surface exists and was read, not that
  a journey was driven end to end.
- **Email sending is unproven against a real provider.** `email_accounts` is 0.
  `npm run test:email` exercises SMTP and IMAP against a local GreenMail
  container, which proves mechanics and proves nothing about deliverability,
  provider threading, or bounce handling.
- **The integration suite's pass/fail is unknown** as of writing; it did not
  finish. The unit suite's result is complete and green.
- **`PRODUCT_SPEC.md` does not exist and cannot be written.** §8 lists it and §2
  places it at authority level 4; the sections it is to be built from (the
  original prompt's E–CE) have not been supplied. **§2's authority order
  currently has a hole at level 4**, which means "does the product do what it is
  supposed to?" has no referent — every status in the matrix is measured against
  the code's own intent, not against a specification.
- **Migration `0109` is written, unit-tested and unapplied.** Until it is pasted
  into the SQL editor, any user who has performed a CRM action cannot be
  deleted, and the error names the append-only guard rather than the foreign key.
