# Outlio — System Handoff

**Date:** 2026-09-04
**Scope:** the whole authenticated product — Lead Engine, Hubble Intelligence, CRM, Outreach, Automations, Reporting.
**Audience:** an engineer or reviewer picking this up cold.

This describes what exists and how it actually behaves, including where it is
weak. Claims about behaviour were verified against the running production
system, not inferred from source.

---

## 1. What Outlio is

A private B2B SaaS with one thesis: **a lead is worth nothing until you can
prove where the fact came from.**

The pipeline is:

```
saved page / CSV / extension capture
        ↓  parse (server-side, cheerio)
   extracted_leads          ← immutable record of what the page said
        ↓  ingest
   crm_contacts             ← de-duplicated, canonical people
        ↓  research (Hubble)
   research_evidence        ← every value with the provider + URL that produced it
        ↓  bridge
   crm_contact_emails / _phones
        ↓
   Outreach · Automations · Reporting
```

Two rules shape almost every design decision:

1. **Never fabricate.** A missing value is `NULL` plus a visible missing-data
   indicator. Enrichment is permitted (owner decision, 2026-09-03) but a value
   may only be stored if it was *literally observed*, and the evidence row
   naming the provider and URL is kept as its citation. Synthesising
   `first.last@company.com` from a name and a domain remains forbidden.
2. **Authorization is server-side.** Hiding a button is not access control. RLS
   on every table; the service role bypasses RLS, so every service-role query
   scopes by `workspace_id` in code.

---

## 2. Architecture

```
Next.js 16 (App Router, Turbopack) on Vercel
  ├── proxy.ts            edge guard (Next 16's renamed middleware)
  ├── app/(auth)          sign-in, sign-up, MFA, recovery
  ├── app/(product)       the authenticated app  →  app.outlio.io
  └── app/                marketing site         →  outlio.io

Supabase Postgres — 124 tables, 108 migrations, RLS everywhere
Node worker library (lib/workers/tick.ts), triggered by cron
```

**Three Supabase clients**, and the distinction is load-bearing:

| Client | Used by | Respects RLS |
|---|---|---|
| `lib/supabase/client.ts` | browser | yes |
| `lib/supabase/server.ts` | RSC + server actions | yes |
| `lib/supabase/admin.ts` | workers, service role | **no — scope by hand** |

**Scale:** 58 product routes, 91 components, 37 lib modules, 2,543 unit tests
across 140 files, plus 43 integration suites that run against a live database.

---

## 3. The five surfaces

### 3.1 Lead Engine (extraction)

Input arrives by exactly three routes: a file the user uploads, a page the
browser extension captures during a session they explicitly started, or a CSV
import. **There is no crawler.** No headless browser, no automated navigation
of LinkedIn, no credential login (`CLAUDE.md` rules 1–2).

Parsing is server-side with `cheerio`, anchored on `data-anonymize` attributes
— never Ember ids or CSS-module hashes, which change every LinkedIn deploy. A
zero-lead result is a loud `ERR_FILE_FORMAT`, never a silent empty success.

Work runs through `job_queue` with `FOR UPDATE SKIP LOCKED` claims, attempt
counts, backoff and a stale-claim reaper. Extraction never runs inside a
request handler — jobs must survive the browser closing.

### 3.2 Hubble Intelligence (research)

Given a lead, Hubble researches the person and company across external
sources and writes `research_evidence` rows: `field`, `value_json`,
`source_provider`, `source_url`, `source_confidence`, `confidence`,
`retrieved_at`, `expires_at`.

Providers include Prospeo, Apollo, Scout, social-scout, web-research MCP,
GLEIF, SEC EDGAR, Companies House, GitHub, Wikidata, DNS/tech probes and
PageSpeed. All model calls funnel through a single `hubbleExecute` boundary —
no module calls an LLM directly.

Supporting machinery worth knowing about:
- `lib/hubble/net/guard.ts` — SSRF guard that **resolves DNS** and requires
  every returned address to be public. Screening the URL string alone is
  defeated by a hostname that resolves to `127.0.0.1`.
- `lib/hubble/extract/cfemail.ts` — decodes Cloudflare's email obfuscation.
  This is equivalent to rendering the page, which every visitor's browser does
  automatically; it is not CAPTCHA bypass.

**Credits** are user-scoped. Every AI action states its price before it runs.

### 3.3 CRM

32 tables. The core objects are contacts, companies, opportunities, pipelines,
stages, tasks, lists, tags, notes, activities and lead batches.

Design points that matter:

- **Identity keys, not addresses.** `crm_contact_emails` stores the address you
  contact and a separate folded `identity_key` you compare on, so
  `J.Doe+news@Gmail.com` and `jdoe@googlemail.com` dedupe. Never send to the
  identity key.
- **Phone regions are never guessed.** `07700 900123` is a UK mobile and a
  landline elsewhere. A national-format number with no country is stored with
  `e164: null` and `reason: 'ambiguous_no_country'` — kept and shown, but it
  never blocks a merge.
- **`crm_activities` is append-only.** Enforced by a database trigger. This is
  why deleting a contact is impossible; the product soft-deletes.
- **Opportunities use optimistic locking.** `version` plus
  `crm_move_opportunity_stage` means two people dragging the same card cannot
  silently overwrite each other.
- **Batch attribution.** `crm_batch_funnel` ties a source batch to revenue
  through five links: batch → member → contact → opportunity → won. Each link
  degrades to zero rather than to an error, which is why it has an integration
  test asserting a *second* batch is not credited.

**Contacts list** is server-filtered and paged with trigram indexes, sortable
on Name and Added — deliberately not on company, email, owner or last activity,
because those are resolved *after* the page is fetched and a control there
could only sort the 25 rows in hand. Counts use `estimated` above a threshold
and are rendered as "about N" rather than a precise-looking figure.

**Export** ships two files. `Export CSV` is the whole book. `Email list` is
separate because it excludes `email_suppressions` — the send pipeline honours
that list, a CSV handed to Mailchimp does not, so an exported unsubscribe gets
silently undone on someone else's server. Addresses compare lowercased on both
sides. Every cell goes through one `sanitizeCell()` (formula-injection
defence). Counting is `exact`, not estimated, because the number decides
between a complete file and an error.

### 3.4 Outreach (email)

14 tables. Mailboxes (`email_accounts`, SMTP/IMAP with encrypted secrets),
campaigns, sequences, enrollments, threads, inbound messages, events,
suppressions, domain and readiness checks.

- Sending is a claim queue with the same at-most-once discipline as extraction:
  claim → send → record. A worker killed mid-send leaves a claimed row that the
  reaper releases; it does not re-send.
- Replies are fetched by `sync_replies`, classified, and a genuine reply stops
  the sequence. An auto-reply does neither.
- Suppression is absolute. Unsubscribe, hard bounce and complaint all write to
  `email_suppressions`, and no amount of acknowledgement overrides it.
- Templates refuse on a missing variable rather than mailing "Hi ,". The
  fallback syntax is `{{first_name|there}}`, surfaced next to the field in the
  editor because otherwise authors learn it one failed run at a time.

**Current state: zero mailboxes connected**, so nothing has been exercised end
to end. The empty states are correct and point at the right next action.

### 3.5 Automations (flows)

4 tables — `flows`, `flow_versions`, `flow_runs`, `flow_step_runs` — and the
most intricate subsystem.

- **17 triggers**, **29 actions**, all of which now have handlers.
- A flow publishes an **immutable version**. Runs in flight keep executing the
  version they pinned at start, so editing a live flow cannot rewrite what a
  half-finished run does next.
- **Loop protection** is checked *before* the run is created — creating it first
  and halting second still lets the first action fire on a fast worker.
- Step execution is **claim → act → record** via `flow_claim_step`. A retry
  after a crash gets `false` from the claim and does not repeat the action. The
  cost is that the step's output is lost, which is the at-most-once trade.
- A `WAIT` step **parks** the run with `resume_at` rather than sleeping a
  worker.
- **Run variables** (migration 0108): `flow_runs.variables`, one JSONB object.
  A step writes a key via its `storeAs` config; later steps and branch
  conditions read it as `vars.<key>`. The namespace is load-bearing — a step
  storing `job_title` must not change what `contact.job_title` means to a
  condition written before it existed. **The engine persists, not the
  handlers**: a handler returns `output.value` and names nothing, so there is
  one implementation of "remember this" and no handler can write under a key
  another step owns.

**Two facts are stamped server-side at publish and are deliberately not editor
fields:**

| Key | Meaning | Why not a UI control |
|---|---|---|
| `actorAuthorized` | may the publisher send mail | a checkbox is self-certification — anyone who can open the builder ticks it |
| `userId` (AI steps) | whose credits are spent | a dropdown lets one member spend a colleague's allowance without their knowledge |

Both stamps **overwrite** whatever the browser supplied, because the JSON editor
is right there.

### 3.6 Reporting

Leaderboards, batch funnels, pipeline totals, per-setter dashboards, and custom
dashboards whose widgets store a `metric_key` — **never a query**. A stored
query would let a dashboard read tables the permission layer never approved and
would break silently on a rename. The key resolves through
`lib/reports/metrics.ts`, where every metric states its own scoping.

---

## 4. How the parts connect

### 4.1 The background tick

`lib/workers/tick.ts` is the single entry point. Six jobs, in a deliberate
order:

1. `reap_email_claims` — first, so rows abandoned by a killed worker are
   claimable again on this same tick
2. `send_email`
3. `sync_replies` — after sending, so a reply to something just sent is not
   fetched before the send is recorded
4. `advance_flows`
5. `deliver_webhooks`
6. `sync_contact_evidence` — last; pure catch-up with no deadline

Every job is isolated: one workspace's broken mailbox cannot stop webhook
delivery for everyone else. Every job is bounded, because a tick runs inside a
request with a platform timeout.

**Triggered by two schedulers.** `vercel.json` has a daily cron — Vercel's Hobby
plan allows one invocation per day, so it is a backstop, not the mechanism. The
real scheduler is `.github/workflows/cron.yml` every 5 minutes. The endpoint
`/api/cron` fails closed: no secret configured means refuse, and the comparison
is `timingSafeEqual` against a header, never a URL parameter.

### 4.2 Trigger dispatch

`dispatchFlowTrigger()` turns a domain event into runs. It never throws into its
caller — a flow that cannot start must not roll back the thing that happened.
Idempotency is per occurrence *and* per flow, so a retried webhook makes one
run and two flows on the same trigger make two.

### 4.3 The evidence bridge

`lib/crm/evidence-bridge.ts` copies `research_evidence` contact values onto CRM
contacts. It reads **contacts first, evidence second**, and that direction is
the tenancy control: `research_evidence` is keyed by `user_id` and its
`entity_id` points at `extracted_leads`, so it names no workspace at all.
Starting from evidence would let an id from another table decide the tenant.

Values are normalised through the CRM's own functions so a discovered address
dedupes against an imported one. Low-confidence and low identity-confidence
rows are skipped and counted, never dropped silently.

---

## 5. Security model

- **5 roles** (`owner > admin > manager > setter > viewer`), a *total*
  hierarchy, so a permission is one minimum role rather than a hand-maintained
  list per permission.
- **6 modules** (`crm`, `email`, `flows`, `reports`, `integrations`, `hubble`),
  each independently entitled by plan and switchable per workspace.
- **45 permissions**, all resolved by one pure function in `lib/auth/decide.ts`.
  `access.ts` only gathers inputs.
- `dataScope(role)` returns `assigned` for setter and viewer — the narrowing is
  applied to the **query**, because RLS grants a member the whole workspace.
- Storage keys are server-generated `{user_id}/{job_id}/{uuid}.html`. A path is
  never derived from a user-supplied filename. Uploads are validated by content
  sniffing, not extension.
- Every state-changing admin action writes an `admin_audit_logs` row in the same
  transaction. Audit logs are append-only. There is no self-service path to
  `admin`.
- Errors use a typed catalogue. Users see friendly copy; logs get detail. Never
  a stack trace, SQL, storage path or internal id to the client.
- Auth deliberately does **not** attribute the sign-in credentials error to a
  field — that would turn the form into an account-enumeration oracle. Sign-up
  errors *are* field-attributed, because naming a field there leaks nothing.

---

## 6. Testing philosophy

This is the part most worth understanding, because it is a direct response to
what kept going wrong.

**2,543 unit tests, 43 integration suites.** But the count is not the point.
The dominant defect class in this codebase is **code that is correct, tested,
and never called** — and unit tests cannot see it, because a test calls the
function directly, which is exactly what production does not do.

So the suite carries a second category: **structural guards** that assert
reachability and wiring. Every worker has a caller; every action in the
catalogue has a registered handler; every colour utility resolves to a real
design token; a `'use server'` file exports only async functions.

**Every guard is verified non-vacuous by breaking the thing it guards** and
confirming it fails. That practice caught several tests that passed while
checking nothing — including two that were reading a *doc comment* rather than
the code, because the comment explained the rule using the exact string being
asserted. Assertions of absence now run on comment-stripped source.

---

## 7. What was broken, and what it teaches

Every item below was found in the live production system, reproduced, and
fixed. They share a shape.

| Defect | Why nothing caught it |
|---|---|
| A dead `export const` in a `'use server'` file killed **every action on the pipeline page** | Fails at module *evaluation*. `tsc`, ESLint and `next build` all pass; the page renders; tests import the function directly, which is what the runtime refuses |
| Every triggered flow **hung at step one** | The claim query selected only `waiting` runs; `startRun` creates `running` ones. Zero `waiting` rows existed database-wide — the query had never returned a row |
| `actorAuthorized` read by the send gate, **written nowhere** | No flow could ever send mail. Gate failed closed and said so politely |
| `userId` read by every AI step, **written nowhere** | Every Hubble step refused with "nobody to bill" |
| 111 research values found; `crm_contact_emails` held **zero** | `attachContactEmails` had one caller, using only addresses that arrived *with* a contact at creation |
| 7 of 29 actions offered in the picker with **no handler** | Publishable, then dead on the first contact |
| 190 Tailwind classes referencing **two tokens that did not exist** | A missing token emits nothing. `bg-surface` left backgrounds transparent; `border-line` fell back to `currentColor` |
| Page 2 of a filtered contact list **was not filtered** | Pagination rebuilt its URL from `q` and `page` alone |
| Timestamps rendered in the **server's** timezone | `toLocaleString()` in a Server Component. Vercel runs UTC |

**The lesson:** correctness at the unit layer was never the problem.
Reachability was. `tsc` green, tests green and a clean build proved almost
nothing about whether a feature ran.

---

## 8. Known gaps

Stated plainly, because a handoff that hides these is worthless.

**Dead or unwired code still present**
- `crm_saved_views` — the table exists with **zero code references**. Named
  views (the Twenty CRM model) are not implemented.
- Several `lib/` modules were built ahead of their callers; the action-coverage
  and worker-wiring guards now prevent *new* instances, but no audit has swept
  the whole repo.

**Not exercised end to end**
- **Outreach.** Zero mailboxes connected, so sending, reply sync, bounce
  handling and suppression have never run against a real provider in this
  workspace. All have unit and integration coverage; none has production proof.
- **Calendar sync** — blocked, no Google/Microsoft OAuth credentials.
- **Microsoft and Dropbox integrations** — declared `planned` in
  `lib/integrations/catalogue.ts` and correctly never offered as connectable.

**Product-shaped gaps**
- Per-field provenance is not surfaced in the CRM UI. The evidence exists and is
  queryable, but the contact detail shows one `Source` string for the whole
  record — weaker than the "a source on every fact" promise.
- Branch conditions read only contact fields and run variables. Company, deal
  and activity facts are not in `gatherFacts`.
- `SEND_EMAIL` body is a plain textarea, not a template editor.
- No dark mode, by decision.

**Schema**
- Migration `0109` re-points the `ON DELETE SET NULL` user references on four
  append-only tables to NO ACTION, finishing what `0091` started — that
  migration fixed `email_events` and wrongly stated `crm_activities` "has been
  right all along". Until 0109 is applied, a user who has performed any CRM
  action cannot be deleted, and the error names the append-only guard rather
  than the foreign key.

**Operational**
- Test-workspace leak is **cleared** (121 removed, 2026-09-04) but the *cause*
  is not: `deleteTestUser` deletes the auth user, which fails on any workspace
  holding CRM activity. The working order is workspace first, user second.
  Until the helper is changed, every integration run leaks again.
- `types/database.ts` was hand-edited to declare `flow_runs.variables`;
  regenerate with the Supabase CLI when convenient.
- 97 ESLint warnings (0 errors), mostly unused-var noise in generated files.
- **Never run `supabase db push` on this project.** Migrations have always been
  applied by hand through the SQL editor, so the remote
  `supabase_migrations.schema_migrations` table does not record them — `db push`
  therefore tries to replay from `0001` against the live database. Attempted
  2026-09-04; it failed at 0080's trigram index (`pg_trgm` not in the session's
  search path) before doing damage, which was luck rather than safety. Apply a
  new migration by pasting the file into the SQL editor.
- Migrations are applied by hand — there is no direct DB URL in the environment.

---

## 9. Conventions a new contributor must know

- **npm**, not pnpm. TypeScript `strict`. Path alias `@/*` → repo root.
- **`proxy.ts`**, not `middleware.ts` — Next 16 renamed it, and the exported
  function must be named `proxy`.
- Server Components by default; `'use client'` only where interactivity needs
  it.
- **All plan limits come from `plans.limits` JSONB at runtime.** Never hardcode.
- Validate every external input with Zod — request bodies, parser output,
  webhooks.
- Rate limiting is **Postgres**, not Redis, and fails **open** by design.
- Design tokens only: no `#hex`, `rgb()` or `hsl()` in a colour position. The
  product is flat and white; the marketing site keeps its claymorphic material,
  and the two are separated by CSS scope (`.product-clay` / `.auth-clay`)
  precisely because the landing page is read-only.
- Every screen ships designed **loading**, **empty** and **error** states.

### Commands

```bash
npm run dev
npm run lint
npm run build
npx tsc --noEmit
npx vitest run tests/unit
```

Integration tests need Supabase credentials in `.env.local` and run against the
live database.

---

## 10. Suggested next steps

In the order I would take them:

1. **Connect a mailbox.** Outreach is the largest untested surface, and nothing
   about it can be trusted until one real send, one real reply and one real
   bounce have happened.
2. **Surface per-field provenance** on the contact detail. The data is already
   there; this is the product's central claim and the UI does not yet make it.
3. **Sweep for more unwired code.** Two guards now exist for specific classes.
   A general audit — every exported function, does anything call it — would
   likely find more.
4. **Saved views.** The table exists; the feature does not.
5. **Clean the test workspaces** out of production.
