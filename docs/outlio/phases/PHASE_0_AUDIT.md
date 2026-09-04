# Phase 0 — Narrative audit by subsystem

Contract §13 step 3. One page or less each. Companion to `02_GAP_MATRIX.csv`
(the row-level claims) and `PHASE_0_EVIDENCE.md` (what was executed).

Everything below is measured against the code's own stated intent, because
`PRODUCT_SPEC.md` does not exist. That limitation is the single most important
thing to read this document with.

---

## 1. Auth, workspaces and permissions

**Current state:** the most finished subsystem in the repo, and the only one
where the abstraction and the usage agree everywhere I looked.

**Functional:** email/password sign-in and sign-up; workspace creation on
sign-up; the approved/pending/denied access gate; a 45-permission model resolved
through one pure function; the edge guard in `proxy.ts`. Sign-in and sign-up
were reworked earlier this session — outlined inputs, a password reveal toggle,
field-targeted error focus, and an anti-enumeration rule that deliberately
withholds the field name on a bad credential pair while supplying it on every
sign-up rejection.

**Models:** `workspaces`, `workspace_memberships`, `profiles`, `plans`. RLS on
all.

**Permissions:** `lib/workspaces/permissions.ts:246` (`decidePermission`) with a
total role hierarchy and matrix tests; `lib/auth/decide.ts` is the pure access
decision; `lib/auth/access.ts` only gathers inputs. This is the discipline
CLAUDE.md asks for and it holds.

**Architectural conflict:** §5.2 of the contract requires `permissions.yaml` as
the single source of truth with generated types. The repo satisfies the intent
by a different mechanism. **DECISION-06**; §2.1 already resolves it in the
repo's favour, but the contract text should be corrected rather than quietly
ignored.

**Security risks:** none found in this phase. The service role bypasses RLS and
every service-role query I read scopes by `workspace_id` in code.

**Repair phase:** none.

---

## 2. CRM

**Current state:** the broadest subsystem, genuinely working at its centre, with
three capabilities at the edge that exist as schema or as libraries and have no
route into them.

**Functional:** contacts (list, detail, create, edit, soft delete, sortable
columns, export in a CRM kind and a marketing kind that excludes suppressed
addresses); companies; pipelines and stages; opportunities and stage moves;
tasks; the append-only activity timeline; duplicate detection and merge; reports
(pipeline totals, batch funnel, leaderboard, forecast, overdue) with CSV export.

**Partial:** CSV import has parsing, mapping suggestion and plan-building
(`lib/crm/csv-import.ts:265`) with `crm_import_jobs` at 0 rows — the mechanics
are built and the round trip is unproven. Notes exist with one row and no
dedicated surface. Custom dashboards render but the widget catalogue is thin.

**Backend-only:** static lists. `crm_lists` is readable at
`app/(product)/crm/lists/page.tsx`, writable through `/api/v1/lists` and through
the `ADD_TO_LIST` / `REMOVE_FROM_LIST` flow actions — and **there is no way to
create a list in the UI.** The page has one `Link`, to `/crm/contacts`. Both
tables are empty.

**Dead:** `lib/crm/custom-fields.ts` — 326 lines, eight field types, a passing
test file, **zero importers**, two empty tables. See evidence #3.

**Missing:** `crm_saved_views` — a table with no code of any kind.

**APIs:** six v1 resources, all correctly authenticated and workspace-scoped
through `apiRoute` (evidence #6).

**Events:** contact creation, stage change, opportunity won and task completion
all dispatch flow triggers. This is the CRM's main outward edge and it works.

**Tests:** strong unit coverage. No E2E.

**Security risks:** none new. The append-only guard is real and has now bitten
twice through `ON DELETE SET NULL` foreign keys — migration `0109` is the fix
and **is not yet applied**.

**Recommended reuse:** `lib/crm/repository.ts` and the activity writer are the
right foundation; nothing here needs replacing.

**Repair phase:** lists and import → P2; custom fields and saved views → P3
(and the honest option for custom fields is deletion, not completion).

---

## 3. Email and outreach

**Current state:** a well-built engine with a legal hole in front of it and no
mailbox behind it. This is the subsystem I would not ship.

**Functional (by construction, unproven in production):** the send worker with
idempotency keys and a deliberate no-in-process-retry rule
(`lib/email/send.ts:224`); reply sync and `Message-ID`/`In-Reply-To` threading
(`:309`); enrollment with pause and resume; warm-up ramp and sending windows;
auto-reply and out-of-office detection; DNS readiness checks for SPF, DKIM and
DMARC; suppression enforcement on the send path (`send.ts:109`); the unsubscribe
token, verification and landing route.

**Broken:** **no message Outlio sends can carry `List-Unsubscribe`.**
`unsubscribeHeaders()` and `shouldIncludeUnsubscribe()` are called by nothing,
and `OutboundMessage` (`lib/email/provider.ts:52`) has no `headers` field to
carry them through. No unsubscribe link is written into the body either, and a
sender postal address does not exist anywhere in the codebase. Full detail and
the legal citations are evidence #1.

**Partial:** campaigns and sequence steps (0 rows); inbox; analytics. Mailbox
connect works as far as it can be tested — the SMTP error classifier was fixed
this session so Gmail's `535` no longer reports as a permanent message rejection
— and **DECISION-04 is open pending a Google app password**.

**Provider capabilities:** SMTP/IMAP only. `lib/email/capabilities.ts` already
models per-provider capability including one-click list-unsubscribe, which makes
the gap above more pointed: the capability model knows about a feature the
transport type cannot express.

**Events:** `email_replied` and `email_bounced` dispatch flow triggers.
`email_sent` and `email_unsubscribed` are declared as triggers and never fired.

**Tests:** unit coverage is good and, in the unsubscribe case, **passes while
asserting nothing about production behaviour**. `npm run test:email` runs the
real SMTP and IMAP paths against a GreenMail container.

**Security and legal risks:** the CAN-SPAM and bulk-sender gaps above. Nothing
has been sent, so nothing non-compliant has happened yet.

**Architectural conflict:** §6.2 of the contract asserts email law is handled.
It is not. That assertion should be corrected, not deferred.

**Repair phase:** headers, body link and postal address → **P0.5, before Phase 7
sends anything**. Campaigns, inbox and analytics → P7.

---

## 4. Flows and automation

**Current state:** the engine is sound; the trigger surface is two-thirds
promise. Most of this session's work landed here and it shows on the action
side.

**Functional:** the visual builder; immutable published versions; the run engine
with step claiming, leases (`RUN_LEASE_MS = 90_000`) and loop protection
(`lib/flows/engine.ts:276`); the `vars.*` run variable store, added this session
with migration `0108`; **all 29 actions registered to real handlers** — the
seven that were offered with no handler are now implemented, and typed editors
exist for assignee, assignee pool, campaign, task, send-email, Hubble, branch,
update-field, date-calc and text-transform steps; the send-authority gate.

**Partial:** dry-run simulation. Manual runs work from the builder's test button
(`app/(product)/flows/actions.ts:343`) but not through the dispatch path.

**Missing:** **eleven of seventeen triggers never fire.** Six do. `call_booked`
fires only behind an `options.triggerFlowId` that no caller supplies. All
eleven remain selectable in the builder, and a flow built on one is silently
inert forever — `flow_runs` is 0 rows. Evidence #2.

**Models:** `flows`, `flow_versions` (immutable), `flow_runs` (now with
`variables jsonb`), `flow_step_runs`.

**Tests:** the largest single block of unit tests in the repo. They cover the
engine, the definition validator, publish problems and each action. **No test
asserts that a declared trigger has a producer** — which is precisely why the
gap survived.

**Security risks:** the outbound `WEBHOOK` action goes through `assertFetchable`
with DNS resolution, `redirect: 'manual'`, a 10s timeout, and posts ids rather
than records. That is the right shape.

**Architectural conflict:** none. §5.1's Postgres-native queue with
`FOR UPDATE SKIP LOCKED` is what the repo already does.

**Repair phase:** P4 — and the first deliverable there should be a structural
test that fails when a declared trigger has no producer, before any producer is
written.

---

## 5. Intelligence (Hubble)

**Current state:** the subsystem with the most real production data behind it —
2,294 evidence rows across 91 research runs.

**Functional:** ask and research runs; credit metering
(`lib/hubble/execute.ts:164`); the evidence store with provider-and-URL
citations; the SSRF-guarded page fetcher (`lib/hubble/net/guard.ts`); the
evidence-to-CRM bridge added this session (`lib/crm/evidence-bridge.ts:90`),
which reads contacts first and evidence second so tenancy is decided by the
contact, and which recovered 12 emails and 7 phone numbers that had been
stranded in `research_evidence` while `crm_contact_emails` sat empty.

**Providers:** Ollama for LLM and embeddings, a search provider, Solr, an MCP
web-research provider, Crawl4AI for fetching, plus readability and Cloudflare
email-obfuscation decoders.

**Partial:** qualification profiles — one row, thin UI.

**Rules that hold:** CLAUDE.md rule 4 is enforced structurally, not by
convention. A contact detail is stored only when literally observed, with the
evidence row as its citation; `MIN_EVIDENCE_CONFIDENCE = 0.7`; synthesising
`first.last@company.com` remains impossible by construction rather than by
policy. The 2026-09-03 owner revision widened *where* Outlio may fetch and did
not touch this, correctly.

**Security risks:** the fetch guard resolves DNS before connecting, which is the
part most SSRF guards get wrong. No CAPTCHA solving and no evasion code, per
rule 1 as revised.

**Exposure the owner has accepted and I am not re-litigating:** target-site ToS,
and GDPR Art. 14 notification within one month for personal data collected
without the subject's knowledge. Recorded here because a handoff reader will ask.

**Repair phase:** P6 for qualification profiles. Nothing structural.

---

## 6. Extraction (LinkedIn saved pages)

**Current state:** the original product, and the most battle-tested path —
1,193 leads from 87 jobs.

**Functional:** HTML upload; the `job_queue` with `FOR UPDATE SKIP LOCKED`
claims, attempts and backoff; the cheerio parser; CSV and XLSX export with the
shared `sanitizeCell()`; browser-extension pairing and capture.

**Rules that hold:** no request to `linkedin.com` from our servers; no headless
browser; no automated navigation; uploaded HTML is never rendered; a zero-lead
result raises `ERR_FILE_FORMAT` loudly rather than succeeding empty; storage keys
are server-generated and never derived from a user filename.

**Tests:** hostile fixtures exist as CLAUDE.md requires — empty file, binary
renamed `.html`, nested-div bomb, embedded `<script>`, zero-result page, and a
lead named `=cmd|'/c calc'!A1`.

**Risks:** the parser has been broken once by a LinkedIn deploy and will be
again. Anchoring on `data-anonymize` rather than Ember ids or CSS-module hashes
is the mitigation and it is applied consistently.

**Repair phase:** none.

---

## 7. Platform (API, webhooks, worker, billing, integrations)

**Current state:** working, with the scheduling story more fragile than it looks
and the migration story genuinely broken.

**Functional:** the public v1 API across six resources with key auth, scope
checks, rate limiting and workspace scoping in one wrapper
(`lib/api/handler.ts:46`); API key issue and revoke; outbound webhooks with
retry (`lib/api/webhooks.ts:69`); the six-job tick (`lib/workers/tick.ts:95`);
FastSpring billing with plan limits read from `plans.limits` JSONB at runtime;
the admin console with same-transaction audit logging.

**Partial:** GoHighLevel, Google Sheets export and Calendly ingest — four
`integration_connections` rows, no meeting bookings.

**Broken:** the remote `supabase_migrations.schema_migrations` table does not
record this repo's 109 migrations, because every one was applied by hand in the
SQL editor. `supabase db push` therefore **replays from `0001` against
production** — attempted on 2026-09-04, failed at `0080`'s trigram index before
doing damage. **DECISION-02.**

**Also broken:** migration `0109` is written, unit-tested and unapplied. Until it
runs, any user who has ever performed a CRM action cannot be deleted, and the
error blames the append-only guard rather than the foreign key that causes it.

**Scheduling:** Vercel Hobby allows one cron per day, so the real scheduler is a
GitHub Actions workflow calling `/api/cron` every five minutes. It works and it
is load-bearing and it is invisible from inside the app.

**Risks:** the tick is a single serial pass over six jobs. A slow mailbox
blocking webhook delivery and flow resumption is anticipated in the file's own
header comment; it is not yet a problem at this scale and will be.

**Repair phase:** migrations → P0.5. Integrations → P8.
