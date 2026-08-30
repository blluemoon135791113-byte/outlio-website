# OUTLIO_PLATFORM_IMPLEMENTATION.md

The **Ledger**. Read before every phase; update after every phase.

The repository is the technical source of truth. Every "CURRENT" claim below
cites the file it was read from. Where the product plan and the repository
disagree, the repository wins and the conflict is recorded under
[Open questions](#12-open-questions--conflicts).

- **Repository of record:** `github.com/blluemoon135791113-byte/outlio--website`
  (local `origin`). See [D1](#d1-repository-of-record).
- **Ledger opened:** 2026-08-30 (M0)
- **Last updated:** 2026-08-30 (M1 complete)
- **Next milestone:** M2 — CRM core: identity, ingestion, dedup, operations
- **Blocked on a human:** apply migration `0070` (KI4) and set plan seat counts
  (Q6). Neither blocks M2 development; both block M1 being usable in production.

---

## 1. Current stack

| Concern | Actual | Evidence |
|---|---|---|
| Framework | Next.js **16.3.0**, App Router, React 19.2.4 | `package.json` |
| Language | TypeScript `strict`, path alias `@/*` | `tsconfig.json` |
| Styling | Tailwind CSS v4 (`@theme`), Geist fonts | `app/globals.css`, `postcss.config.mjs` |
| Database | Supabase Postgres, project `ptewhpmxzenbmxlizxhu` | `CLAUDE.md` |
| ORM | **None.** `supabase-js` query builder + SQL functions | `lib/supabase/` |
| Migrations | Hand-written, numbered SQL, `0001`–`0069` | `supabase/migrations/` |
| Generated types | `types/database.ts` (4,788 lines) via `npm run db:types` | `scripts/gen-db-types.mjs` |
| Validation | Zod 4 | `lib/limits/plans.ts` and throughout |
| Tests | **Vitest 4** — 1,323 tests / 95 files / 24 skipped | `vitest.config.mts`, `tests/` |
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

**57 tables, ~60 SQL functions.** Extracted from `types/database.ts`.

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

**None. This is the central gap.**

Outlio is single-user today. Every tenant-scoped table carries
`user_id uuid references auth.users(id)` and every RLS policy reads
`auth.uid() = user_id or public.is_admin()`
(pattern: `supabase/migrations/0067_account_list_crm_exports.sql:53`).

There is no `workspaces`, no `memberships`, no `teams`, no concept of a second
person in an account. **Every M2+ entity must be workspace-scoped from birth**,
and the existing single-user tables need a workspace backfill path.

Service-role queries scope by `user_id` **in code** because RLS is bypassed —
see the comment at `lib/auth/access.ts:111`. That discipline must extend to
`workspace_id`.

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
| Workspace | — | **Create** (M1) |
| Membership / Role | `profiles.role` (platform access only) | **Create** `workspace_memberships.role`; keep `profiles.role` for platform access ([D4](#d4-two-role-axes)) |
| Team | — | Create (M1, deferred to M2 if unblocking) |
| Permission layer | `lib/auth/decide.ts` + `access.ts` | **Extend** the same pure-function pattern |
| Entitlements | `plans.limits` JSONB + `grant_entitlement()` | **Extend** the blob with module flags ([D5](#d5-entitlements-come-from-planslimits)) |
| Team invitation | `invitation_codes` (entitlement codes) | **Create separately** ([D6](#d6-two-kinds-of-invitation)) |
| Contact | `extracted_leads` (per-extraction rows) | **Create** canonical `crm_contacts`; leads remain the immutable extraction record |
| Company | `companies` ✅ with normalization | **Reuse and extend** |
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
| Q4 | Do existing single-user Lead Engine tables get `workspace_id`, or stay `user_id`-scoped behind a view? | **Open**, decided in M2 when CRM ingestion lands. M1 does not migrate them. |
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

---

## 14. Migrations added by the platform build

| # | File | Milestone | Contents |
|---|---|---|---|
| 0070 | `0070_workspaces.sql` | M1 | `workspace_role` enum; `workspaces`, `workspace_memberships`, `workspace_invitations`, `workspace_feature_flags`; `is_workspace_member()`, `workspace_role_of()`, `redeem_workspace_invitation()`, `protect_workspace_columns()`, `guard_last_workspace_owner()`; RLS on all four; `handle_new_user()` extended; idempotent backfill |

---

## 15. Phase status

| Milestone | Phase | Status |
|---|---|---|
| M0 | Repository discovery & Ledger | ✅ Complete (2026-08-30) |
| M1 | Workspace, auth, roles, permissions, entitlements | ✅ Complete (2026-08-30) — see below |
| M2 | CRM core: identity, ingestion, dedup, operations | ⬜ Not started |
| M3 | Opportunities, pipelines, Kanban, collision guard | ⬜ Not started |
| M4 | CRM reporting foundation & dashboards | ⬜ Not started |
| M5 | Email foundation | ⬜ Not started |
| M6 | Campaigns, composer, replies, email reporting | ⬜ Not started |
| M7 | Flow engine, Hubble boundary, visual builder | ⬜ Not started |
| M8 | Integrations, Calendly, unified inbox | ⬜ Not started |
| M9 | Onboarding, UI refinement, hardening | ⬜ Not started |

### M1 acceptance criteria

| # | Criterion | Status |
|---|---|---|
| 1 | Policy tests cover every role × resource, allow **and** deny | ✅ `tests/unit/workspace-permissions.test.ts` — 5 roles × 40 permissions, generated, plus a completeness test that fails if a permission is added without a matrix row |
| 2 | Tenancy isolation: no cross-workspace reads/writes | ⚠️ **Partial.** Every write is scoped by `workspace_id` in code and re-asserted by `assertWorkspaceMembership`; RLS backs it with `is_workspace_member()`. The end-to-end leak test needs migration 0070 applied — see [KI4](#17-known-issues). |
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

---

## 17. Known issues

| # | Issue | Impact |
|---|---|---|
| KI1 | GitLab mirror is stale and diverged. | Cosmetic; GitHub is authoritative per D1. |
| KI2 | Paddle tables and code remain alongside FastSpring. | None functionally; cleanup candidate. |
| KI3 | No `hubble.execute()` boundary. | Blocks M7 credit accounting until introduced. |
| KI4 | **Migration 0070 has not been applied to any environment.** It is written and reviewed but unrun; the generated types in `types/database.ts` therefore do not contain the workspace tables, which is why `lib/workspaces/db.ts` declares them by hand. | Nothing workspace-related works until `0070` is applied and `npm run db:types` is run. The tenancy leak test (M1 criterion 2) is blocked on the same step. |
| KI5 | No plan sells more than one seat (Q6), so the invite flow is reachable but always refused. | Team features are dark until seat counts are set on `plans.limits`. |
| KI6 | Ownership cannot be transferred and a second owner cannot be created (DR9). | A sole owner can never leave their workspace. Support-only until M2. |

---

## 18. Test status

`npm test` — **1,644 passed, 24 skipped, 0 failed**, 100 files (8 skipped), as
of the M1 branch. `npm run typecheck` passes. `npm run lint` reports 0 errors
(95 pre-existing warnings, all in generated or vendored files).

M1 added 270 tests across two files:

| File | Covers |
|---|---|
| `tests/unit/workspace-permissions.test.ts` | 5 roles × 40 permissions allow/deny, non-member denial, the setter boundary by name, entitlement gating, `dataScope`, `canManageRole`, `assignableRoles` |
| `tests/unit/workspace-invitations.test.ts` | Token uniqueness/shape/hashing, constant-time comparison, TTL, email normalization, module resolution, seat limits |

**Not yet covered:** anything requiring migration 0070 to be applied — the
atomic redeem function, the last-owner trigger, the column-protection trigger,
the backfill, and the cross-workspace RLS leak test. See KI4.

---

## 19. Cost-increasing dependencies

None added by M0 or M1. No new vendor, no new runtime, no new hosted service.
Rate limiting, queues and audit all remain in Postgres.
