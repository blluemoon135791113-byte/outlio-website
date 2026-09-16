# Outlio — Master System Reference

**The single document that records how the whole product works, A to Z.**

Written 2026-09-16 against the working tree at commit `59c9c60`. Every claim here
was read out of the code, not inherited from an older document.

> **⚠️ This supersedes `docs/OUTLIO_FUNCTIONAL_GAP_MATRIX.md` (R0) wherever the two
> disagree.** That matrix was accurate when written and is now substantially stale:
> it still reports "no builder UI" for sequences, "nothing triggers the send worker",
> and "`syncWorkspaceReplies` has zero callers". All three have since been built.
> The verified gap list in [§16](#16-verified-gaps) is the current one.

**Related documents**
- `CLAUDE.md` — persistent rules. Nothing here overrides it.
- `docs/PROGRESS.md` — append-only build log. Read before writing code.
- `docs/SELECTOR_MAP.md` — the parser field contract.
- `docs/SYSTEM_HANDOFF.md` — contributor orientation. This document is the
  feature-and-workflow reference; that one is the "how do I work on it" reference.

---

## Table of contents

1. [What Outlio is](#1-what-outlio-is)
2. [The two halves, and the seam between them](#2-the-two-halves-and-the-seam-between-them)
3. [The sidebar — every screen in the product](#3-the-sidebar--every-screen-in-the-product)
4. [Accounts, access and identity](#4-accounts-access-and-identity)
5. [Workspaces, roles and permissions](#5-workspaces-roles-and-permissions)
6. [Plans, credits and billing](#6-plans-credits-and-billing)
7. [Getting leads in — upload and extension](#7-getting-leads-in--upload-and-extension)
8. [The parser and de-duplication](#8-the-parser-and-de-duplication)
9. [The job queue and the worker](#9-the-job-queue-and-the-worker)
10. [The CRM](#10-the-crm)
11. [Hubble Intelligence](#11-hubble-intelligence)
12. [Outreach — mailboxes, campaigns, sequences, inbox](#12-outreach--mailboxes-campaigns-sequences-inbox)
13. [Automations (Flows)](#13-automations-flows)
14. [The automation spine — how it all connects](#14-the-automation-spine--how-it-all-connects)
15. [Integrations, public API, webhooks, notifications](#15-integrations-public-api-webhooks-notifications)
16. [Verified gaps](#16-verified-gaps)
17. [Security model](#17-security-model)

---

## 1. What Outlio is

Outlio turns **pages a person already opened in LinkedIn Sales Navigator** into a
clean, de-duplicated, exportable lead database — then lets them research those
leads, work them in a CRM, and email them in sequences.

It is a **file processor, not a crawler.** Input arrives by exactly two routes:

1. A **file the user saved** from a results page and uploaded.
2. A **page captured by the browser extension** during a session the user
   explicitly started. The extension observes; the user navigates. Outside an
   active session it reads nothing.

There is no headless browser, no automated navigation, no clicking Next, no
CAPTCHA solving, and no LinkedIn login. Those are hard rules in `CLAUDE.md` and
the code is built around them.

Since 2026-09-03 the product **may** fetch pages from sources beyond a company's
own site to find contact details (owner decision). What did not change: no
CAPTCHA solving and no bot-detection evasion — a commercial line, because Outlio
sells email deliverability and a blocklisted sending domain would break the
product that pays for the research.

**The rule that governs everything downstream:** a value may only be stored if it
was *literally observed* somewhere, with an evidence row naming the provider and
URL as its citation. Synthesising `first.last@company.com` from a name and a
domain is forbidden — it looks right, it is often right, and when it is wrong
nobody can tell.

---

## 2. The two halves, and the seam between them

Outlio is two products sharing one shell, and knowing which half you are in
explains most of its behaviour.

| | **Lead Engine** | **Workspace (CRM / Outreach / Flows)** |
|---|---|---|
| Tenancy key | `user_id` | `workspace_id` |
| Core tables | `extraction_jobs`, `uploaded_files`, `extracted_leads`, `companies`, `research_evidence`, `lead_keys` | `crm_contacts`, `crm_companies`, `crm_opportunities`, `email_*`, `flows` |
| Who can see it | one person | everyone in the workspace, narrowed by role |
| Entry | Upload / extension | Import, or "Send to CRM" |

**42 tables are `user_id`-scoped; 64 are `workspace_id`-scoped.** Scoping to the
wrong one is a silent empty-result bug, not an error. This is the single most
common way to break something here.

**The seam** is crossed in exactly two places, both deliberate:

- **`sendExtractionToCrm`** — an explicit, never-automatic user action that
  copies an extraction's leads into `crm_contacts`.
- **`lib/crm/evidence-bridge.ts`** — carries researched emails and phones from
  `research_evidence` (user-keyed) into `crm_contact_emails` / `crm_contact_phones`
  (workspace-keyed), preserving the citation. See [§10.6](#106-the-evidence-bridge).

Everything reads through `createAdminClient()` (service role, bypasses RLS), so
**tenant scoping is applied in application code on every query.** RLS is the
backstop, not the mechanism.

---

## 3. The sidebar — every screen in the product

The authenticated shell is `app/(product)/layout.tsx` → `ProductShell` →
`components/product/ProductNav.tsx`. Flat `--paper` background, no entrance
animations, no `Reveal.tsx` inside the product.

**Module gating:** CRM, Outreach and Flows sections appear only when the
workspace's plan includes that module. Hiding a link is *not* access control —
every route refuses independently.

### Top-level links (always present)

| Label | Route | What it is |
|---|---|---|
| Overview | `/dashboard` | Usage, credits, account state, live capture, first-run checklist |
| Find leads | `/dashboard/extract/new` | Upload saved pages |
| Lead sources | `/dashboard/jobs` | Extraction history, live progress, exports, trash |
| Hubble Intelligence | `/dashboard/intelligence` | AI research console |

### Pipeline (module: `crm`)

`/crm/my-work` · `/crm/contacts` (People) · `/crm/companies` · `/crm/pipeline`
(Deals) · `/crm/tasks` · `/crm/lists` · `/crm/import` · `/crm/duplicates` ·
`/crm/reports` · `/crm/reports/dashboards`

### Outreach (module: `email`)

`/email` (Mailboxes) · `/email/campaigns` · `/email/inbox` · `/email/analytics`

### Automations (module: `flows`)

`/flows` — all automations, plus `/flows/[id]` for the builder and run history.

### Footer

**Settings** (`/dashboard/settings`), **Access status** (`/dashboard/access`, when
access is not clean), and **User admin** (`/admin`, platform admins only).

A section expands **because you are inside it**, not because you clicked — and a
deliberate collapse survives until you navigate out of the section.

### Settings sub-pages

| Route | Guard | What it changes |
|---|---|---|
| `/dashboard/settings` | signed in | Display name, avatar, per-workspace "away until" |
| `.../email` | signed in | Account email address |
| `.../security` | signed in | Password, TOTP MFA enrolment |
| `.../team` | workspace member | Members, roles, invitations, seats, leave workspace |
| `.../routing` | `crm.contact.assign` to view, `crm.routing.manage` to change | Lead-routing rules, availability, unassigned queue |
| `.../billing` | signed in | Plan, subscription, FastSpring portal |
| `.../integrations` | signed in | Google, GoHighLevel, Clay |
| `.../linkedin` | `crm.contact.view` | LinkedIn senders, daily budgets, owner attestation |
| `.../extension` | signed in | Connected browsers, revoke devices, store links |
| `.../notifications` | `workspace.settings.manage` | Slack / Teams channels and events |
| `.../developers` | `workspace.settings.manage` | API keys, webhooks, delivery log |
| `.../delete` | signed in | Permanent account deletion |

---

## 4. Accounts, access and identity

### Sign-up → access

Auth screens live in `app/(auth)/`: sign-in, sign-up, MFA, forgot-password,
reset-password, verify-email. `app/auth/callback/route.ts` exchanges the Supabase
one-time code; the `next` parameter is constrained by `safeRedirectPath`, so there
is no open redirect.

**Access is decided by a pure function**, `lib/auth/decide.ts`. `lib/auth/access.ts`
only gathers the inputs. Nothing else in the product decides access.

`AccessReason` — the complete set:

`ok` · `unauthenticated` · `email_unverified` · `no_request` · `pending` ·
`rejected` · `expired` · `suspended` · `limit_reached` · `payment_required`

**Precedence** (order matters, and it is deliberate):

1. Deleted or absent profile → `unauthenticated`
2. **Suspension outranks everything, including admin**
3. Email verification
4. Role (`SCRAPER_ROLES` = `approved_user`, `subscriber`, `admin`)
5. `access_expires_at`
6. Admins bypass plan limits; everyone else is checked against
   `extractions_per_day`, `extractions_per_month`, `records_per_month`

`/dashboard/access` renders one titled state per reason — *Under review*, *Not
approved*, *Access expired*, *Account suspended*, *Plan limit reached*, *No active
plan*, *Email not verified*, *Request access*. Self-service options are hidden for
`suspended`, `rejected` and `email_unverified`. It uses `requireUser()` rather
than `requireAccess()`, to avoid a redirect loop.

**There is no self-service path to `admin`.**

### The edge guard

`proxy.ts` — Next 16 renamed `middleware`, and the exported function must be
called `proxy`. It is explicitly **not** an authorization boundary. It refreshes
the session and redirects `/dashboard`, `/admin`, `/join`, `/crm`, `/email`,
`/flows` to `/sign-in?next=…`.

Two cookies:
- `outlio_trial_device` — HMAC-signed, pseudonymous, 400 days, issued at sign-up.
- `outlio_session_guard` — idle 30 days, absolute 90 days. On expiry every `sb-*`
  cookie is deleted and the user lands on `/sign-in?reason=session_expired`.

### MFA and the admin gate

TOTP step-up to AAL2. `/admin` requires **admin role + enrolled TOTP + an AAL2
session** — anything less redirects to enrolment, not to a 403.

### Invitations

`app/join/[token]` is **read-only**. `describeInvitation` returns `null` for
malformed, unknown, revoked, accepted and expired tokens alike — so a token
cannot be probed for which kind of invalid it is.

Tokens are 32 CSPRNG bytes base64url; only the SHA-256 is stored. TTL 7 days.
Acceptance is a server action calling `redeem_workspace_invitation`, which returns
`ok | already_member | wrong_email | seat_limit`.

---

## 5. Workspaces, roles and permissions

`lib/workspaces/permissions.ts` is the policy table — pure, and exhaustively unit
tested.

### Roles

`owner` (4) > `admin` (3) > `manager` (2) > `setter` (1) > `viewer` (0)

### Modules

`crm` · `email` · `flows` · `reports` · `integrations` · `hubble` · `linkedin`

### How a decision is made

A permission is a **single `minRole` plus a `module`**. `decidePermission` returns
`{allowed: true}` or a denial reason: `not_a_member`, `role_insufficient`,
`module_unavailable`.

**Module availability is checked before role**, so a plan gap never presents as a
role problem — an owner of a workspace without CRM gets `module_unavailable`, not
"you need a higher role".

### Notable minimums

| Permission group | Minimum |
|---|---|
| `workspace.billing.manage`, `.delete`, `.transfer_ownership` | **owner only** |
| `workspace.settings.manage`, `member.manage`, `crm.pipeline.manage`, `crm.routing.manage`, `email.account.manage`, `integration.manage` | **admin** |
| `crm.export`, `crm.import`, `crm.duplicate.resolve`, `email.template.manage`, `email.campaign.launch`, `email.inbox.view.all`, `report.team.view`, `flow.view` / `flow.manage` | **manager** |
| `crm.contact.create` / `.edit`, `crm.task.manage`, `crm.list.manage`, `report.own.view` | **setter** |
| `crm.contact.view`, `crm.company.view`, `crm.opportunity.view`, `crm.task.view`, `email.campaign.view` | **viewer** |

### Data scope

`dataScope(role)` returns `all` for manager and above, `assigned` for setter and
viewer, `none` otherwise. It **decides** the rule; the caller applies it to the
query. There is no way for a policy layer to enforce a WHERE clause, so every CRM
surface applies it explicitly: contacts list and detail, companies list and
detail, the pipeline board and `moveCardAction`, tasks, the reports forecast,
dashboard widgets, and the contact-export, subject-export and quick-search routes.

### Seats and ownership

- Seats count **members plus outstanding invitations**.
- A trigger enforces "at least one owner" — leaving as the last owner surfaces as
  *"Promote another owner before you leave"*.
- `canManageRole` is strictly-below, and **`owner` is never assignable** through
  the UI.
- Removing a member **reassigns their records first**, then deletes the
  membership, then announces the handover.
- An invite link is returned **once** and never stored.

### Server actions are public endpoints

Every exported server action must gate (`assertWorkspacePermission` /
`assertAdmin` / `assertAccess`) **and** be called from somewhere outside its own
file. This repo has repeatedly shipped correctly-gated actions with zero callers —
which is a feature that does not exist, wearing a working implementation.

---

## 6. Plans, credits and billing

### Plans

`PlanKey` = `trial | starter | professional | agency | custom`.
Customer-facing names: **Lead Engine** (`starter`), **Pro** (`professional`),
**Pro + Hubble** (`custom`). `agency` is deactivated.

**Every limit comes from `plans.limits` JSONB at runtime. Never hardcode one.**
Validated by `planLimitsSchema`. `null` means unlimited.

Fields: `credits_per_month`, `files_per_extraction`, `leads_per_credit`,
`extractions_per_day`, `extractions_per_month`, `records_per_extraction`,
`records_per_month`, `storage_bytes`, `exports_per_month`, `retention_days`,
`contact_enrichments_per_month`, and the module switches `crm_enabled`,
`email_enabled`, `flows_enabled`, `reports_enabled`, `integrations_enabled`,
`hubble_enabled`, `linkedin_enabled`, `linkedin_senders_max`,
`workspace_member_limit`.

Seeded allowances: trial **10** credits/month with 3-day retention; starter
**100** / 30d; pro **300** / 90d; custom **1000** / 365d.

`getPlanById` throws on a malformed blob, but `listActivePlans` **skips and logs**
instead — one bad plan row would otherwise have taken down `/admin` and
`/dashboard/access` together.

### Credits

- Extraction cost = `ceil(leads / leads_per_credit)`, minimum 1, aggregated per
  run. `leads_per_credit` is 25 on all active plans.
- **Charged on leads parsed, not leads kept.**
- **Exports are free.** They used to cost a credit, which cut the advertised
  monthly ceiling by a third.
- Hubble AI steps spend **before** the model runs, and refund on failure.

`hubble_spend_credits` exists because the older `consume_credit` returned `-1` for
*both* unlimited and exhausted — indistinguishable. The replacement returns an
enum: `spent | unlimited | exhausted`. An over-allowance spend is rolled back in
full, so a refused caller is charged nothing.

### Billing — FastSpring

Webhook at `app/api/webhooks/fastspring/route.ts`. `X-FS-Signature` is HMAC-SHA256
over the **raw body**, compared with `timingSafeEqual`. Each event claims its
`event_id` first, so redelivery is idempotent; a failure returns 500 so FastSpring
retries the batch.

**Access rule:** `active && state in (active, trial, canceled)`. So **a
cancellation keeps access until the paid period ends** — only `deactivated` or
`overdue` removes it.

A `trial` subscription always maps to the internal `trial` plan (10 credits), not
the purchased tier. Period credits top the user up to exactly
`plans.limits.credits_per_month`, unique-indexed on the event id so a retry cannot
double-allocate.

FastSpring customers get a **Manage billing** button that mints a short-lived
account-portal URL per click. Non-FastSpring accounts get in-app cancel/resume.

**Refunds have no webhook handling** — the policy is documented in
`app/refund-policy/` and the terms pages only.

### Referrals

20 credits per referral, `ref` query parameter, 8-character code from a
look-alike-free alphabet. **Payout happens at approval, not at signup**, and it
runs *outside* the grant transaction so a failed payout never rolls back someone's
access. Idempotent, retried on the next grant.

---

## 7. Getting leads in — upload and extension

### 7.1 Route A — uploading saved pages

**Screen:** `/dashboard/extract/new` — "Find leads", subtitle "Upload the pages
you saved." Left panel is the uploader; right aside is a three-step guide. Footer
states the price: *1 credit per run, covering N leads. CSV downloads are free.*

The form accepts `.html` / `.htm`, de-duplicates identical name+size client-side,
truncates to the plan's file cap, and requires a **consent checkbox** before the
submit button enables. Duplicate handling is chosen up front:

| Mode | Behaviour |
|---|---|
| `remove_exact` (default) | Only exact strategies can mark a duplicate |
| `remove_likely` | Every strategy counts |
| `review` | Duplicates are flagged and **kept** |
| `keep_all` | No comparison at all |

**Upload does not go through a server action body.** Next caps those at 1 MB and
Vercel at ~4.5 MB, truncating silently into a zero-byte blob. Instead:

1. `createUploadSessionAction` creates the `extraction_jobs` row and one
   `uploaded_files` row per file, and returns a **signed upload URL** per file.
2. The browser PUTs the bytes **sequentially** — parallel 100-file batches hit
   storage rate limits.
3. `finalizeUploadAction` deletes rows for failed uploads and calls
   `finalize_upload_job`.
4. `after()` fires `claimAndProcessJob`, up to 2 attempts.

**Limits:** 10 MB per file (matching the bucket limit), 100 files per job by
default, both further narrowed by the plan — `resolveUploadLimits` always takes
the **stricter** of plan and service.

**Storage keys are server-generated:** `{user_id}/{job_id}/{uuid}.html`, every
component validated as a UUID first. **A path is never derived from a
user-supplied filename.**

### 7.2 Content sniffing

`lib/upload/sniff.ts` is pure and reads the first **4096 bytes**. Validation is by
content, never by extension or declared MIME — those are hints only.

- Empty or whitespace-only → `ERR_FILE_EMPTY`
- **20 binary signatures** rejected as `ERR_FILE_TYPE`: ZIP/OOXML, PDF, ELF,
  DOS/PE, PNG, GIF, JPEG, GZIP, BZIP2, XZ, 7-Zip, RAR, Mach-O 32/64, Java class,
  legacy MS Office, SQLite, WASM
- BOM and interleaved-NUL detection for UTF-16LE/BE; a NUL in UTF-8 text →
  `ERR_FILE_TYPE`
- No `<!doctype html` / `<html` / `<body` / `<head` marker → `ERR_FILE_FORMAT`

### 7.3 Route B — the browser extension

**"Outlio Lead Capture"**, Manifest v3. Permissions are `storage` and `activeTab`
**only**; host permissions are `linkedin.com/sales/*` and the connect page.

**Pairing** (the code never touches a URL):

1. Popup generates a random `state`, opens `/extension/connect?state=…`.
2. The page renders the pairing code into the DOM as `data-outlio-pairing-code`.
3. The content script reads it, **removes both attributes before the network
   call**, and hands it to the background worker, which verifies the state matches.
4. `POST /api/extension/pair` consumes the row **inside a conditional UPDATE**, so
   two racing requests cannot both win.

**Tokens:**

| Token | Form | TTL |
|---|---|---|
| Access | stateless, HMAC-signed, `payload.signature` | **15 minutes** |
| Refresh | opaque 32 random bytes, stored only as a keyed hash | **30 days** |
| Pairing code | 24 random bytes | **60 seconds** |

Refresh **rotates on every use** and detects reuse: a presented token whose hash
no longer matches means a copy is in circulation → the device is revoked and the
call returns 401.

**Authorisation** (`resolveExtensionAuth`) is the only way an extension request
becomes authorised. Seven checks in cost order, everything re-derived from the
token and nothing trusted from the body:

1. Signature + expiry (no I/O)
2. Device row exists, scoped to the token's subject
3. Enabled and not revoked
4. Stored JTI matches — this is what kills in-flight tokens on revocation
5. Account access (active, verified, in date, entitled)
6. `profiles.extension_enabled` — the admin kill-switch, read **before** the
   entitlement branch so it always wins
7. Subscription check, **failing closed** on error

**A valid signature is not authorisation.** That sentence is in the code.

**Capture:** `POST /api/extension/capture`, 4 MB cap, rate-limited **per device,
not per IP** — a whole office behind one address must not lock each other out. The
server recomputes the SHA-256 and rejects a mismatch, which catches truncated
transfers that would silently under-report leads.

A **duplicate is a success**: HTTP 200, no job, no credit, no parse. The unique
index is `(user_id, content_hash)` — scoped to the user, not the session — so
re-capturing the same page in a new session is still free.

**What the content script does and does not do.** It never clicks, pages, or opens
a profile. Sales Navigator is an SPA, so it patches `pushState`/`replaceState`,
listens to `popstate`, and runs a MutationObserver with `attributes: false`
(Ember rewrites attributes constantly), debounced 800 ms. It reports only when the
**row signature** changes, so a re-render is not captured twice. Outside an active
session, page and company events are ignored entirely.

`revealCompanyDetails()` hovers company names already on screen to read LinkedIn's
own hover card, then writes the result back onto the element as
`data-outlio-company-*` so the **server** parser reads it from the saved markup.
It is **on by default** — as opt-in, `company_website_url` was NULL on 400 of 400
real leads. Hover-card fields are matched **by shape, not position**: headcount
carries "employees", a location carries a comma, industry is what remains.

The sanitiser drops `SCRIPT`, `STYLE`, `NOSCRIPT`, `SVG`, `IMG`, `CANVAS`,
`IFRAME` and strips `id`, `style`, `on*`, `aria-*`. **Class names are kept**,
because the backend anchors rows on `li.artdeco-list__item`. Dropping `id` is what
makes the content hash stable — Ember ids change every render, so hashing raw HTML
would break duplicate detection and bill users twice for one page.

---

## 8. The parser and de-duplication

**Source of truth is `docs/SELECTOR_MAP.md` §3 — never the recovered Python.**
`recovered/scraper_gui_recovered.py` is frozen evidence and must never be imported
at runtime. Its selectors are dead.

The parser is `lib/leads/parse.ts` — pure, cheerio, no network.

> Note: `lib/linkedin/` is **not** the parser. That is LinkedIn *outreach* —
> senders, templates, enrollment, budgets.

### The two traps

1. **`div[data-anonymize="job-title"]` is NOT the job title.** It holds tenure
   text. It is the one old-scraper selector that still matches, so trusting it
   fills every lead's title with `"8 years 7 months in role8 years 7 months in
   company"`. Real titles come from `span[data-anonymize="title"]` on the card
   layout.
2. **Anchor only on `data-anonymize`.** Ember ids and CSS-module hashes change
   every LinkedIn deploy.

### Fields

Name, member URN, Sales Navigator URL, public LinkedIn URL, job title, tenure,
company name / URL / public URL / website / industry / size / headquarters,
location, person blurb, connection degree, reachability, list count, last
activity, added-to-list date, source list, source row index.

Two honesty details worth knowing:
- **`isReachable` is `true` or `null`, never `false`** — absent is not the same as
  negative.
- **Company name has a fallback** to the longest bare text node in the lockup
  subtitle. Without it, roughly 20% of leads lose their company.

### Zero leads is a loud error

Two distinct failures, and they mean different things:

| Condition | Code |
|---|---|
| No rows matched any supported layout | `ERR_FILE_FORMAT` |
| Rows matched but none yielded a lead | `ERR_NO_LEADS` |

Rows with neither a name nor a member URN are counted as `skippedRows`, **not
invented**.

> ⚠️ A user-visible `ERR_FILE_FORMAT` on a *file* row can mean four different
> underlying causes — the worker collapses sniff-level `ERR_FILE_EMPTY` and
> `ERR_FILE_TYPE` into it, and the catch-all defaults to it too.

### Page routing

`detectSavedPageType(html)` returns `lead_search`, `account_list`, or `unknown`.
Account anchors are tested **first**, because an Account Hub page can also carry a
person name. `unknown` is a real answer — the module refuses to guess.

**Mixed uploads are refused:** lead pages and account lists in one batch fail the
job with *"Upload each kind separately."*

### De-duplication

Every key is a **keyed hash** — `sha256(material).slice(0,32)` behind a prefix.
This matters because keys outlive the lead rows in `lead_keys`: a readable
name+employer would survive a deletion the user was told was complete.

Strategy priority, first that yields wins, recorded on the row:

1. `linkedin_url_canonical` — member URN
2. `salesnav_id`
3. `name_title_company`
4. `name_company`
5. `row_hash` — name, title, company, location, blurb, both tenures

**Cross-job dedupe:** `lead_keys` is loaded for the user, so a lead seen in a
previous run is a duplicate in this one. `purge_job_leads` copies keys forward
before deleting lead rows, so deletion does not resurrect old duplicates — at
about 8% of the storage.

---

## 9. The job queue and the worker

### The queue

`job_queue` has **RLS enabled with no policies** — service role only.

Claiming uses `FOR UPDATE SKIP LOCKED`, in two flavours:
- `claim_next_job` — untargeted drain.
- `claim_job(job_id, user_id, claimed_by)` — the **targeted** claim used by
  `after()`, so a fresh upload starts *its own* job rather than an unrelated
  older one.

**Retry and backoff.** On a throw, if `attempts >= max_attempts` (default 3) the
job fails; otherwise it goes back to `pending` with the error recorded.

**Two reapers**, both fired on `/dashboard/jobs` page load:
- `reap_stale_jobs(900)` — claims older than 15 minutes. Exponential backoff
  `2^min(attempts,6)` minutes, capped at 64.
- `reap_orphaned_uploads(10)` — jobs stuck in `uploaded` with **no queue row at
  all**, i.e. the browser died between session-create and finalize.

### The worker

`lib/worker/process-job.ts`. **Extraction never runs inside a request handler's
response path** — the point of the queue is that jobs survive the browser closing.

Per-file concurrency is 8 (hard maximum). **Failure is isolated per file**: a
throw marks that file failed with a truncated message and the batch continues.

**Charging happens before any lead row is inserted and before the CSV is
written.** `charge_extraction_leads` is idempotent via `credits_charged`. If the
run cannot be afforded it fails with `ERR_LIMIT_REACHED` and delivers **no export
at all**, rather than a silently truncated list.

Leads are deleted-then-inserted per job (so a retry is idempotent), chunked 500 at
a time. Then the CSV is written to the separate `exports` bucket.

Final status: `failed` if no file processed, `partially_completed` if any file
failed, else `completed`.

### What the user sees — `/dashboard/jobs`

Titled "Lead sources", headed **"Extraction workspace"**. Force-dynamic, because
job state changes in the background and must never come from a route cache.

- **Connection badge** — Realtime subscription, debounced 180 ms, plus polling at
  **2.5 s while a job is active and 15 s otherwise**, plus a refresh on tab focus.
  A refresh failure shows *"Live data paused. We will keep retrying
  automatically."* and flips the badge to "Auto-updating".
- **Active run panel** — live `progress_step`, a percentage, and a four-step rail
  `Queue → Process → Clean → Export`. Progress reserves the final 18% for cleanup
  and export, so the bar does not sit at 100% while work continues.
- **Six metric cards** — Credits remaining, Completed extractions, Files
  processed, Leads extracted, Companies added, Duplicates removed.
  **`null` renders `—`, not `0`** — "unknown" and "none left" are different facts.
- **Two separate boards** — Leads and Accounts, each with its own filter chips, so
  narrowing one cannot silently empty the other.
- **Trash** — restorable. Deleting for good also erases the lead data, behind a
  two-step confirm. The CSV export survives a purge.

**Labels never guess.** `jobSource` reads `capture_session_id` and returns
"Extension list" or "HTML file" — never the saved filename, because LinkedIn names
every file `"Tech Leads 3 _ Lead Lists _ Sales Navigator"`.

### Overview — `/dashboard`

"What your outreach did, and what it used." Five usage cards (credits, lead
searches today and this month, records, exports), each with a limit bar and the
same `—` honesty rule.

The **first-run checklist renders above** the performance row while there is no
real activity — a first-day row of zeroes is a worse first screen than a to-do
list — and moves below it once there are real figures. It disappears when every
step is done.

`getWorkspaceContext()` **fails soft** here: a Lead Engine account with no
workspace must not take the dashboard down.

---

## 10. The CRM

Every CRM table is `workspace_id`-scoped, and almost all carry
`unique (id, workspace_id)` so child rows use **composite foreign keys that make a
cross-tenant link unrepresentable**.

### 10.1 My Work — `/crm/my-work`

The setter's home screen: what is assigned to you, what is overdue, what is next.

### 10.2 People — `/crm/contacts`

The main list. Filtering is **URL-as-state**, not client state, so a filtered list
is bookmarkable, shareable and back-button-reachable. `contactsHref` is the single
place a contacts URL is assembled — a fix for pagination silently dropping
filters.

Bulk actions include assignment and **enrolling contacts into an email campaign**
(`enrolContacts`), which is the audience picker for outreach.

**Saved views** are **private only** by decision. `is_shared` exists in the schema
and is always written `false`; every read filters on `owner_user_id` as well as
`workspace_id` — otherwise a colleague could delete your view by id, a cross-user
write inside a correctly-scoped tenant that a tenant-isolation test would not
catch.

Stored view JSON is parsed through a Zod schema where every field is optional and
`.catch(undefined)`, so one corrupt key drops that key rather than the whole view,
and unparseable JSON opens the unfiltered list rather than an error page.

**Quick search** (`/api/crm/quick-search`, the command palette) reuses
`listContacts` rather than querying itself — that function already resolves the
email match against the child table and already strips `%_,()` before building the
filter, so a hand-rolled search would be a second place to get escaping wrong on a
user-typed string. Minimum 2 characters, 6 results, `no-store`.

### 10.3 Contact detail — `/crm/contacts/[id]`

Facts with **provenance rendered as citations**, emails and phones, activity
timeline, notes, tasks, deals, and a subject-access export for Article 15
requests.

A setter who types a URL for a contact they do not own gets `notFound()` — and
`generateMetadata` refuses too, so the contact's name never leaks into the page
`<title>`.

### 10.4 Companies, Deals, Tasks, Lists

- **Companies** (`/crm/companies`) — read-only screens, no server actions. The
  list deliberately runs **no count query**; "next page" is inferred from a full
  page.
- **Deals** (`/crm/pipeline`) — a Kanban board. Dragging a card carries an
  `expectedVersion`; a lost race returns `stale: true` and the card springs back.
  Setters may only move deals they own. Pipelines are **archived, never deleted**.
- **Tasks** (`/crm/tasks`) — seven views: open, today, overdue, upcoming, mine,
  team, completed. "Team" is hidden entirely from anyone without
  `crm.contact.assign`. Today and upcoming deliberately exclude undated tasks.
- **Lists** (`/crm/lists`) — read-only grid. Lists are created implicitly during
  an import or from the contacts screen. **A list is an association, never a
  copy.**

### 10.5 Import — `/crm/import`

Gated on `crm.import` (manager+) with a bespoke refusal: *"Importing writes to
everyone's CRM."*

Two steps — **preview, then commit** — plus undo.

The CSV reader is hand-written RFC 4180: quoted fields with embedded commas and
newlines, doubled-quote escapes, CRLF or LF, and a **stripped UTF-8 BOM** (without
it the first header becomes `﻿email` and matches nothing). The delimiter is
**detected** among `, ; \t |`, because European Excel exports semicolons.

Twelve mappable fields. `suggestMapping` matches header aliases after lowercasing
and stripping non-alphanumerics, so "E-Mail Address" resolves. It is explicitly
**a suggestion, never a decision** — the user confirms, because auto-reading
"Owner" as a contact name imports the salesperson as the lead.

**Partial failure is the normal case** — 9 bad rows in 5,000 import 4,991 people:

- The **file** is refused only if no column maps to an identity field at all —
  then the mapping is wrong, not the data.
- A **row** fails on an unparseable email, or on having no name, email *and*
  LinkedIn URL.
- **A bad phone never fails a row.** Three-way: ambiguous-no-country is kept raw
  with a null E.164; genuinely invalid ("call reception", "n/a") is dropped; valid
  is kept.
- Errors are capped at 100 in the report, but the failure **count** is always
  honest, and `errorsTruncated` says when the list is short.
- Line numbers count the header as line 1 — what the user sees in a spreadsheet.

Imports record a `content_hash` of the file, so *"you already imported this"* is
answerable even under a different filename. Routing failure is reported but never
fails the import.

### 10.6 The evidence bridge

`lib/crm/evidence-bridge.ts` — the one place researched contact details become CRM
fields, and where anti-fabrication is enforced for them.

**Why it exists:** research had found 111 `work_email` / `mobile_phone` rows in
production and `crm_contact_emails` held **zero**. Nothing carried them across.

**Direction matters for tenant safety.** It reads `crm_contacts` **first**, scoped
by `workspace_id`, then queries `research_evidence` by those lead ids. Reading
evidence first would mean trusting a foreign id to name the tenant.

Six guards:

1. **`literalValue`** — pulls the literal string only. No merging of partials, no
   `first.last@domain` pattern-guessing, no LLM gap-filling.
2. **Confidence floor 0.7**, plus a hard reject of `source_confidence === 'low'`.
   *A confidently wrong address is worse than a blank field.*
3. **Identity trust is a separate axis from confidence** — this catches the one
   failure mode every other check survives: a perfectly valid address attached to
   the wrong human.
4. **Normalisation through the same functions the rest of the CRM uses** — and
   phone normalisation runs with **no default country**, so a national-format
   number keeps its raw form with a null E.164 rather than having a region
   guessed.
5. **The evidence row's own id travels with the value** into
   `crm_contact_emails.evidence_id`. The value and its citation leave
   `research_evidence` together, so nothing has to re-match them across the
   `user_id` / `workspace_id` seam.
6. **Every rejection is counted** into `skipped.{lowConfidence, unusable,
   notLinked}` — reported, never silent.

Counts come from the **return value** of the attach call, not the offered count —
attaching is idempotent, and the offered count would report the same "+12 emails"
forever while the tables did not grow.

### 10.7 Duplicates — `/crm/duplicates`

Four tabs: exact, possible, resolved, ignored. Each row shows both names, a score,
a confidence, a plain-English summary and the individual signals.

Candidate pairs are built only from three blocking keys — shared company, shared
phone, shared email domain (and `normalizeDomain` returns null for mailbox
providers, so a shared `gmail.com` never becomes a block). The module argues this
is **complete rather than heuristic**: a name alone scores 55 against a threshold
of 60, so every real candidate needs a corroborating signal, and those are the
only three that exist.

Scoring: identical LinkedIn or identical email → 100 (`exact`). Otherwise name
(35–55), company (25), phone (20), email domain (10), **capped at 99** — a
judgement never claims certainty.

Re-scanning never overwrites a decision: any pair whose status is not `open` is
excluded before the upsert. Merging is a Postgres function that locks both rows in
deterministic order, moves every child table with its own collision rule, and
writes a merge event. `resolveContactId` follows `merged_into_id` forward (bounded
at 10 hops) so a bookmark or webhook id is never a dead end.

> ⚠️ **`scanWorkspaceForDuplicates` has no production caller.** There is no tick
> entry and no SQL trigger. The Duplicate Center is fully built but shows nothing
> until something runs the scan. See [§16](#16-verified-gaps).

### 10.8 Reports and dashboards

`/crm/reports` — a range picker over: your activity (with deltas against the
immediately-preceding non-overlapping window), your pipeline, forecast by close
month (value × probability, with an explicit **"not forecast"** bucket for deals
with no expected close date), and manager-only workspace totals, a leaderboard,
win rates (open deals excluded) and lead-batch funnels.

Reply rate renders `—` when there is nothing to divide, **never 0%**.

`/crm/reports/dashboards` — configurable widgets over a ten-metric catalogue. Two
enforcement points worth knowing: adding a widget checks the metric's **own**
permission in addition to the dashboard permission, and the renderer
**re-checks at render time** — a widget you may not see renders *"Not visible to
you"* rather than vanishing. Widgets compute with the **viewer's** scope.

> Naming oddity: dashboard editing is gated on **`crm.export`**, not a reports
> permission.

### 10.9 Export and the formula-injection defence

**`sanitizeCell()` in `lib/export/sanitize.ts` is the one implementation.** Both
the CSV and XLSX writers call it; reimplementing or inlining it is forbidden.

The threat is real and specific: lead data is attacker-controlled — anyone can set
their own LinkedIn headline — and `=cmd|'/c calc'!A1` becomes executable in Excel
and LibreOffice.

`sanitizeCell` strips control characters, then **prefixes an apostrophe** to
anything starting `= + - @ TAB CR`. Tab and CR are in that set because Excel
strips leading whitespace *before* evaluating.

It **prefixes rather than strips**, because real company names begin with `+` and
`-` and stripping would silently corrupt data.

This is the exact inverse of the original scraper, which deliberately wrote
`=HYPERLINK(...)`. Links are now re-created with the writer's own link API and
**cells never contain formula text**. Name and URL stay in **separate columns** —
never fused.

Two shaping rules in `toCsv`: empty cells become `N/A` (an empty cell reads as "no
job title" as easily as "we could not find one"), where `0` and `false` are values
and not absences; and a column empty on every row is dropped unless pinned.

The **marketing** export is different on purpose: `emptyValue` is `''`, because
"N/A" would be merged literally into *"Hi N/A"*. It puts Email first (Mailchimp
and Brevo map column 1 by default) and drops anyone suppressed or stopped,
**failing closed including `unknown`**.

Caps: 5,000 rows, exceeding it returns HTTP 413 rather than a truncated file.

The **subject-access export deliberately does not sanitise** — JSON has no formula
reading, and pre-escaping would corrupt data the subject is entitled to verbatim.

---

## 11. Hubble Intelligence

Gated by `requireHubbleAccess()` — an active Pro + Hubble subscription, or platform
admin. Anyone else is redirected to `/pricing?upgrade=hubble`.

### The user's workflow

On `/dashboard/intelligence`, the user types a **free-text question** — "Recent
Series A", "Who uses HubSpot?", "SaaS hiring SDRs" — optionally narrowed by date
range or extraction batch. Results come back as a table whose **columns are
exactly the plan's required fields**, plus a written summary, plus two actions:
download CSV, or **merge into the leads**.

The count of **unlinked companies** is stated on screen, because the unfiltered
scope researches companies no lead points at — "a widened blast radius the user
cannot see is a spend they did not agree to."

`/dashboard/intelligence/profiles` holds ICP definitions. Scoring is deterministic
and on **business attributes only** — the database rejects personal
characteristics outright.

`/api/hubble/ask` is the per-lead micro path, streamed back as NDJSON with **real
phases**, not a timer: `cache → planning → searching → reading → thinking`.

### Query → run → results

1. Entitlement, then rate limit (20 per 10 minutes).
2. `estimateScope` — with `estimateOnly`, it returns the counts and **nothing is
   planned or spent**.
3. **Planning** produces a DAG: entity scope, required fields (a closed enum),
   output fields (presentational only — they *never widen what is researched*),
   filters, and any clarification questions.
4. The run is created, enqueued, and processed in the background. The browser
   polls.

**The planner refuses before the model sees the question** when it matches a
25-term protected-characteristic list (race, ethnicity, religion, sexual
orientation, disability, pregnancy, political affiliation, trade union, caste…).
The model is never shown lead records, and a rejected plan reports **codes and
paths only, never the offending value** — because a rejected plan reaches logs and
a query string can carry lead names.

**Clarification is the honest path.** A plan needing clarification is **stored but
not enqueued**: while a question is open, nothing is researched and nothing is
charged. The UI says exactly that — *"One detail first — nothing has been queued
or charged yet."* Both halves of the exchange are appended to the run, which is
the difference between a reproducible result and one nobody can explain later.

**Cost model of a run:** resolve scope → collapse leads to **distinct companies**
(company facts are researched once per company, not once per employee) → check the
evidence cache → bounded web research → provider research **for gaps only** →
write evidence → derive free trend facts → qualify.

A run is `completed` only when nothing was left unanswered; otherwise
`partially_complete` — "an honest status a user can act on, rather than a green
tick over a table full of blanks."

### Evidence and provenance

`research_evidence` is **cache and provenance in the same table**.

- **Insert-only.** A newer observation sits alongside the old, so disagreement
  stays inspectable.
- `sourceUrl` is refined to **http/https only** — Zod's `.url()` accepts
  `javascript:alert(1)`, which would make a hostile provider response into stored
  XSS.
- Confidence has a **ceiling of 0.97** — certainty is not available from web
  research, and a cell reading 100% invites a trust the method cannot support.
- **Independence is counted by provider, not by record** — the same provider on
  two URLs is one source agreeing with itself.
- **Stale records can never win** a conflict; that would make TTLs meaningless.
- TTLs live in exactly one table, typed so that **a new field cannot be added
  without a TTL decision — the omission is a compile error.**

**Where fabrication is blocked:**

- A `first.last@domain` address assembled from a name is *"a fabrication with a
  plausible shape"*. Only a literal address found on the page is returned.
- **The model's prose is never parsed into facts.** Only literal contacts inside
  the cited passages are converted. A model repeating a plausible address cannot
  turn it into a saved fact.
- `estimated` **must reach the user as estimated**.
- A credit refusal returns the refusal's own message — claiming "Hubble found
  relevant sources" when nothing was read would be the exact fabrication rule 4
  forbids, rendered as customer-facing copy.
- Cross-table citations are **nullable**, because most rows genuinely have none
  and *"a plausible citation is worse than an absent one, because nobody can
  tell."*

**Prompt injection:** every fetched page is hostile input. Three defences, and the
code names which one actually holds — *"Defence 2 is the one that actually holds.
Never give this call tools."* The answerer has no tools, evidence is fenced and
numbered, output is schema-validated, and any one page is capped at 3 passages so
a single verbose site cannot fill the evidence set and make corroboration
impossible.

### Merging into leads

**Only `known` cells merge.** An `unknown` written as an empty column *"would turn
we don't know into they don't have one the moment it reached a CRM."* Unknowns are
counted and surfaced — *"42 leads updated, 18 values not found"* is the honest
report.

Company facts **fan out to every lead at that company**, deliberately. A lead whose
every cell came back unknown is left untouched rather than stamped with an empty
object that would read as "enriched".

Ownership is re-checked in SQL as well as TypeScript, because the service role
bypasses RLS and *"one check in TypeScript is not a boundary."*

Provenance travels with every merged value. The enrichment column is explicitly
*"a cache of a decision, not a source of truth"* — `research_evidence` remains the
record.

### SSRF protection

`lib/hubble/net/guard.ts` — **deny by default**. The header names the exact
threat: a poisoned search result pointing at `http://169.254.169.254/`.

Refused: non-http(s) schemes, URLs carrying credentials (a redirect-laundering
trick), `localhost` and cloud-metadata hostnames, bare hostnames and `.local` /
`.internal` / `.lan`, every private and link-local IP range, CGNAT, multicast, and
any port but 80/443. IPv4-mapped IPv6 is **unwrapped and re-checked** rather than
trusted, and a non-IP string returns "private" — fail closed.

**The DNS step is not optional.** Screening the URL alone is defeated by an
attacker-controlled hostname resolving to 127.0.0.1, so every resolved address
must be public — not merely the first.

The fetcher adds:
- **`linkedin.com`, `licdn.com`, `lnkd.in` are never fetched** (hard rule 1).
  *"Not a network decision — a product one."*
- **`redirect: 'manual'`** — the runtime would otherwise follow redirects and skip
  the guard entirely. One hop only, re-screened.
- 12-second timeout, 3 MB cap enforced **while streaming** (content-length is *"a
  claim by the server, not a fact"*).
- **Every failure is a value, never a throw** — one unreachable page must lower an
  answer's confidence, not turn the user's question into a 500.

### Credits and metering

`lib/capabilities/registry.ts` is one closed set. Entries are **deprecated, never
deleted** — a published flow pins the ids it compiled against.

The header records *why the registry exists*: convention failed. Metering was
correct, but *being* metered depended on a caller remembering to import it, and
three HTTP routes did not.

| Capability | Credits |
|---|---|
| `hubble.icp_score`, `hubble.classification`, `hubble.response_classification` | 1 |
| `hubble.personalization`, `hubble.reply_draft`, `hubble.account_summary` | 2 |
| `hubble.research` | 3 |
| `hubble.ask`, `intelligence.plan`, `intelligence.summarize` | **0** |
| All 21 deterministic flow actions | **0 by construction** |

The three HTTP capabilities are **metered at 0 on purpose**: record the spend,
charge nothing, so the ledger fills with real rows before a price is chosen — *"a
price picked over an empty ledger is a guess."*

**Order is QUOTE → SPEND → RUN → RECORD.** Credits are spent before the model
runs, because "run first, charge after" means a crash gives work away free and a
customer at their limit can exceed it by however many calls are in flight.

**At zero credits the result is an outcome, not an error**: *"This step needs N
credit(s) and your plan has none left this month. The rest of the flow will
continue."* A thrown exception would abort the whole flow.

Refunds go through a **separately named function**, never a negative spend —
*"allowing the one entry point that charges customers to also silently un-charge
them is exactly the kind of thing that should require typing a different name."*

---

## 12. Outreach — mailboxes, campaigns, sequences, inbox

### 12.1 Mailboxes — `/email`

Connect an SMTP mailbox, see its readiness, and manage suppressions.

**Readiness** covers SPF, DKIM and DMARC checks plus a warm-up ramp. Sending
settings live on the mailbox card: **timezone, send window, and daily limit** —
and so does the **signature**, which is applied to everything this mailbox sends.
Every field is read on each enqueue — a message raised outside the window waits.

The window is evaluated in **the mailbox's timezone, not the recipient's**. The UI
says so plainly, and explains why: `crm_contacts` has no timezone column, so
recipient-local sending is **unmodelled rather than guessed**.

### 12.2 Campaigns — `/email/campaigns`

Creating a campaign takes a **name**, a **type**, and a **mailbox**.

Four campaign types, and the type is a policy, not a label:

| Type | Multiple steps | Stops on reply | Unsubscribe footer |
|---|:-:|:-:|:-:|
| `sales_sequence` | ✅ | ✅ | — |
| `marketing_broadcast` | ❌ | ❌ | ✅ |
| `flow_driven` | ✅ | ✅ | — |
| `manual` | ❌ | ❌ | suppressed |

`manual` is the safe default when anything is missing, and only because of what it
means: a one-to-one reply. A message with no campaign row **is** a one-off —
everything bulk goes through a campaign.

### 12.3 The campaign screen — `/email/campaigns/[id]`

**Launch blockers are shown before launch**, not as an error after pressing the
button: at least one step written, a mailbox to send from, contacts enrolled, and
for a broadcast, not more than one step. The server still refuses independently —
this is the courtesy, not the control.

**Results** are computed from the append-only event stream. There are **no counter
columns**, so what the page shows and what the raw events say cannot drift:
recipients, eligible, sent, delivered, replies, reply rate, auto-replies (never
counted as replies), bounced, unsubscribed, stopped-replied, stopped-unsubscribed,
still active.

Reply rate renders `—` when nothing has sent — **a campaign that has not sent has
no rate.**

### 12.4 The sequence builder — what actually exists

> This is the area most commonly misreported. What follows was verified in code
> on 2026-09-16.

`components/email/SequenceBuilder.tsx` is rendered by the campaign page and gated
on **`email.template.manage`** (manager + the `email` module). Below that, the
page shows a **read-only** step list.

Per step the author gets:

- **Subject** — required, 300 characters, placeholder `Quick question,
  {{first_name}}`
- **Body** — required, 20,000 characters, plain text
- **HTML version** — optional, collapsed by default. Leave it empty and the step
  sends plain text only, which is usually what you want
- **Wait before this email** — in hours. **The wait is before the step, not
  after**, which is what makes step 0 with wait 0 send immediately and means
  inserting a step never changes the meaning of its neighbours. Default 0 for the
  first step, 72 for later ones.
- **Reorder** (up/down) and **delete**
- **The variable list, printed under the body** — not left to memory

### 12.5 Personalization — the template engine

`lib/email/template.ts`. This is a **real engine**, and it is an allowlist, not a
free lookup.

Variables: `first_name`, `last_name`, `full_name`, `company_name`, `job_title`,
`owner_name`, `owner_email`, `sender_name`, and `{{custom.<field>}}` for any
custom field.

**Fallback syntax:** `{{first_name|there}}` — and the code argues for it at
length. A missing value has three bad answers and one good one: dropping the
message is worst, sending *"Hi ,"* is bad, leaving *"Hi {{first_name}},"* is worse
still because it leaks the machinery. The fallback is the one-keystroke answer.

**A typo is refused on save.** `{{firstname}}` returns *"`{{firstname}}` is not a
variable. Did you mean `{{first_name}}`?"* — because it would otherwise go out as
those exact characters to every recipient, which is the most visible possible
failure and cannot be taken back. An unclosed `{{` is caught too.

Rendering happens at **send** time, per recipient, in `sequence-runner.ts`.

### 12.6 Enrolling contacts

Enrollment is **not** on the campaign screen. It is a **bulk action on
`/crm/contacts`** — select contacts, choose a campaign. That is the audience
picker.

### 12.7 Sending — the order of operations is the guarantee

1. **CLAIM** — Postgres moves the row `queued → sending`, increments attempts and
   suppresses do-not-contact recipients, **all in one statement** under
   `FOR UPDATE SKIP LOCKED`.
2. **SEND** — the provider is called **at most once per claim**.
3. **RECORD** — `sending → sent` or `failed`.

A worker killed between 2 and 3 leaves the row in `sending`. The reaper moves it
to `needs_verification` and **never back to `queued`**, because we cannot know
whether the provider accepted it and SMTP gives us no way to ask.

**That is at-most-once, and it is deliberate:** a duplicate cold email costs a
spam complaint and a domain's reputation; a missed one costs a step the sequence
will repeat anyway.

The sequence runner **enqueues, it does not send**. Sending there would duplicate
the machinery and bypass the ramp, the send window and the daily allowance — the
checks a sequence most needs and is most tempted to skip.

### 12.8 Compliance

- **Unsubscribe** — RFC 8058 one-click, HMAC tokens, appended at send time (not at
  enqueue, so the footer is never baked into a message that waits days).
- The unsubscribe base URL **falls back to the production origin, never
  localhost** — a wrong base URL produces a dead link in mail that has already
  been sent and cannot be recalled.
- **Suppressions** are enforced at enqueue *and* at claim, and managed from
  `/email`.
- **Auto-reply detection** is deterministic and header-first, with anchored
  subject matching. Auto-replies are **never counted as replies**.
- A sender postal address is required for bulk types.

### 12.9 Inbox and analytics

`/email/inbox` — views, keyset paging, assign and resolve, a **thread view** and a
**reply composer**. `/email/analytics` — campaign, mailbox and batch funnels.

Reply sync runs on the tick across mailboxes in `ready`, `ramping` or `warning`,
oldest sync first, 10 per tick.

---

## 13. Automations (Flows)

`/flows` — build an automation as a graph, publish it, watch it run.

### Structure

Three step types: **ACTION**, **WAIT**, **BRANCH**.

**A wait is bounded** — capped at 90 days. An unbounded wait is a run that never
finishes and never surfaces; it just sits there, and nobody notices until someone
asks why a contact stalled three months ago.

Branch operators: `equals`, `not_equals`, `contains`, `not_contains`, `is_empty`,
`is_not_empty`, `greater_than`, `less_than`, `in`, `not_in`, matched `all` or
`any`.

### Actions

**21 deterministic actions, every one free:**

`ASSIGN_OWNER` · `ROUND_ROBIN` · `CREATE_TASK` · `MOVE_STAGE` · `UPDATE_FIELD` ·
`ADD_TAG` · `REMOVE_TAG` · `ADD_TO_LIST` · `REMOVE_FROM_LIST` ·
`CREATE_OPPORTUNITY` · `CREATE_ACTIVITY` · `NOTIFY` · `DEDUPE_CHECK` ·
`DATE_CALC` · `TEXT_TRANSFORM` · `WEBHOOK` · `ENROLL_SEQUENCE` ·
`REMOVE_SEQUENCE` · `PAUSE_SEQUENCE` · `RESUME_SEQUENCE` · `CREATE_EMAIL_TASK`

Plus `SEND_EMAIL`, which is free but is the **one deterministic action whose
permission is not `flow.manage`** — it requires `email.campaign.launch`, and the
send gate refuses without it.

**7 AI actions**, priced 1–3 credits, listed in [§11](#11-hubble-intelligence).

The price of a flow is shown **before publish**, while the customer can still
change it.

### Triggers

Seventeen trigger types are defined and **all seventeen are offered in the
builder's dropdown**:

`contact_created` · `contact_assigned` · `list_added` · `batch_added` ·
`campaign_enrolled` · `stage_changed` · `task_completed` · `email_sent` ·
`email_replied` · `email_bounced` · `email_unsubscribed` · `call_booked` ·
`opportunity_won` · `no_activity` · `webhook` · `scheduled` · `manual`

**Only eleven of them are ever emitted.** See [§16](#16-verified-gaps) — this is
the most consequential open issue in the automation layer.

### Runtime

Claim-based with backoff, loop protection, **pinned versions** (a published flow
runs the definition it compiled against, not the one being edited), and
at-most-once semantics per step.

`/flows/[id]` shows **run history** — `flow_runs` and `flow_step_runs` with
status, duration, error and **credits per step**.

**Test mode exists**: `TestFlow.tsx` → `simulateFlowAction` → `simulateFlow` gives
a dry run.

### Templates

**Seven starter templates**, each validated by the publish validator and proven to
spend nothing:

| Template | Trigger | Fires today? |
|---|---|:-:|
| Follow up on a list | `list_added` | ❌ |
| Handle a reply | `email_replied` | ✅ |
| Call booked | `call_booked` | ✅ |
| Deal moved stage | `stage_changed` | ✅ |
| Gone quiet | `no_activity` | ❌ |
| Deal won | `opportunity_won` | ✅ |
| Clean up a bounce | `email_bounced` | ✅ |

---

## 14. The automation spine — how it all connects

This is the section that answers *"how is everything linked?"*

### The clock

**pg_cron → `/api/cron` every 5 minutes.** The route authenticates a bearer
`CRON_SECRET`, **failing closed** — no secret refuses every request — with a
constant-time comparison. It then runs the tick and **always returns HTTP 200**,
even if jobs inside failed, so a scheduler never retries a tick that already sent
mail.

GitHub Actions is a **backstop only**: measured at one run per ~193 minutes
against the 5 it asks for, which capped the whole platform at about 185 emails a
day.

`after()` still nudges the tick after a launch so the first send is immediate.

**Budgets:** 45 seconds per tick, 20 seconds per job. An overrun is recorded as a
failure; a job that never got a slot is recorded as *skipped — tick budget
exhausted*. A timed-out job is **abandoned, not cancelled** — safe only because
every job is claim-based and idempotent.

### The ten jobs, in order

Order is deliberate: reaping first so abandoned rows are claimable on the same
tick, and sends before reply sync.

| # | Job | What it does | Cap |
|---|---|---|---|
| 1 | `reap_email_claims` | Releases stale email claims | — |
| 2 | `advance_sequences` | Enqueues the next due step per active enrollment | 25 |
| 3 | `send_email` | Claims, sends, records | 25 |
| 4 | `sync_replies` | Pulls replies per mailbox, oldest first | 10 mailboxes |
| 5 | `advance_flows` | Claims waiting flow runs and advances them | 20 |
| 6 | `deliver_webhooks` | Outbound webhook delivery, then prunes the log | 20 |
| 7 | `sync_contact_evidence` | Research → CRM contact details | 5 workspaces |
| 8 | `drain_extraction_queue` | **One** orphaned extraction job | 1 |
| 9 | `retry_routing` | Re-routes leads that waited | 100 |
| 10 | `rollup_reporting` | Reporting rollups | 5 workspaces |

Then `worker_runs` takes **one row per tick** — including the whole per-job
`{ok, detail}` map. `ok = false` when *any* job inside failed: the tick still ran,
and that distinction is the table's entire purpose. Rows older than 30 days are
pruned in the same call, and recording never throws.

`/admin` reports staleness from that table: **healthy / delayed (20 min) / stale
(60 min) / never**, and names the three usual causes.

### The event fan-out — one door, three consumers

`emitDomainEvent` is the single door. From it, three things happen:

```
                    ┌─→ dispatchFlowTrigger  → runs the customer's flows
emitDomainEvent ────┼─→ publishEvent          → outbound webhooks
                    └─→ notifyDomainEvent     → Slack / Teams
```

None of them can fail the thing that emitted them. A send that happened must be
recorded as sent even if every downstream consumer is broken.

**The eleven live triggers and where they are emitted:**

| Trigger | Emitted from |
|---|---|
| `contact_created` | CRM ingest |
| `contact_assigned` | Activities, routing, routing rules |
| `stage_changed` | Opportunities |
| `opportunity_won` | Opportunities |
| `task_completed` | Tasks |
| `email_sent` | Send worker |
| `email_replied` | Reply sync |
| `email_bounced` | Reply sync |
| `email_unsubscribed` | Unsubscribe action |
| `call_booked` | Meetings (Calendly) |
| `manual` | Run-manually action |

### End-to-end: a lead's whole life

```
  Sales Navigator page the user opened
            │
   ┌────────┴────────┐
   │                 │
 upload          extension capture
   │                 │
   └────────┬────────┘
            ▼
     extraction_jobs  ──▶ job_queue ──▶ worker
            │                            │
            │                    parse → dedupe → charge
            ▼                            ▼
      extracted_leads  ◀────────── CSV export
            │
      ┌─────┴──────┐
      │            │
 Hubble research   │  "Send to CRM"  (explicit)
      │            ▼
 research_evidence │        crm_contacts
      │            │             │
      └── evidence-bridge ───────┘
                   │
                   ▼
            emitDomainEvent('contact_created')
                   │
      ┌────────────┼────────────┐
      ▼            ▼            ▼
   flows       webhooks    Slack/Teams
      │
      ├─ ENROLL_SEQUENCE ─▶ email_enrollments
      │                          │
      │                   advance_sequences (tick)
      │                          ▼
      │                    email_messages (queued)
      │                          │
      │                    send_email (tick)
      │                          ▼
      │                       delivered
      │                          │
      │                    sync_replies (tick)
      │                          ▼
      └──────────────── email_replied ──▶ stops the sequence
```

---

## 15. Integrations, public API, webhooks, notifications

### Integrations

- **Google** (Sheets + Drive) — OAuth with `drive.file` and `spreadsheets`.
  Connect requires a same-origin referer on an approved host; the callback
  validates state length, a signed browser-binding cookie, the signed-in user,
  single-use transaction consumption, and that the redirect URI has not changed.
  The previous refresh token is rotated **and revoked**.
- **GoHighLevel** — Private Integration Token plus Location ID, no OAuth.
  Validated against the live API with distinct messages for a bad token (401), a
  missing scope (403), and a location mismatch (404/422). Credentials are
  encrypted at rest.
- **Clay** — push leads to a Clay table webhook.
- **Calendly** — **inbound only**. HMAC-signed, 300-second freshness window. An
  invalid signature is 401; a valid-but-unsupported payload returns **200** so
  Calendly does not retry; a genuine ingest failure returns 500, which is safe
  because of the dedupe key. Feeds `meeting.booked` / `cancelled` / `rescheduled`.

> The integration catalogue lists **Microsoft** and **Dropbox** as `planned`, with
> the reasons recorded in code. They are not connectable.

### Public API — `/api/v1/*`

`activities`, `companies`, `contacts`, `lists`, `opportunities`, `tasks` — all
**GET only**.

- **Bearer token only**, never a query parameter. Keys are prefixed `outlio_sk_`
  — deliberately scanner-matchable. Only the SHA-256 is stored; the plaintext is
  returned exactly **once**.
- **The workspace is derived from the key.** A request cannot name a workspace.
- Revoked and unknown keys return the **same** 401, so a key cannot be probed.
- Rate limit is per key, default 120/minute, and is applied **before** the scope
  check.
- Paging: `limit` (default 25, max 100) and `offset`, with a `pagination` block.
  Explicit column lists, never `select('*')`.
- **Every request including refusals is logged** — path only, query string
  stripped.

### Outbound webhooks

Signature is `t=<unix>,v1=<hmac-sha256 of "t.body">` with a 300-second freshness
window. Backoff is 30 s / 2 m / 8 m / 32 m / 2 h with **equal jitter**; a
subscription auto-disables after 20 consecutive failures; the delivery log is
pruned after 30 days. Signing secrets are **encrypted at rest**, and the URL is
SSRF-screened.

Twelve events: contact created/assigned, opportunity stage-changed/won, task
completed, email sent/replied/bounced, contact unsubscribed, meeting
booked/cancelled/rescheduled.

### Notifications

Slack and Microsoft Teams (via Power Automate Workflows — the Office 365 connector
was retired). An empty event list means **every** offered event. Messages carry
**the fact and a link, never the record**.

The notifiable set is a deliberate **subset** of the webhook events — the ones a
human wants interrupting them.

> The **"Send test" button bypasses the event filter by design.** It always
> delivers, which can read as a false green.

Only the webhook URL's **host** is ever sent to the client — the URL is a
credential.

---

## 16. Verified gaps

Everything below was checked against the working tree on 2026-09-16. This list
replaces the email and flows rows of the R0 gap matrix.

### 16.1 Email — what is *not* missing

Because these are widely believed to be broken and are not:

| Reported as missing | Actual state |
|---|---|
| Sequence creation | **Works.** `SequenceBuilder` is rendered by the campaign page and wired to `saveStep` / `deleteStep` / `moveStep` |
| Email body text | **Works.** Subject (300 chars) + body (20,000 chars) + per-step wait |
| Placeholders / personalization | **Works.** Full allowlist engine with fallbacks, typo suggestions and a printed variable list |
| Send worker never runs | **Fixed.** `send_email` runs on the 5-minute tick |
| Reply sync has no callers | **Fixed.** `sync_replies` runs on the tick |
| No analytics screen | **Exists** at `/email/analytics` |
| No suppression UI | **Exists** on `/email` |
| No thread view or reply composer | **Both exist** |
| No campaign schedule UI | **Exists** on the mailbox card |
| Flow test mode missing | **Exists** — `TestFlow` → `simulateFlowAction` |

**If a user cannot see the sequence builder, the cause is almost always
permission, not absence:** it requires the **`email` module on the plan** *and*
**manager role or above**. Below that, the page renders a read-only step list with
no authoring controls — which looks exactly like a missing feature.

### 16.2 Email — what genuinely is missing

> **✅ ① and ② were fixed on 2026-09-16** (migration `0142`, `lib/email/signature.ts`).
> They are kept here with their original diagnosis because the reasoning explains
> the design that replaced them. See `docs/PROGRESS.md` for the full entry.
>
> ⚠️ **Migration 0142 must be applied before that code deploys** — `ACCOUNT_COLUMNS`
> is one literal string, so a missing column fails every account read and stops all
> outbound mail. `migrationHint()` names the migration in the error. (It is applied.)

**① ~~No sender signature. Anywhere.~~ — FIXED**

*The original finding:* there was no signature column on `email_accounts` or
`email_sequence_steps`, no field in any settings screen, no input in the sequence
builder or reply composer, and **nothing appended one at send time**. Every
"signature" match in the codebase was cryptographic.

*How it works now:* `email_accounts.signature_text` and `signature_html`, edited
on the mailbox card under `email.account.manage`, applied by `applySignature()` at
**send time** — so editing a signature also fixes mail already sitting in the
queue. It sits **above** the compliance footer, applies to **every** campaign type
including `manual`, and is **literal text**: template variables are deliberately
not rendered, because this runs after the message is claimed, where refusing on a
missing value is no longer an option.

**② ~~HTML email bodies cannot be authored.~~ — FIXED**

*The original finding:* the `body_html` column existed and `sequence-runner.ts`
rendered it, but `bodyHtml` appeared nowhere in `app/` or `components/`, so
nothing ever wrote it.

*How it works now:* an optional, collapsed-by-default HTML field in the sequence
builder, validated by the same `validateTemplate` rules as the subject and text
body. Blank stores **NULL**, not `''` — the runner branches on truthiness, and an
empty HTML part renders as a blank email in any client that prefers HTML.
Interpolated values are escaped, so a contact name containing `<` cannot break the
markup. There is deliberately **no HTML preview**: rendering author HTML in our own
browser is the one thing rule 3 exists to prevent.

**③ Personalization is limited to the allowlist.**

Eight fixed variables plus `{{custom.<field>}}`. There is no conditional content,
no spintax, no per-recipient snippet library, and no A/B variants per step. The
allowlist is a deliberate safety decision, not an oversight — but it is worth
stating plainly, because "personalization" often means more than merge fields.

Note also that **custom fields have schema and validation but no UI and no callers
anywhere** — so `{{custom.industry}}` has no supported way to get a value.

### 16.3 Flows — six triggers that can never fire

The builder offers all 17 trigger types. Only 11 are emitted anywhere in the
codebase.

**Never emitted:** `list_added` · `batch_added` · `campaign_enrolled` ·
`no_activity` · `webhook` · `scheduled`

These appear only in the type definition and in the starter templates. A user can
select one, publish a flow, see it marked active, and **wait forever**.

**This makes two of the seven starter templates dead on arrival** — "Follow up on
a list" (`list_added`) and "Gone quiet" (`no_activity`). Those are shipped,
recommended starting points that cannot work.

*Suggested fix order:* either emit the missing triggers, or filter the builder's
dropdown to the live set and withdraw the two templates. The second is a small
change and stops the product making a promise it cannot keep.

### 16.4 Duplicate detection never runs automatically

`scanWorkspaceForDuplicates` has **no production caller** — no tick entry, no SQL
trigger. The Duplicate Center at `/crm/duplicates` is fully built and will show
nothing until something runs the scan.

**Do not describe automatic duplicate detection in user-facing documentation.**

### 16.5 Smaller items

- **Refunds have no webhook handling.** The policy is documented; the system does
  not react to a refund event.
- **The notifications "Send test" button bypasses the event filter** — it always
  delivers, which can read as a false green.
- **The integration catalogue lists Microsoft and Dropbox** as planned providers
  that cannot be connected.
- **Recipient-local send scheduling is unmodelled** — `crm_contacts` has no
  timezone column, so windows are evaluated in the mailbox's timezone. This is
  stated in the UI rather than guessed.

### 16.6 One discrepancy to resolve

`CLAUDE.md` records rate limiting as *"fails open by design."* The wrapper in
`lib/auth/rate-limit.ts` appears to **fail closed** on an RPC error — returning
`allowed: false`. The "fails open" phrasing appears in comments in
`lib/crm/contact-stop.ts` and `lib/email/send.ts`, which contrast the limiter's
tolerance with suppression checks that must fail closed.

**This needs an owner decision before either behaviour is documented as
intended.** It is flagged, not resolved.

---

## 17. Security model

### The non-negotiables

- **Uploaded HTML is never rendered in a browser.** No `dangerouslySetInnerHTML`,
  no `innerHTML`, no `iframe srcdoc`. Parsing is server-side only.
- **No LinkedIn credentials or cookies** are collected, stored, transmitted or
  logged — ever. They are stripped if present in uploaded HTML.
- **Storage keys are server-generated.** A path is never derived from a
  user-supplied filename.
- **Uploads are validated by content sniffing**, not extension or declared MIME.
- **RLS on every table**, no exceptions. The service role bypasses it, so every
  service-role query scopes by tenant **in code**.
- **Authorization is server-side.** Hiding a button is not access control, and
  every route re-asserts permission because a URL can be typed.
- **No secrets in source.** `SUPABASE_SERVICE_ROLE_KEY` is server/worker only and
  never prefixed `NEXT_PUBLIC_`.
- **Never log** full lead records, file contents, tokens, signed URLs or cookies.
- **Never return** a stack trace, SQL, storage path or internal ID to a client.

### Errors

The typed catalog in `lib/errors/catalog.ts` is the only shape sent to a client:
`{error: {code, message}}`. Anything unrecognised collapses to `ERR_INTERNAL`.
Users see friendly copy; logs get the detail.

### Audit

Every state-changing admin action writes an `admin_audit_logs` row **in the same
transaction**. The table is **append-only**, enforced by triggers that fire for
every role **including the service role**. The foreign keys to `auth.users` were
dropped, because `on delete set null` is itself an UPDATE and the trigger blocked
it.

Admins cannot revoke or suspend themselves, and no admin action may target another
admin.

### Signed URLs

Exports are served through signed URLs with a **60-second default TTL**, clamped
to 1–3600 seconds, and ownership is re-verified **and** the key prefix re-checked
before signing.

### Migrations

Applied **by hand in the Supabase SQL editor**, never by an agent. Validate one
first against a throwaway Postgres:

```bash
scripts/check-migration.sh supabase/migrations/0117_worker_runs.sql
```

### Test fixtures

`tests/fixtures/html/` contains **fabricated data only** — invented names,
`example.com` domains, `linkedin.com/sales/lead/fabricated-N` URLs.

**Never commit a real saved page or any real person's data.** Required hostile
fixtures: empty file, binary renamed `.html`, deeply nested `<div>` bomb, HTML
containing `<script>`, a results page with zero results, and a lead whose name is
`=cmd|'/c calc'!A1`.

---

## Appendix — commands

```bash
npm run dev              # Next.js app
npm run lint             # eslint
npm run build            # next build
npm run typecheck        # tsc --noEmit
npm test                 # vitest, unit only — fast, no network
```

Slower, not part of the default loop:

```bash
npm run test:integration # hits the real Supabase project — serial
npm run test:e2e         # Playwright, staging only
npm run db:types         # regenerate types/database.ts after a migration
```

---

*End of reference. When this document and the code disagree, the code is right —
and this file should be corrected in the same change.*
