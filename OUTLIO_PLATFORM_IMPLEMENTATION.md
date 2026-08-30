# OUTLIO_PLATFORM_IMPLEMENTATION.md

The **Ledger**. Read before every phase; update after every phase.

The repository is the technical source of truth. Every "CURRENT" claim below
cites the file it was read from. Where the product plan and the repository
disagree, the repository wins and the conflict is recorded under
[Open questions](#12-open-questions--conflicts).

- **Repository of record:** `github.com/blluemoon135791113-byte/outlio--website`
  (local `origin`). See [D1](#d1-repository-of-record).
- **Ledger opened:** 2026-08-30 (M0)
- **Last updated:** 2026-08-30 (M5 Phase 14 complete — message engine)
- **Blocked on a human:** plan seat counts (Q6) only. `0070`–`0083` are all
  applied and types are regenerated.
- **Next milestone:** M5 — email foundation (Phases 11 ✅, 12–14 open).
- **Next milestone:** M3 — opportunities, pipelines, native Kanban, collision
  guard. Two M2 UIs remain deferred (DR12 CSV import, DR14 Duplicate Center).

---

## 1. Current stack

| Concern | Actual | Evidence |
|---|---|---|
| Framework | Next.js **16.3.0**, App Router, React 19.2.4 | `package.json` |
| Language | TypeScript `strict`, path alias `@/*` | `tsconfig.json` |
| Styling | Tailwind CSS v4 (`@theme`), Geist fonts | `app/globals.css`, `postcss.config.mjs` |
| Database | Supabase Postgres, project `ptewhpmxzenbmxlizxhu` | `CLAUDE.md` |
| ORM | **None.** `supabase-js` query builder + SQL functions | `lib/supabase/` |
| Migrations | Hand-written, numbered SQL, `0001`–`0083` | `supabase/migrations/` |
| Generated types | `types/database.ts` (6,433 lines) via `npm run db:types` | `scripts/gen-db-types.mjs` |
| Validation | Zod 4 | `lib/limits/plans.ts` and throughout |
| Tests | **Vitest 4** — 1,754 unit / 97 files, plus 126 integration | `vitest.config.mts`, `tests/` |
| Package manager | npm | `package-lock.json` |
| Edge guard | `proxy.ts` (Next 16 renamed `middleware`) | `proxy.ts` |
| Hosting | Vercel; background work via `after()` | `CLAUDE.md`, `lib/worker/` |

> **CLAUDE.md is stale on two points.** It says `npm run typecheck` is "NOT YET
> ADDED" and Vitest is "NOT YET INSTALLED". Both exist and pass. Corrected in
> [D2](#d2-claudemd-corrections).

### Routing / hosts

`app.outlio.io` **is already the product host.** This was completed on
2026-08-30 (`docs/PROGRESS.md`, final entry) — the planned M1 routing decision
is therefore already implemented, not pending.

| Host | Serves | Evidence |
|---|---|---|
| `outlio.io` | Agency marketing site | `app/page.tsx`, `app/terms/` |
| `app.outlio.io` | Lead Engine product + marketing | `app/app-home/`, `app/pricing/` |
| `app.outlio.io/dashboard/*` | Authenticated product | `app/(product)/dashboard/` |

`lib/site.ts` is the single source of `APP_HOST`, `APP_ORIGIN`, `isAppHost()`,
`appUrl()`. Host routing is enforced by an internal rewrite in `proxy.ts`.

---

## 2. Current data model

**95 tables, ~72 SQL functions.** Extracted from `types/database.ts`.

### Identity, access, billing
`profiles`, `plans`, `subscriptions`, `access_requests`, `invitation_codes`,
`admin_audit_logs`, `rate_limits`, `usage_counters`, `credit_grants`,
`referrals`, `signup_device_claims`, `signup_identity_claims`,
`signup_ip_claims`.

`profiles` (`types/database.ts:3042`) is the **only** account entity:

```
id, email, full_name, company_name, phone, linkedin_url, avatar_path,
role (user_role enum), plan_id → plans, access_expires_at,
suspended_at, suspended_reason, deleted_at, consent_accepted_at,
extension_enabled, referral_code, created_at, updated_at
```

`user_role` enum (`types/database.ts:4599`):
`registered_user | pending_user | approved_user | subscriber | admin | suspended_user`

`plan_key` enum: `trial | starter | professional | agency | custom`.
Plan limits are a validated JSONB blob — `lib/limits/plans.ts:23`
(`credits_per_month`, `extractions_per_day`, `records_per_month`,
`exports_per_month`, `retention_days`, …). **No limit is hardcoded anywhere.**

### Lead Engine
`extraction_jobs`, `extracted_leads`, `lead_keys`, `uploaded_files`,
`companies`, `company_links`, `company_signals`, `account_list_entries`,
`source_list`, `export_jobs`, `export_job_errors`, `export_destinations`.

### Capture extension
`extension_devices`, `extension_pairings`, `capture_sessions`, `capture_pages`.

### Hubble (AI)
`hubble_answers`, `hubble_chunks`, `hubble_pages`, `research_evidence`,
`research_runs`, `research_tool_calls`, `research_job_queue`,
`web_research_cache`, `web_research_jobs`, `web_research_lead_results`,
`provider_cache`, `provider_request_schedules`.

### Qualification
`qualification_profiles`, `qualification_results`, `qualification_rules`.

### Integrations
`integration_connections`, `integration_secrets`, `integration_record_links`,
`integration_oauth_transactions`.

### Billing providers
FastSpring (**current**): `fastspring_accounts`, `fastspring_subscriptions`,
`fastspring_orders`, `fastspring_charges`, `fastspring_webhook_events`.
Paddle (**superseded**, tables retained): `paddle_customers`,
`paddle_subscriptions`, `paddle_transactions`, `paddle_webhook_events`.

### CRM (added by M2, migrations 0071–0075)
**Identity (0071):** `crm_contacts`, `crm_companies`, `crm_contact_emails`,
`crm_contact_phones`, `crm_contact_company_relationships`, `crm_tags`,
`crm_contact_tags`, `crm_custom_field_definitions`, `crm_custom_field_values`,
`crm_saved_views`.
**Ingestion (0072–0073):** `crm_lead_batches`, `crm_batch_members`,
`crm_lists`, `crm_list_members`, `crm_import_jobs`; `crm_ingest_contacts()`,
`crm_undo_batch()`.
**Dedup (0074):** `crm_duplicate_candidates`, `crm_merge_events`;
`crm_merge_contacts()`.
**Operations (0075):** `crm_activities`, `crm_tasks`, `crm_notes`,
`crm_note_mentions`, `crm_notifications`, `crm_notification_preferences`,
`crm_audit_logs`; `crm_guard_append_only()`, `crm_erase_contact()`.
Enums: `crm_record_source`, `crm_custom_field_type`, `crm_custom_field_entity`,
`crm_activity_type`, `crm_activity_channel`, `crm_task_status`.

### Workspaces (added by M1, migration 0070)
`workspaces`, `workspace_memberships`, `workspace_invitations`,
`workspace_feature_flags`. Functions: `is_workspace_member()`,
`workspace_role_of()`, `redeem_workspace_invitation()`.
`workspace_role` enum: `owner | admin | manager | setter | viewer`.

### Queues
`job_queue`, `research_job_queue`, `system_events`.

---

## 3. Current auth

Supabase Auth (email/password + MFA/AAL2). Three clients, per `CLAUDE.md`:

| Client | Use | File |
|---|---|---|
| Browser | Client components | `lib/supabase/client.ts` |
| Server | RSC / Server Actions | `lib/supabase/server.ts` |
| Service role | Server-only, **bypasses RLS** | `lib/supabase/admin.ts` |

**The access decision is already centralized and pure**, which is the single
most reusable asset for M1:

- `lib/auth/decide.ts` — pure function, zero I/O, exhaustively unit-tested
  (`tests/unit/access-decision.test.ts`). `precheckAccess()` → `NEEDS_LIMITS`
  → `decideLimits()`.
- `lib/auth/access.ts` — gathers inputs only. Exports the complete guard set:
  `getAccessContext`, `requireAccess`, `requireUser`, `requireAdmin`,
  `requireHubbleAccess`, `assertAccess`, `assertUser`, `assertAdmin`,
  `assertHubbleAccess`. Page guards `redirect()`; action guards throw
  `AppError`.
- `lib/auth/admin-gate.ts` — admin routes additionally require AAL2.
- `lib/auth/rate-limit.ts` — Postgres-backed, `consume_rate_limit` is one
  atomic statement, **fails closed**, HMAC-hashed subjects via `subjectFor()`.

**This is the layer M1 extends.** The A3 requirement for "centralized
permissions in ONE policy layer" is already satisfied in shape; it is missing
only the workspace/role dimension.

---

## 4. Current workspace / tenancy model

**Workspaces exist as of migration 0070 (applied 2026-08-30).** Every profile
owns exactly one — verified against the live project: 61 profiles → 61
workspaces → 61 owner memberships, none missing, none duplicated.

⚠️ **TWO TENANCY MODELS COEXIST, AND THAT IS DELIBERATE FOR NOW.**

| Surface | Scoped by | Policy |
|---|---|---|
| Lead Engine, billing, extraction, Hubble (pre-0070) | `user_id` | `auth.uid() = user_id or public.is_admin()` (e.g. `0067:53`) |
| Workspaces and everything M2+ builds | `workspace_id` | `public.is_workspace_member(workspace_id) or public.is_admin()` |

0070 touched no existing table, so nothing about today's Lead Engine changed on
deploy. Whether the pre-existing tables gain `workspace_id` is Ledger Q4/DR5,
decided in M2 when CRM ingestion defines the boundary.

**Every M2+ entity must be workspace-scoped from birth.**

Service-role queries scope by `user_id` **in code** because RLS is bypassed —
see the comment at `lib/auth/access.ts:111`. That discipline extends to
`workspace_id`: see the guards in `lib/workspaces/context.ts`, and
`assertWorkspaceMembership` for actions that carry a workspace id in their
payload rather than relying on the active-workspace cookie.

---

## 5. Current subscription, billing & credits

- **Merchant of record: FastSpring.** Migrations `0068_fastspring_billing.sql`,
  `0069_fastspring_charges_and_credits.sql`. Library `lib/fastspring/`.
  Webhook route `app/api/webhooks/*`; signature verification and idempotent
  event handling are tested (`tests/unit/fastspring-*.test.ts`, 7 files).
- **Paddle is superseded** (commit `7544981`) but its tables and
  `paddle_subscription_grants_access` remain for historical reconciliation.
- **`grant_entitlement()` is THE single path to access**
  (`supabase/migrations/0010_entitlements_and_invitations.sql:19`). Atomic:
  profile + subscription + `access_requests` resolution + `admin_audit_logs`
  row in one transaction. Provider-agnostic. `revoke_entitlement()` inverts it.
- **Credits:** `consume_credit`, `credit_balance`, `granted_credits`,
  `lead_credit_cost`, `charge_extraction_leads`,
  `grant_fastspring_period_credits`. Billing is **per lead**, not per run
  (`lib/limits/credits.ts`).
- **Invitation codes already exist** — but they are *entitlement* codes
  (`redeem_invitation_code`, `0010:155`), not team invitations. Different
  concept, must not be conflated. See [D6](#d6-two-kinds-of-invitation).

---

## 6. Current Lead Engine

Input arrives by exactly two routes (`CLAUDE.md` rule 1): a user-uploaded HTML
file, or a page captured by the browser extension during a session the user
explicitly started. **No LinkedIn automation of any kind.**

Pipeline: upload → `job_queue` → `lib/worker/process-job.ts` → cheerio parse →
`extracted_leads` + `companies` → dedup via `lead_keys` → export.

- Parser contract: `docs/SELECTOR_MAP.md` §3. Anchor only on `data-anonymize`.
- Dedup keys already exist: `lead_keys`, `tests/unit/dedupe-keys.test.ts`,
  `lib/companies/` normalization (`company-normalize.test.ts`,
  `company-identity.test.ts`). **M2/M4 dedup should extend these, not
  reinvent them.**
- Export sanitization is centralized in `lib/export/sanitize.ts`
  (formula-injection defense lives there and nowhere else).

---

## 7. Current background jobs

`job_queue` + `research_job_queue`, claimed with `FOR UPDATE SKIP LOCKED` via
`claim_job` / `claim_next_job` / `claim_research_run` / `claim_next_research_run`.
Attempts, backoff, stale-claim reapers (`reap_stale_research_runs`,
`reap_orphaned_uploads`) all exist.

Trigger today is `after()` on Vercel; the processor is a plain library
(`lib/worker/`) so a long-running loop can be swapped in without touching queue
semantics (`CLAUDE.md`, "Worker deployment"). **Extraction never runs in a
request handler's response path.**

`queue_status` enum: `pending | claimed | done | failed`.

---

## 8. Current integrations

`lib/integrations/` with a repository + adapter shape already in place:

| Provider | Auth | Save function |
|---|---|---|
| HubSpot | OAuth | `save_hubspot_connection`, `update_hubspot_tokens` |
| Salesforce | OAuth (+ refresh locking) | `save_salesforce_connection`, `claim_salesforce_token_refresh` |
| Google | OAuth | `save_google_connection`, `update_google_tokens` |
| GoHighLevel | OAuth | `save_ghl_connection` |
| Clay | API key | `save_clay_connection` |

Secrets are encrypted server-side (`lib/integrations/crypto.ts`) in
`integration_secrets` and never returned to the browser.
`integration_oauth_transactions` implements CSRF-safe state.

**This is a real, working OAuth foundation.** M5 (Gmail / Microsoft 365) and
M8 (Calendly) should extend `integration_connections`, not build a parallel
system. `integration_record_links` is a usable precedent for
`integration_mappings`.

---

## 9. Current Hubble (AI)

`lib/hubble/` — retrieval, extraction, reasoning, summarization, source
quality, provider fallback. Credits are metered through `consume_credit`.
Access is gated by `requireHubbleAccess` / `assertHubbleAccess`
(`lib/auth/access.ts:248`), which resolves the `custom` plan tier from
`fastspring_subscriptions`.

A central `hubble.execute()` boundary as specified in A3/M7 **does not exist
yet** — calls are organized per capability under `lib/hubble/`. M7 must
introduce that boundary rather than scattering further call sites.

---

## 10. Current UI

Shell: `components/product/ProductShell.tsx` — fixed 216px sidebar, sticky
header, avatar menu, mobile drawer. Nav: `components/product/ProductNav.tsx`.
Component library: `components/ui/`. Design tokens: `docs/DESIGN_TOKENS.md`,
`app/globals.css`.

Settings already uses a nested layout (`app/(product)/dashboard/settings/layout.tsx`)
with pages for billing, security, email, extension, integrations, delete.
**Team management belongs there** as a sibling, not a new surface.

Rules that bind all new UI (`CLAUDE.md`): zero hardcoded colors, no entrance
animations in the product, no `backdrop-filter` on dashboard surfaces, every
screen ships loading + empty + error states, motion ≤150ms, no dark mode.

---

## 11. Planned entity → existing equivalent

Adapt these; do not duplicate.

| Planned | Exists today | Action |
|---|---|---|
| Workspace | `workspaces` ✅ (M1) | Done |
| Membership / Role | `workspace_memberships.role` ✅ (M1) + `profiles.role` | Done. Two axes, never merged ([D4](#d4-two-role-axes)) |
| Team | — | Create (M1, deferred to M2 if unblocking) |
| Permission layer | `lib/workspaces/permissions.ts` ✅ (M1) + `lib/auth/decide.ts` | Workspace roles decided by the former, platform access by the latter |
| Entitlements | `plans.limits` module flags ✅ (M1) + `grant_entitlement()` | Done. ⚠️ No plan sets `workspace_member_limit > 1` yet (Q6) |
| Team invitation | `workspace_invitations` ✅ (M1) | Done. Separate from `invitation_codes` ([D6](#d6-two-kinds-of-invitation)) |
| Contact | `crm_contacts` ✅ (M2 P2) | Done. `extracted_leads` remains the immutable extraction record, linked by `source_lead_id` |
| Company | `crm_companies` ✅ (M2 P2) + `companies` | Two entities, both kept ([D13](#d13-crm_companies-is-not-companies)) |
| Field normalization | `lib/crm/normalize.ts` ✅ (M2 Phase 2) | Email, phone, person LinkedIn, person name. Delegates company domain/name/page to `lib/companies/normalize.ts` and the LinkedIn key to `lib/leads/canonical-url.ts` |
| Dedup | `lead_keys`, `lib/companies/` normalizers, `pg_trgm` | **Reuse** for M4 |
| Activities | `system_events`, `admin_audit_logs` | Create `crm_activities`; append-only precedent exists |
| Background jobs | `job_queue` ✅ | **Reuse** |
| Rate limiting | `lib/auth/rate-limit.ts` ✅ | **Reuse** |
| Integration framework | `integration_connections` ✅ | **Reuse** for email + Calendly |
| Credits for AI | `consume_credit` ✅ | **Reuse**; no parallel ledger |
| Audit log | `admin_audit_logs` ✅ | Reuse pattern for workspace audit |

---

## 12. Open questions & conflicts

| # | Question | Status |
|---|---|---|
| Q1 | GitLab mirror `outlio-group/outlio-website` holds an earlier M0/M1 attempt (MRs !10, !11) that is unreachable from the development machine and conflicts on migration numbers `0068`/`0069`. | **Resolved — [D1](#d1-repository-of-record).** GitHub is the repository of record; the GitLab MRs are abandoned, not merged. |
| Q2 | When does the long-running worker container replace `after()`? | **Open.** Not blocking until M5 (email scheduling needs a real scheduler). |
| Q3 | Global search: Postgres FTS vs external? | **Open**, deferred to M9 Phase 28 per plan. |
| Q4 | Do existing single-user Lead Engine tables get `workspace_id`? | **Resolved — [D13](#d13-crm_companies-is-not-companies).** They stay `user_id`-scoped. The CRM gets its own workspace-scoped tables, linked by `source_company_id` / `source_lead_id`. |
| Q5 | `plan_key` enum has no `team`/`seats` tier. Member limits need a home. | **Resolved — [D5](#d5-entitlements-come-from-planslimits).** |
| Q6 | **No plan currently sells a second seat.** `workspace_member_limit` defaults to `1`, so invitations are refused on every existing plan until seat counts are set on `plans.limits`. That is a PRICING decision, not an engineering one. | **Open — needs a human.** Interim path: `workspaces.member_limit_override` widens one account. The invite flow is complete and tested; it is gated, not missing. |

---

## 13. Decisions

### D1. Repository of record
`github.com/blluemoon135791113-byte/outlio--website` is the technical source of
truth. The GitLab mirror was imported from an older `main` (Paddle-era), lacks
the FastSpring migration and the `app.outlio.io` routing work, and is not
reachable from the development environment. Work continues on GitHub; the
GitLab MRs !10/!11 are superseded by this Ledger and the M1 branch.
*Consequence:* workspace migrations take numbers `0070+`, not `0068`/`0069`.

### D2. CLAUDE.md corrections
`npm run typecheck` (`tsc --noEmit`) and `npm test` (`vitest run`) both exist
and pass. The "NOT YET ADDED / NOT YET INSTALLED" note in `CLAUDE.md` is stale.

### D3. `app.outlio.io` module routing
Modules are **siblings, not nested**: `app.outlio.io/dashboard` (Lead Engine
home), `/crm`, `/email`, `/flows`, `/reports`. This matches every comparable
product (HubSpot `app.hubspot.com/contacts`, Attio `app.attio.com`) and the
Constitution's `/crm/*` routes. Marketing stays on `outlio.io`.
*Rationale:* nesting CRM under `/dashboard/crm` produces longer URLs and
implies CRM is a sub-feature of Lead Engine, which it is not.

### D4. Two role axes
`profiles.role` continues to answer **"may this person use Outlio at all?"**
(platform access, suspension, admin). `workspace_memberships.role` answers
**"what may this person do inside this workspace?"** (owner/admin/manager/
setter/viewer). They are never merged.
*Rationale:* `profiles.role` is load-bearing for billing, suspension, the
extension bearer-token path and the admin gate. Overloading it with team RBAC
would couple team management to entitlement grants.

### D5. Entitlements come from `plans.limits`
Module flags (`crm_enabled`, `email_enabled`, `flows_enabled`,
`hubble_enabled`) and `workspace_member_limit` are added to the existing
`plans.limits` JSONB and validated in `planLimitsSchema`. No new plan tier, no
hardcoded prices, no second entitlement system.
*Rationale:* `CLAUDE.md` — "All plan limits come from `plans.limits` JSONB at
runtime. Never hardcode."

### D6. Two kinds of invitation
`invitation_codes` grants an **entitlement** to a stranger (redeem a code → get
a plan). `workspace_invitations` invites a **named person to a workspace** with
a role. Separate tables, separate flows, separate rate limits. They are never
merged.

### D7. Workspace backfill
Every existing user with a profile receives exactly one personal workspace on
migration, with themselves as `owner`. Idempotent, re-runnable.
*Rationale:* no user may be left workspace-less, and no existing behaviour may
change on deploy.

### D8. Hubble credits
Flow/CRM AI steps debit the **existing** credit tables via `consume_credit`.
No parallel credit ledger.

### D9. Two "team" surfaces, deliberately
`/dashboard/settings/team` is workspace **membership administration** — who is
in the account, what role they hold, invitations, seats. It sits beside billing
and security because that is what it is: an account setting.

`/crm/team` (M9 Phase 27) is the CRM **team performance** surface — leaderboard,
rollups, per-setter metrics. It arrives with reporting (M4) and reads the
activity stream.

*Rationale:* the M9 route list names `/crm/team`, which could be read as the
home for member management. Merging the two would put billing-adjacent
administration behind a CRM module that a workspace may not even be entitled
to, and would make membership unreachable whenever `crm` is switched off. Every
comparable product splits them the same way (HubSpot: Settings → Users & Teams
vs. Sales → Team performance).

### D10. Roles do not change what a `setter` can *see* until M2
`dataScope()` returns `assigned` for setters and viewers, and the callers apply
it. It is a rule, not an enforcement point — a policy layer cannot put a WHERE
clause on someone else's query. There is nothing to scope yet: no CRM record
exists. Every M2 query that returns workspace data MUST consult `dataScope`.

### D28. A collision needs ownership AND recent activity
`checkCollision` fires only when a teammate owns the contact *and* has touched
it within `active_within_days` (default 30).

*Rationale:* ownership alone is a filing decision. Half a CRM is assigned to
people who have never worked it, so firing on ownership would warn on every row
of the first import — and a guard people learn to click through protects
nothing. Company-level defaults to OFF for the same reason: in a 5,000-person
enterprise two setters in two departments is normal.

Warn is the default and blocking is opt-in, because a guard that stops work by
default gets switched off in week one.

### D27. Never raise SQLSTATE 40001 for an application conflict
`crm_move_opportunity_stage` rejects a stale optimistic lock with
`check_violation`, not `serialization_failure`.

*Rationale:* 40001 has protocol meaning — PostgREST reads it as a transient
conflict and RETRIES the request. An optimistic-lock rejection is the opposite
of transient: the caller holds a card that has since moved, and a retry fails
identically. 0076 used 40001 and the symptom was not an error but a HANG, until
the client timed out.

⚠️ **The local migration harness cannot catch this class of bug** — `psql` does
not retry. It is a client-protocol behaviour that only appears through
PostgREST, which is what the integration suite is for. Reserve 40001 for
genuine serialization conflicts a retry could actually resolve.

### D25. Money is `numeric`, never a float
`crm_opportunities.value_amount` is `numeric(14,2)`.

*Rationale:* binary floating point cannot represent 0.1, and a pipeline total
sums thousands of these. The error compounds until the forecast stops
reconciling with the deals behind it, and the bug surfaces as "the numbers are
slightly wrong" — the hardest kind to trace.

⚠️ **Correction to the first version of this decision.** supabase-js types
`numeric` as `number`, so a value cannot be kept as a string end-to-end. What
is STORED is exact; what PostgREST hands JavaScript is a double. That is fine
for one value and wrong for a total, so the rule is: **never sum these in JS,
aggregate in SQL.** Nothing computes a pipeline total yet — M4 Phase 10.5 will
— because doing it wrong is worse than not having it.

### D26. Optimistic locking ships with the schema, not with the Kanban
`crm_opportunities.version` and `crm_move_opportunity_stage` land in Phase 6
rather than Phase 7.

*Rationale:* two people dragging one card is the normal case in a shared
pipeline, not an edge case, and last-write-wins silently discards one of them.
Building the board against a store that already refuses stale writes is much
easier than retrofitting the check afterwards.

The version check doubles as the idempotency key M3 criterion 2 needs: a retry
of a move that already succeeded arrives with the OLD version and is refused,
so it cannot write a second activity.

### D22. Append-only is enforced by a trigger, not by grants
`crm_activities`, `crm_audit_logs` and `crm_merge_events` carry a BEFORE
UPDATE OR DELETE trigger that raises.

*Rationale:* grants stop the application. They do not stop a migration, a
support script, or the service role. M2 criterion 5 is "no update path
exposed", and a path nobody has taken yet is still exposed. 0074 declared
`crm_merge_events` append-only on grants alone; 0075 makes that true.

Two narrow escape hatches, both deliberate: GDPR erasure sets
`outlio.erasure` for its own transaction, and a DELETE is allowed when the
parent workspace is already gone — otherwise a workspace could never be
deleted, the same trap `guard_last_workspace_owner` documents.

### D23. Assignment is an activity, not a second table
The M2 brief lists `assignment_events` alongside `activities`. There is one
table: an `OWNER_ASSIGNED` row in `crm_activities`.

*Rationale:* A3 says ALL metrics derive from events. A parallel assignment
table would be a second source of truth for "who owned this and when", and the
two would disagree the first time one was written without the other.

### D24. Erasure outranks append-only
`crm_erase_contact` hard-deletes activities and SCRUBS merge snapshots. The
fact that two records became one is ours to keep and matters for attribution;
the copy of the person inside the snapshot is not.

*Contrast with `lead_keys`:* `lib/leads/dedupe.ts` keeps hashed keys after a
lead is purged, because a hash carries no readable personal data. A CRM
contact's row carries names, addresses and phone numbers, so the row goes.

An audit row recording that an erasure happened survives, carrying the
contact's id and nothing about the person — being unable to prove an erasure
was performed is its own compliance problem.

### D21. Blocking on three keys is COMPLETE, not a heuristic
Detection only compares pairs sharing a company, a phone number or an email
domain — never all pairs, which is O(n²).

That is provably exhaustive rather than a corner cut: in `lib/crm/dedupe.ts` a
name alone carries at most 55 against a threshold of 60, so every candidate
needs at least one corroborating signal, and those three are the only
corroborating signals that exist.

⚠️ **Adding a fourth corroborating signal to the scorer breaks this.**
`tests/unit/crm-dedupe.test.ts` asserts the ceiling the argument depends on.

Large blocks are sub-divided by a three-character surname prefix (so "ellis"
and "elliss" still collide) and anything still oversized is skipped and
*reported* in `blocksSkipped`, rather than silently producing a partial scan.

### D18. Name similarity is a GATE, not a weight
Company, phone and shared email domain only ever amplify a name that already
matches. Below a similarity of 0.62 a pair is not a candidate at any score.

*Rationale:* score those signals additively and every pair of colleagues
becomes a "duplicate" — they share a switchboard and an employer by
definition. The Duplicate Center fills with noise and the one real duplicate is
buried in it. A Center nobody trusts is worse than no Center.

A corollary: an identical name alone (weight 55) never reaches the threshold of
60. Two people in one workspace can genuinely both be called John Smith.

### D19. 100% is reserved for certainties
Only the two exact blocks — same mailbox, same canonical LinkedIn identity —
score 100. Every judgement is capped at 99, however many signals corroborate
it, so "100%" in the UI always means a certainty rather than a strong hunch.

### D20. Trigram similarity is Dice, not pg_trgm's Jaccard
`pg_trgm.similarity()` is `shared / (a + b - shared)`; `trigramSimilarity` is
`2·shared / (a + b)`.

*Rationale:* Jaccard badly underrates the commonest real defect — one mistyped
character in one word of a two-word name. "Samuel Ellis" vs "Samual Ellis"
scores 0.63 under Jaccard, barely above the gate, and 0.77 under Dice. A SQL
pre-filter using `similarity()` is still fine for BLOCKING, with a
correspondingly lower threshold, but the final score must always come from
`lib/crm/dedupe.ts`.

### D15. A batch is history; a list is a working set
`crm_lead_batches` records what one ingestion run contained, fixed forever —
it is the unit M4's funnel groups by (extracted → canonical → emailed →
replied → won). `crm_lists` is a set a person curates.

*Rationale:* conflating them means you cannot remove someone from a list
without rewriting what an import contained, and the funnel starts reporting
numbers that change retroactively.

### D16. Undo deletes only what an import created
`crm_batch_members.created_contact` is true only when that batch created the
contact. `crm_undo_batch` soft-deletes those and merely removes membership for
everyone else.

*Rationale:* a contact an import MATCHED already existed, and may since have
been emailed, assigned or moved through a pipeline. Deleting them because an
import that only recognised them was undone would destroy work nobody asked to
undo.

### D17. "Not a number" and "unknown country" are different answers
`normalizePhoneNumber` returns `invalid` for anything with fewer than six
digits, checked **before** the region branch, and `ambiguous_no_country` only
for a plausible number it cannot regionalize.

*Rationale:* without a country there is nothing to parse against, so every
unparseable string used to come back `ambiguous_no_country` — including "call
reception" and "n/a", which CSV phone columns are full of. Callers could not
tell a real number they should keep from prose they should drop, and prose
ended up in a phone field that a dialler, an export and a duplicate check all
have to pretend is a number.

### D13. `crm_companies` is not `companies`
They are different entities that share a word, and both stay.

| | Scope | Purpose |
|---|---|---|
| `companies` | per **user** | The Lead Engine's research unit. Deduped so a company fact is researched once per company, not once per employee (0043). Written by `link_leads_to_companies` on the live extraction path. |
| `crm_companies` | per **workspace** | The CRM account. Owned, human-edited, carries relationships, tags and custom fields. |

*Rationale:* two members of one workspace who each extract Acme must end up
with ONE CRM account and TWO research rows — one per user, because that is how
research spend is attributed and cached. One table could not do both without
either re-scoping the extraction pipeline's dedup (changing live Lead Engine
behaviour) or duplicating CRM accounts per member.

**The risk of two tables is drifting identity rules, and it is avoided the way
0043 already avoids it:** normalization lives in TypeScript and both tables
receive already-normalized values. There is one implementation of "what is this
company's domain". `crm_companies.source_company_id` links an account back to
the research row it came from; Phase 3 populates it.

The same reasoning applies to `crm_contacts` vs `extracted_leads`:
`extracted_leads` is the immutable record of what a saved page said,
`crm_contacts` is the living person. `source_lead_id` links them.

### D14. Phone is a duplicate candidate, never a block
`crm_contact_emails` has a unique index on `(workspace_id, identity_key)` —
one mailbox belongs to one person, enforced by the database because ingestion,
CSV import, the API and manual entry are four write paths and the one that
forgets is the one that creates the duplicate.

`crm_contact_phones` deliberately has **no** such index. An email address is a
mailbox; a phone number is routinely a switchboard. Ten colleagues legitimately
share one main line, and a unique index would either refuse the second person
or invite an importer to "merge" ten different people. Phase 4 treats a phone
match as a strong signal that raises a candidate for a human.

### D11. Stored value ≠ identity key
Every normalized contact field produces **two** values, and they are
deliberately different:

| | Purpose | Example |
|---|---|---|
| `address` / `e164` / `canonicalUrl` | What we **store and contact** | `j.doe+outlio@gmail.com` |
| `identityKey` | What we **compare** for dedup blocking | `jdoe@gmail.com` |

*Rationale:* those two addresses reach one mailbox, so dedup must fold them —
but sending to the folded form mails an address the person never gave us,
breaking their filters and any reply threading. Collapsing the two into one
field is a silent failure in both directions. **An `identityKey` must never
appear in a `To:` header.**

Folding is applied only where the provider **documents** the behaviour (Gmail
dots, `+` sub-addressing at a short allow-list of hosts). At an unknown
corporate domain nothing is folded: not folding leaves a duplicate a human can
merge, while folding wrongly destroys a person's record — and M2 Phase 4
forbids silently merging uncertain people.

### D12. A phone region is never guessed
A national-format number with no explicitly supplied country is stored and
displayed, but gets **no identity key** and never blocks a merge
(`reason: 'ambiguous_no_country'`). `defaultCountry` must come from an explicit
user choice — a CSV import mapping or a workspace setting — never a locale
header.
*Rationale:* `07400 123456` is a UK mobile and a valid landline in a dozen other
countries. Assuming a region silently rewrites the numbers of everyone outside
it. `lib/auth/profile-fields.ts` reached the same conclusion for sign-up.

---

### D29. The forecast is arithmetic, not a model

`crm_forecast_by_period` is `value × probability` grouped by close month, and
`crm_win_rates` is won ÷ closed. No inference, nothing metered, no credits. The
brief permits optional Hubble commentary on top, clearly labelled — that is
commentary ABOUT these numbers and must never become the source of them. **A
forecast a customer cannot reproduce by hand is one they cannot argue with, and
a forecast is exactly the thing people need to argue with.**

Three sub-decisions that a reader will otherwise assume are bugs:

- **Undated deals are returned under a NULL period**, not dropped and not
  bucketed into "this month". They are real pipeline, and a rep with a large
  undated pipeline has a forecasting problem the report should surface. The UI
  labels that row *not forecast*.
- **Win rates bucket by `closed_at`, not `created_at`.** Bucketing by creation
  would mean this quarter's rate kept changing for months as its deals closed.
- **Open deals are excluded from win rate entirely.** Counting them as
  not-yet-won drags every rate toward zero and makes a healthy pipeline look
  like failure.

Two more in the UI: a trend against a **zero base returns `null`**, never a
percentage (0 → 5 is not "+500%", and the page shows the previous figure
instead), and the previous window **never overlaps** the current one, or a
single shared day would let the same activity count on both sides.

### D30. Email accounts are their own table, not `integration_connections`

**This reverses earlier Ledger guidance**, which said M5 should extend
`integration_connections` rather than build a parallel system. That advice
predates the M5 detail. It is right about the CRYPTO and wrong about the ROW
SHAPE.

`integration_connections` carries `unique (user_id, provider)` — one Google
connection per user. Cold outbound needs MANY mailboxes per workspace, each
with its own schedule, limits, ramp and health. Relaxing that constraint is not
a small change, and the evidence is concrete: every existing read is
`.eq(user_id).eq(provider).maybeSingle()` (`lib/integrations/repository.ts`,
`google-repository.ts`) and `save_google_connection` upserts
`onConflict: 'user_id,provider'`. **The moment a user connected a second
mailbox, every export integration would throw on a two-row `maybeSingle()`.**

What IS shared: `lib/integrations/crypto.ts` (the AES-256-GCM envelope), the
`integration_secrets` storage pattern, and `integration_oauth_transactions` for
the OAuth dance in Phase 12. Sharing the part that carries security risk is the
point; sharing a shape that forbids the product's core cardinality is not.

### D31. Capabilities are derived from (provider, configuration), never declared

A lookup table keyed on provider alone cannot express the case the M5 brief
names: SMTP is send-only, but SMTP **with an IMAP companion** can read replies.
One provider, two capability sets, decided by configuration.

`Support` is a three-state (`supported` / `unsupported` / `unconfigured`)
rather than a boolean. "This provider can never do this" is a dead end;
"you have not set this up yet" is a prompt with a fix attached, and collapsing
them to `false` throws away the only actionable thing the UI can say.

Capabilities are computed from the non-secret `configuration` column ONLY, so
the campaign engine can ask "can this account read replies?" on a hot path
without decrypting anything — and a decrypt on a hot path is how credentials
reach logs and error traces.

### D32. A newly connected mailbox is `ramping`, never `ready`

`ready` asserts that readiness checks passed, and in Phase 11 none have run.
The conservative state is also the correct one: a brand-new mailbox sending at
full volume is exactly how a domain gets burned. Phase 13 promotes it.

### D33. SMTP is the first adapter, not Gmail — and Gmail is blocked on Google

The M5 brief orders adapters "Gmail / Microsoft 365 / SMTP(+IMAP) in safest
order based on existing Outlio OAuth infra (**Ledger evidence decides**)". The
evidence decides SMTP:

1. **There are no Google OAuth client credentials in this environment.**
   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are absent from `.env.local`, so
   even the existing Drive/Sheets integration cannot run locally. A Gmail
   adapter could not be exercised against Google at all, and the brief forbids
   inventing provider behaviour.
2. **The scopes are the real blocker.** The existing grant is `drive.file` +
   `spreadsheets`. Sending needs `gmail.send`; reply sync needs
   `gmail.readonly` or `gmail.modify`. **All three are RESTRICTED scopes**,
   requiring Google app verification plus an annual third-party CASA security
   assessment — real money and weeks of lead time, not an afternoon. This is a
   business decision the customer has to start now if Gmail is wanted at
   launch.
3. **Microsoft 365** needs an Entra app registration, and `Mail.Send` requires
   admin consent in most tenants.
4. **SMTP+IMAP needs none of it** — no OAuth, no verification, no restricted
   scopes — and is verifiable end to end today.

SMTP is also the adapter that exercises D31 hardest, since its reply support
depends on configuration rather than on the provider.

⚠️ **Gmail and Microsoft have NO registry entry rather than a stub.**
`providerFor()` returns `undefined` for them, so a caller must handle the gap
where it exists rather than discovering a placeholder throwing three layers
away.

### D34. Customer-supplied mail hosts are an SSRF surface

"Connect to this host and port and tell me whether it worked" is a port scanner
if the host may be internal — and the answer is readable from the connection
test's own error message. `lib/email/providers/smtp-address.ts` refuses private,
loopback, link-local, CGNAT and multicast ranges (v4 and v6, including
IPv4-mapped forms), refuses hosts carrying a scheme/userinfo/port/path, and
allows only real mail ports. Loopback is permitted outside production only, so
the integration test can reach a container — the same carve-out the existing
Google OAuth redirect check makes.

⚠️ **This is a hostname-shape check, not a complete SSRF defence.** A hostname
that RESOLVES to a private address defeats it, because resolution happens later
inside the socket layer. Closing that needs DNS pinned to the connection —
Ledger DR19.

### D35. STARTTLS is required on plaintext submission ports, not merely attempted

nodemailer's default silently continues in the clear when a server refuses to
upgrade, which would put the customer's password and every recipient address on
the wire in plaintext. `requireTLS` is set on ports 25/587. Localhost is exempt
so the integration test can run against a container with no certificate.

### D36. At-most-once delivery, not at-least-once

**The single most consequential decision in M5, and it is a product decision as
much as a technical one.**

Exactly-once delivery is not achievable across a network boundary. The real
choice is:

- **at-least-once** — retry when the outcome is unknown. Safe only with
  provider-side dedupe. **SMTP has no dedupe verb**: hand the same message to
  the same server twice and it is delivered twice, identical `Message-ID` or
  not. This is proven, not assumed, in `tests/integration/email-smtp.test.ts`.
- **at-most-once** — never retry when the outcome is unknown. A message can be
  lost.

For cold outbound the costs are wildly asymmetric. A duplicate email is a spam
complaint, a domain reputation hit, and a threat to every other mailbox on that
domain. A missed email is recovered by the sequence's next step.

So a message whose claim expires becomes `needs_verification` and is **never**
automatically requeued. `reap_expired_email_claims()` is that guarantee made
concrete, and it is what makes criterion 3 true: a restarted worker finds the
row already out of the queue.

⚠️ **Two things must never be added.** Do not claim inside the send loop, and
do not retry a claimed row in-process after an ambiguous failure — a timeout or
a dropped socket may well have been accepted upstream. A failure is retried
only when the provider stated plainly that nothing was sent
(`classifySmtpError` decides), and even then via a fresh claim.

### D37. The suppression check lives inside the claim

Checking in application code and then sending leaves a window in which someone
unsubscribes between the two. `claim_email_messages()` suppresses
do-not-contact recipients in the same statement that removes rows from the
queue, so a suppressed address is never handed to a worker at all.

`enqueueEmail` also checks, so a caller gets an immediate honest answer rather
than a row that quietly dies later. Neither check makes the other redundant.

**The first suppression reason wins.** If someone unsubscribed and later hard
bounced, `unsubscribed` is the fact that matters — it is a stated wish rather
than a delivery accident, and overwriting it would destroy the consent
provenance the customer may one day have to produce.

### D38. Sending windows store an IANA zone, never an offset

"09:00–17:00 Europe/London" must mean 09:00 local in both March and July, which
are different UTC instants. An offset captured at setup is silently wrong for
half the year, and the only symptom is mail arriving at 08:00 — early enough to
look automated, which is exactly what cold outbound must not look like.

The scheduler also walks forward in the **account's own calendar** rather than
adding 24h to a UTC instant: across a DST change a day is 23 or 25 hours.

## 14. Migrations added by the platform build

| # | File | Milestone | Contents |
|---|---|---|---|
| 0086 | `0086_email_messages.sql` | M5 P14 | `email_message_status`, `email_suppression_reason` enums; `email_messages` (content frozen after send by trigger, unique idempotency key per workspace), `email_suppressions`; `claim_email_messages()` (suppression check INSIDE the claim) and `reap_expired_email_claims()` (→ `needs_verification`, **never** back to `queued`). |
| 0085 | `0085_email_accounts.sql` | M5 P11 | `email_provider`, `email_account_scope`, `email_account_status` enums; `email_accounts` (many mailboxes per workspace, each with scope, schedule, limits, health) and `email_account_secrets` (service-role only, **no RLS policy at all**). Purely additive. |
| 0084 | `0084_crm_forecast.sql` | M4 P10.5 | `crm_forecast_by_period()` — weighted pipeline by expected close MONTH, with undated deals returned under a NULL period rather than dropped — and `crm_win_rates()` — won ÷ closed, bucketed by `closed_at`, open deals excluded, NULL rather than 0% when nothing closed. Two functions; no table touched, none replaced. |
| 0083 | `0083_crm_funnel.sql` | M4 P10 | `crm_batch_funnel()` — one batch from extracted through to won revenue, each step counted from the step above it so the funnel can only narrow — and `crm_pipeline_totals()`. |
| 0082 | `0082_reporting_aggregates.sql` | M4 P9 | `crm_reporting_daily` (day grain), `crm_reporting_runs`, `crm_rollup_activity_metrics()`, `crm_reconcile_reporting()`. ⚠️ The natural key is a `UNIQUE ... NULLS NOT DISTINCT` constraint over a surrogate `id`, NOT a primary key: `user_id` is NULL on a workspace-total row, and a PK would have made that column `NOT NULL` and the totals impossible to store. |
| 0081 | `0081_ingest_contact_created.sql` | M4 P9 | Replaces `crm_ingest_contacts` to write a `CONTACT_CREATED` activity inside the create branch. Found by opening a contact's detail page and seeing an EMPTY timeline for a contact that demonstrably existed — every ingested contact was missing its own creation event, so no funnel could start from one. |
| 0080 | `0080_crm_contact_search.sql` | M3 P8 | `pg_trgm` GIN indexes on contact and company name so search does not table-scan. |
| 0079 | `0079_crm_collision_guard.sql` | M3 P8 | `crm_collision_settings`, `crm_reassignment_requests`, `crm_record_collision_override()`. |
| 0078 | `0078_crm_realtime.sql` | M3 P7 | Adds the CRM tables to the realtime publication and sets `REPLICA IDENTITY FULL` so a board subscriber can tell WHICH row changed. |
| 0077 | `0077_fix_move_errcode.sql` | M3 P6 | Replaces `crm_move_opportunity_stage`. 0076 raised SQLSTATE 40001 for a stale lock; PostgREST retries 40001, so the rejection never reached the client and the request hung until it timed out. Now `check_violation`. |
| 0076 | `0076_crm_opportunities.sql` | M3 P6 | `crm_pipelines`, `crm_pipeline_stages`, `crm_opportunities` (with `version` for optimistic locking), `crm_opportunity_stage_history` (append-only); `crm_move_opportunity_stage()`. Enums `crm_opportunity_status`, `crm_stage_kind`. |
| 0075 | `0075_crm_operations.sql` | M2 P5 | `crm_activities` (append-only, frozen attribution), `crm_tasks`, `crm_notes`, `crm_note_mentions`, `crm_notifications`, `crm_notification_preferences`, `crm_audit_logs`; `crm_guard_append_only()` and `crm_erase_contact()`. Adds the append-only trigger to `crm_merge_events`. |
| 0074 | `0074_crm_deduplication.sql` | M2 P4 | `crm_duplicate_candidates` (one row per pair, `record_a_id < record_b_id` enforced), `crm_merge_events` (append-only), `crm_contacts.merged_into_id`, and `crm_merge_contacts()` — atomic, deadlock-safe, moves every child table. |
| 0073 | `0073_fix_ingest_ambiguity.sql` | M2 P3 | Replaces `crm_ingest_contacts`. 0072 shipped it with four unqualified `contact_id` references that were ambiguous with the `RETURNS TABLE` output column — an error Postgres raises at RUNTIME, not at creation, so the migration applied cleanly and failed on the first real call. |
| 0072 | `0072_crm_ingestion.sql` | M2 P3 | `crm_lead_batches`, `crm_batch_members`, `crm_lists`, `crm_list_members`, `crm_import_jobs`; `crm_ingest_contacts()` (set-based atomic upsert) and `crm_undo_batch()`; RLS on all five. **Additive — no column added to an existing table, no function replaced.** |
| 0071 | `0071_crm_core_identity.sql` | M2 P2 | `crm_record_source`, `crm_custom_field_type`, `crm_custom_field_entity` enums; `crm_companies`, `crm_contacts`, `crm_contact_emails`, `crm_contact_phones`, `crm_contact_company_relationships`, `crm_tags`, `crm_contact_tags`, `crm_custom_field_definitions`, `crm_custom_field_values`, `crm_saved_views`; RLS on all ten. **Purely additive — touches no existing table and replaces no function.** |
| 0070 | `0070_workspaces.sql` | M1 | `workspace_role` enum; `workspaces`, `workspace_memberships`, `workspace_invitations`, `workspace_feature_flags`; `is_workspace_member()`, `workspace_role_of()`, `redeem_workspace_invitation()`, `protect_workspace_columns()`, `guard_last_workspace_owner()`; RLS on all four; `handle_new_user()` extended; idempotent backfill |

---

## 15. Phase status

| Milestone | Phase | Status |
|---|---|---|
| M0 | Repository discovery & Ledger | ✅ Complete (2026-08-30) |
| M1 | Workspace, auth, roles, permissions, entitlements | ✅ Complete (2026-08-30) — see below |
| M2 | CRM core: identity, ingestion, dedup, operations | ✅ **Complete** (2026-08-30). Two UIs deferred: DR12, DR14 |
| M3 | Opportunities, pipelines, Kanban, collision guard | ✅ **Complete** (2026-08-30) |
| M4 | CRM reporting foundation & dashboards | ✅ **Phases 9, 10 and 10.5 complete.** 6 of 7 criteria met; criterion 3 (auto-reply exclusion) belongs to M6, where the pre-filter runs before anything is written |
| M5 | Email foundation | 🔨 **Phases 11 ✅, 12 ✅ (SMTP+IMAP), 14 ✅ (message engine).** 4 of 5 criteria met. Phase 13 (readiness) is the remainder; Gmail/Microsoft adapters blocked on Google verification + CASA (D33) |
| M6 | Campaigns, composer, replies, email reporting | ⬜ Not started |
| M7 | Flow engine, Hubble boundary, visual builder | ⬜ Not started |
| M8 | Integrations, Calendly, unified inbox | ⬜ Not started |
| M9 | Onboarding, UI refinement, hardening | ⬜ Not started |

### M4 acceptance criteria

| # | Criterion | Status |
|---|---|---|
| 1 | Dashboard numbers == raw activity counts for a seeded scenario | ✅ `tests/integration/crm-metrics.test.ts` — 4 emails to 2 people gives `emails_sent = 4`, `contacts_emailed = 2`, reply rate 0.50, and `reconcileReporting` returns `[]` |
| 2 | Activities before reassignment still credit the original actor | ✅ same file — both contacts are handed to another user, the range is recomputed from scratch, and every one of the original setter's numbers is unchanged while the new owner gets none of the work |
| 3 | Auto-replies and bounces excluded from reply-rate metrics | ⬜ M6 — the deterministic pre-filter runs BEFORE anything is written, so an OOO is never recorded as `EMAIL_REPLIED` in the first place |
| 4 | Batch funnel ties source batch to revenue | ✅ `crm_batch_funnel` — 5 extracted → 3 canonical → 2 engaged (from four emails to two people) → 1 replied → 1 won → 10000.50, proven to narrow rather than widen |
| 5 | Report queries paginated/indexed | ✅ day-grain aggregate with `(workspace_id, metric, day desc)`; reads never scan the event stream |
| 6 | Forecast reconciles with raw opportunity data | ✅ `crm_forecast_by_period` grouped by close month, reconciled TWICE: the harness smoke gives forecast total `49900.00` == raw `49900.00`, and a check against the live database gives `12500.50` open / `1250.05` weighted from `crm_forecast_by_period` matching `crm_pipeline_totals` exactly. Undated deals are returned under a NULL period rather than dropped, and `crm_win_rates` gives the historical rate over deals CLOSED in the window |
| 7 | Export matches on-screen numbers; blocked for unauthorised roles | ✅ `lib/crm/report-export.ts` + `/crm/reports/export`. Verified by DOWNLOADING the files, which is what caught the real defect: `toCsv` drops a column empty on every row, so `Reply rate` vanished from the one-row personal report and the file stopped listing a metric the screen showed. Every column is now pinned and `tests/unit/crm-report-export.test.ts` (13) holds it. `report.export` is checked in the ROUTE, not on the button; `my_activity` needs only `report.own.view` because it contains only the reader's own figures |

### M5 acceptance criteria

| # | Criterion | Status |
|---|---|---|
| 1 | Secrets unreadable via any API after save; encryption verified | ✅ Proven twice. In Postgres, `supabase/smoke/0085_email_accounts.sql` runs four read shapes as `authenticated` — direct, joined, by `secret_reference`, column-only — and all four are DENIED. Against the LIVE PostgREST API with the publishable key, all four including a resource embed return `401 / 42501`. The result is `permission denied` rather than an empty set: the grant refuses before RLS is consulted, so two independent layers hold. Encryption is `lib/integrations/crypto.ts`, already covered by `tests/unit/integration-crypto.test.ts`; the one uncovered branch (unknown version, no fallback) is pinned in `tests/unit/email-accounts.test.ts` |
| 2 | Capability model gates features per provider (SMTP w/o IMAP reports no replies) | ✅ `lib/email/capabilities.ts` + 15 tests, and **enforced by the adapter**: `syncReplies` on an account with no IMAP host throws `EmailCapabilityError` rather than returning an empty list that would read as "no replies yet" (`tests/integration/email-smtp.test.ts`). SMTP alone reports `replies: unconfigured`; adding `imapHost` promotes it to `supported`; an SMTP *host* alone does not, because submission settings say nothing about reading. `webhookEvents` stays `unsupported` for SMTP even with IMAP — IMAP is polling and no configuration would give a plain mail server a push channel |
| 3 | Kill-and-retry on the send worker produces exactly one delivered message | ✅ `tests/integration/email-send-worker.test.ts` — a message is claimed, the provider ACCEPTS it, and the process dies before recording; the claim is reaped to `needs_verification` and a restarted worker sends nothing. **Counted at the mail server, not in our own rows:** GreenMail logs exactly ONE client submission of that subject. Guaranteed by at-most-once (D36), not by dedupe |
| 4 | A suppressed recipient is never sent to, for every suppression reason | ✅ All five reasons, each tested twice — refused at enqueue AND refused at claim for a message queued BEFORE the suppression existed, which is the race the in-claim check closes. Zero suppressed subjects reach the mail server. Suppression is proven not to leak across workspaces (`0086` smoke) |
| 5 | Readiness state transitions + domain rollup tested; ramp limits enforced | ⬜ Phase 13 — the nine states, the `from_domain` index and the scheduler that will enforce ramp all exist; nothing computes readiness yet |

### M3 acceptance criteria

| # | Criterion | Status |
|---|---|---|
| 1 | Two simultaneous drags of the same card resolve deterministically | ✅ `tests/integration/crm-opportunities.test.ts` — a real race via `Promise.allSettled`, not a sequential stand-in: one fulfils, one rejects with `StaleOpportunityError`, the board shows exactly one of the two moves, and there is one activity and one history row |
| 2 | Stage change emits exactly one activity, verified under retry | ✅ same file — a retry carries the old version and is refused, leaving the activity count at one. ⚠️ The "one domain event" half is Ledger DR15: there is no publisher yet |
| 3 | Collision fires at contact AND company level per config; overrides audited | ✅ `tests/integration/crm-collision.test.ts` (21) — including the negatives: ownership alone does not fire, a dormant contact does not fire, and company level says nothing until the workspace turns it on |
| 4 | Kanban paginates; never loads the full pipeline | ✅ `getBoard` returns a capped page per column plus a true total; tested |

**The CRM surface is live and verified in the browser** against 44 real
contacts ingested from two of the owner's own extractions. The contacts list,
its pagination (25 + 19 across two pages), trigram search and the detail page
with its timeline were all confirmed rendering. The PIPELINE board still has
not been seen with deals on it, because no opportunities exist yet.

### M2 acceptance criteria

| # | Criterion | Status |
|---|---|---|
| 1 | Importing the same file/batch twice → zero new contacts | ✅ `tests/integration/crm-ingestion.test.ts` — proven for BOTH paths: re-ingesting an extraction reuses the batch and matches all three people; re-running a CSV import creates zero and matches two |
| 2 | Normalization unit tests pass for email/phone/LinkedIn/domain edge cases | ✅ `crm-normalize.test.ts` (66) + `crm-custom-fields.test.ts` (41) + `crm-csv-import.test.ts` (31) |
| 3 | Merge preserves child records; concurrent merge fails safely | ✅ `tests/integration/crm-duplicates.test.ts` — every child table moves, collisions collapse rather than duplicate, the snapshot records what was lost, and a second merge of the same pair raises `MergeConflictError` |
| 4 | Duplicate Center shows reasons + confidence | ✅ `crm-dedupe.test.ts` (35) + `crm-duplicates.test.ts` — nothing is flagged without both, and reasons carry no schema jargon |
| 5 | Activity rows immutable | ✅ `tests/integration/crm-operations.test.ts` — UPDATE and DELETE both refused **from the service role**, rows untouched, merge history equally protected |
| 6 | GDPR erasure removes contact + PII cascade | ✅ same file — contact, emails, phones, activities, notes, tasks and notifications all gone; the audit proof survives and is asserted to contain neither the name nor the address |
| — | Attribution survives reassignment | ✅ same file — the contact is reassigned and `owner_user_id_at_event` still names the original owner |
| — | One person = one contact per workspace | ✅ `crm-identity.test.ts` (25), enforced by partial unique indexes |
| — | Cross-workspace isolation on all CRM tables | ✅ `crm-identity.test.ts` + `workspace-tenancy.test.ts`, with positive controls |
| — | Import rollback / undo | ✅ `crm-ingestion.test.ts` — deletes only what an import created, never a contact it merely matched |

### M1 acceptance criteria

| # | Criterion | Status |
|---|---|---|
| 1 | Policy tests cover every role × resource, allow **and** deny | ✅ `tests/unit/workspace-permissions.test.ts` — 5 roles × 40 permissions, generated, plus a completeness test that fails if a permission is added without a matrix row |
| 2 | Tenancy isolation: no cross-workspace reads/writes | ✅ `tests/integration/workspace-tenancy.test.ts` — 26 tests against the live project. Alice cannot read or write Bob's workspace, memberships, invitations or feature flags; positive controls confirm she can reach her own. |
| 3 | Invitation flow end-to-end with role selection | ✅ Issue → link → `/join/[token]` → atomic redeem → membership. Roles chosen from `assignableRoles(actor)`. |
| 4 | Entitlement toggle blocks at the **API** level, not just UI | ✅ `decidePermission` checks the module before the role; `assertWorkspacePermission` throws `ERR_FORBIDDEN` before any query runs. Tested both directions. |
| 5 | Ledger updated | ✅ This document. |

---

## 16. Deferred requirements

Recorded, never dropped.

| # | Requirement | Origin | Deferred to | Reason |
|---|---|---|---|---|
| DR1 | Teams (membership, team-scoped visibility, report rollups) | M1 | M4 | Teams only become observable when reporting rollups exist. `team_id_at_event` is reserved in M2's activity schema so no rewrite is needed. |
| DR2 | Invitation delivery by email | M1 | M5 | No transactional email sender is connected yet. The inviter copies the link; the token is shown once and stored only as a SHA-256. |
| DR3 | Long-running worker container | M0 Q2 | M5 | `after()` is sufficient until email scheduling needs a real scheduler. |
| DR4 | Native mobile app | M9 v2.1 | — | Explicitly dropped by the brief. Responsive mobile web only. |
| DR5 | `workspace_id` on Lead Engine tables | M0 Q4 | M2 | Decided when CRM ingestion defines the boundary. 0070 touches no existing table. |
| DR6 | Workspace audit log for membership changes | M1 | M2 Phase 5 | M2 specifies `audit_logs` alongside `activities` with `actor_user_id` / `owner_at_event` / `team_at_event`. Building a half-shaped version in M1 guarantees a rewrite. Role changes and removals are **not** audited until then. |
| DR7 | WhatsApp Business API integration | M8 v2.1 | M8 Phase 25 | Framework candidate, customer's own account. Not committed by the brief. |
| DR8 | VoIP / dialer adapter for call logging | M8 v2.1 | M8 Phase 25 | Adapter candidate. Never invent telephony capability. |
| DR9 | Ownership transfer flow | M1 | M2 | The `workspace.transfer_ownership` permission and the last-owner guard exist; the UI does not. An owner can promote a second owner only via support today. |
| DR10 | `crm_saved_views.definition` validation | M2 P2 | M2 P3 | Its schema IS the list query language. Inventing one before the query builder exists would mean guessing. Nothing reads the column until then; when it does, it must validate on READ as well as write — a stored filter is untrusted input however it got there. |
| DR19 | DNS-pinned connection for mail hosts (full SSRF defence) | M5 P12 | M9 / hardening | `assertSafeMailEndpoint` blocks literal private addresses and non-mail ports, but a hostname that RESOLVES to a private address still gets through, because resolution happens inside the socket layer. Closing it means resolving first, checking the resolved address, and connecting to that exact IP. |
| DR18 | XLSX export writer | M4 P10.5 | M9 | `lib/export/sanitize.ts` references an XLSX writer that was never built, and the project has NO spreadsheet library. Adding one is a dependency decision, not something to slip into a reporting phase — SheetJS has had advisories and a licence change, ExcelJS is heavy. CSV opens in every spreadsheet program; XLSX would only add formatting. |
| DR16 | Collision guard UI on the OUTREACH path, and the settings page | M3 P8 | M6 / M9 | The ASSIGN path is done: `/crm/contacts/[id]` shows the warning, refuses an unacknowledged reassignment, records the override and offers a reassignment request. What remains is the first-outreach check (there is no outreach surface until M6) and a screen for editing the modes — until then they are changed in `crm_collision_settings` directly. |
| DR15 | A real domain-event bus | M3 P6 | M7 | A3 wants normalized domain events (`crm.opportunity.stage_changed`, …) powering Flows, Reports, Notifications, Realtime and Integrations. Today `crm_activities` IS the event record, written in the same transaction as the change. That satisfies "exactly one activity" but there is no PUBLISHER yet, so nothing can subscribe. The Flow engine in M7 is what needs one; until then a consumer would have nothing to consume. |
| DR14 | Duplicate Center UI (four tabs, side-by-side merge screen) | M2 P4 | M2 P5 / M9 | Detection, scoring, listing, ignore and merge are complete and tested. Only the screens are outstanding. |
| DR12 | CSV import UI (upload, mapping screen, validation report, undo button) | M2 P3 | M2 P3 (next) | The engine — parse, suggest mapping, validate, plan, ingest, undo — is complete and tested. Only the screens are outstanding. |
| DR11 | Custom fields on companies and opportunities | M2 P2 | M2 P5 / M3 | The `crm_custom_field_entity` enum and the values table already carry all three entities, so no migration is needed later — only the UI and the write path. |

---

## 17. Known issues

| # | Issue | Impact |
|---|---|---|
| KI1 | GitLab mirror is stale and diverged. | Cosmetic; GitHub is authoritative per D1. |
| KI2 | Paddle tables and code remain alongside FastSpring. | None functionally; cleanup candidate. |
| KI3 | No `hubble.execute()` boundary. | Blocks M7 credit accounting until introduced. |
| ~~KI4~~ | ~~Migration 0070 unapplied.~~ **Resolved 2026-08-30.** Applied; `npm run db:types` regenerated the types; `lib/workspaces/db.ts` deleted. Backfill verified against the live project: 61 profiles → 61 workspaces → 61 owner memberships, no profile without one, no user in two. | — |
| KI5 | No plan sells more than one seat (Q6), so the invite flow is reachable but always refused. | Team features are dark until seat counts are set on `plans.limits`. |
| KI6 | Ownership cannot be transferred and a second owner cannot be created (DR9). | A sole owner can never leave their workspace. Support-only until M2. |
| KI10 | **Every RLS assertion in the local migration harness was vacuously true until 0085.** `auth.uid()` was stubbed to return a constant NULL, so a policy that denies everyone passes a test expecting a member to see their own rows — both sides are empty. | **Fixed.** The stub now reads the `sub` claim from `request.jwt.claims` like the real function. Verified by the fix changing behaviour: 0085's policy assertions failed until the policy was correct. No earlier smoke test used `set local role authenticated`, so nothing previously verified was affected. |
| KI9 | **The forecast and win-rate UI has never been rendered with data in a browser.** The SQL is verified twice over (harness smoke and a live-database reconciliation), the readers typecheck and the page builds, but the owner's workspace has 0 opportunities — the earlier pipeline seed created the "Sales" pipeline and its 6 stages and no deals — and the preview session had expired, so only the EMPTY states of the forecast table and the win-rate table could be reached. | Same gap as the pipeline board. Seed a few opportunities into a workspace and open `/crm/reports`; three UI defects in this build were found only by opening a page. |
| KI8 | **The remote migration-history table is stale from 0068 onward.** `supabase migration list` shows 0001–0067 recorded remotely; 0068–0073 are applied to the schema but absent from history, because every one of them was applied by hand in the SQL editor, which records nothing. | ⚠️ **`supabase db push` is UNSAFE on this project.** It would try to replay 0068–0073, including the FastSpring migrations, whose idempotency is unverified. Apply by hand and verify, or repair the history table first. |
| KI7 | `tests/integration/signup-ip-gate.test.ts` reserves real signup IPs against the live project and fails when the suite is run repeatedly from one machine — the gate blocks its own runner. Pre-existing, confirmed by stashing this branch. | 3 tests fail on a re-run. Use `npx vitest run tests/unit` for iteration; the gate's claims age out. |

---

## 18. Test status

`npx vitest run tests/unit` — **1,870 passed, 0 failed**, 104 files. Integration adds the SMTP adapter and the send worker, both run against a real mail server in Docker.
`npm run typecheck` passes. `npm run lint` reports 0 errors (95 pre-existing
warnings, all in generated or vendored files). `npm run build` passes.

⚠️ **`npm test` runs the live integration suite too**, and 3 tests in
`tests/integration/signup-ip-gate.test.ts` fail on a machine that has run the
suite several times in quick succession — the signup IP gate blocks its own
test runner. **Verified pre-existing:** the same 3 fail with this branch's
changes stashed. See [KI7](#17-known-issues).

M1 added 270 tests across two files:

| File | Covers |
|---|---|
| `tests/unit/workspace-permissions.test.ts` | 5 roles × 40 permissions allow/deny, non-member denial, the setter boundary by name, entitlement gating, `dataScope`, `canManageRole`, `assignableRoles` |
| `tests/unit/workspace-invitations.test.ts` | Token uniqueness/shape/hashing, constant-time comparison, TTL, email normalization, module resolution, seat limits |

M1's database behaviour is covered by:
`npx vitest run tests/integration/workspace-tenancy.test.ts` — **26 passed**,
covering what only exists in Postgres: the RLS policies, `handle_new_user()`,
`redeem_workspace_invitation()` (invalid / wrong_email / expired / revoked /
seat_limit / ok / already_member / burned), `guard_last_workspace_owner()` and
`protect_workspace_columns()`.

---

## 19. Cost-increasing dependencies

None added by M0 or M1. No new vendor, no new runtime, no new hosted service.
Rate limiting, queues and audit all remain in Postgres.

---

## 20. Metric definitions (M4 Phase 9)

⚠️ **WRITTEN BEFORE THE CODE, DELIBERATELY.** The M4 brief requires it, and the
reason is that a metric is a definition first and a query second. "Reply rate"
sounds unambiguous until two dashboards disagree, and by then both have
shipped. Everything in `lib/crm/metrics.ts` implements exactly what is written
here; if the two ever disagree, THIS is wrong and must be corrected first.

### The three attribution rules

1. **Credit the ACTOR for work.** "Emails sent by Sam" counts events where
   `actor_user_id = Sam`.
2. **Credit the OWNER AT EVENT TIME for outcomes.** "Sam's pipeline" counts
   events where `owner_user_id_at_event = Sam`. ⚠️ Never
   `crm_contacts.owner_user_id` — that is the CURRENT owner, and using it makes
   last quarter's numbers move when a book is reassigned.
3. **Bucket by `occurred_at`, never `created_at`.** Ingested history happened
   before we recorded it; a funnel that buckets by `created_at` puts a year of
   backfilled events in the week of the import.

### Setter metrics

| Metric | Formula | Notes |
|---|---|---|
| Contacts assigned | `count(distinct contact_id)` where `activity_type = 'OWNER_ASSIGNED'` and `metadata->>'to' = user` | The event, not the current column, so a reassignment away does not erase the fact it happened |
| Engagements | `count(*)` where `activity_type in (ENGAGEMENT, OPENER_SENT, PERSONALIZED_DM, FOLLOW_UP)` and `actor_user_id = user` | |
| Openers sent | `count(*)` where `activity_type = 'OPENER_SENT'` | |
| Personalized DMs | `count(*)` where `activity_type = 'PERSONALIZED_DM'` | |
| Emails sent | `count(*)` where `activity_type = 'EMAIL_SENT'` | The event count, not the recipient count |
| **Contacts emailed** | `count(distinct contact_id)` where `activity_type = 'EMAIL_SENT'` | ⚠️ DISTINCT. Four emails to one person is one contact emailed |
| Replies | `count(distinct contact_id)` where `activity_type = 'EMAIL_REPLIED'` | ⚠️ Distinct, and auto-replies are never written as this type — see below |
| **Reply rate** | `replies / contacts_emailed` | ⚠️ Denominator is CONTACTS EMAILED, not emails sent. Otherwise a four-step sequence quarters the rate of a team that follows up properly |
| Follow-ups | `count(*)` where `activity_type = 'FOLLOW_UP'` | |
| Qualified | `count(distinct contact_id)` where `activity_type = 'QUALIFIED'` | |
| Calls booked | `count(*)` where `activity_type = 'CALL_BOOKED'` | |
| Calls held | `count(*)` where `activity_type = 'CALL_HELD'` | Distinct from booked: no-shows are the number that matters |
| Tasks completed | `count(*)` where `activity_type = 'TASK_COMPLETED'` | |
| Opportunities created | `count(*)` from `crm_opportunities` where `created_by = user` | |
| **Pipeline value** | `sum(value_amount)` where `status = 'open'`, **in SQL** | ⚠️ Ledger D25: never summed in JavaScript |
| Weighted pipeline | `sum(value_amount * probability / 100)` where `status = 'open'` | The forecast (Phase 10.5) |
| Won deals | `count(*)` where `status = 'won'`, bucketed by `closed_at` | |
| Won revenue | `sum(value_amount)` where `status = 'won'` | |

### What is deliberately NOT counted

- **Auto-replies and bounces never count as replies** (M4 criterion 3). The
  deterministic OOO/autoresponder pre-filter in M6 Phase 17 runs BEFORE
  anything is written, so an out-of-office is never recorded as
  `EMAIL_REPLIED` in the first place. Excluding it at read time would mean
  every report had to remember to; excluding it at write time means none of
  them can forget.
- **`COLLISION_OVERRIDE` is not an engagement.** It is an audit event that
  happens to live on the timeline.
- **`CONTACT_CREATED` is not work.** It marks the funnel's first step and
  nothing else.

### Lead-batch funnel

Each step is `count(distinct contact_id)` over contacts in the batch, so a
person counted at one step is counted at every later step they reach.

| Step | Source |
|---|---|
| Extracted | `crm_lead_batches.rows_seen` — the only step NOT from the event stream, because a row that identified nobody never became a contact |
| Canonical contacts | `crm_batch_members` count |
| With a valid email | contacts in the batch having a `crm_contact_emails` row |
| Assigned | `crm_contacts.owner_user_id is not null` |
| Emailed or engaged | distinct contacts with `EMAIL_SENT` or an engagement type |
| Replied | distinct contacts with `EMAIL_REPLIED` |
| Qualified | distinct contacts with `QUALIFIED` |
| Call booked | distinct contacts with `CALL_BOOKED` |
| Opportunity | distinct contacts with an opportunity |
| Won / revenue | opportunities `status = 'won'`, count and `sum(value_amount)` |

### Period bucketing

Aggregates are stored **per day, per workspace, per user**, and any longer
period is a sum of days. A month is not stored separately: storing both means
they can disagree, and the day grain is the only one that can answer an
arbitrary date range.

Days are bucketed in **UTC**. ⚠️ A workspace in Sydney will see its day
boundaries shifted; per-workspace timezone is deferred and recorded, because
the fix belongs with a workspace settings surface rather than hidden in a
rollup.
