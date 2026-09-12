# LinkedIn workflows — Phase 1 capability map

Audited 2026-09-12 against `Outlio_LinkedIn_Workflow_Master.md` §4.2 and §6.
Status vocabulary is the brief's: `VERIFIED_PRESENT` · `PARTIAL` · `MISSING` ·
`UNVERIFIED`.

**The brief's own standard is applied literally:** *"A name in an action
registry or an empty 'unimplemented' list is insufficient if the handler is a
stub or has no functioning UI path."* Every `VERIFIED_PRESENT` below cites a
file and line that was read, not a table or symbol that merely exists.

Nothing here has been built. This is the map, and it is the deliverable of
§4.19 phase 1.

---

## 0. Headline

Three findings decide the shape of the whole build.

1. **The email channel cannot currently honour a contact-level stop.** This is
   the §4.15 coordination contract, and the brief is explicit about what to do
   when it does not hold: *"If the repository cannot enforce the shared guard at
   actual email dispatch, report the integration as incomplete and keep
   simultaneous coordinated programs disabled."* See §2 below. It is a
   one-predicate gap, not an architectural one.
2. **No sender identity model exists at all.** Zero tables match `sender*` or
   `linkedin*` in a 222-table schema. §4.10 — per-account budgets, sender
   states, ramp stages, pinned assignment — is greenfield.
3. **The repository already enforces the brief's central discipline.**
   `UNIMPLEMENTED_ACTIONS` plus `flow-action-coverage.test.ts` exist precisely
   to stop an action being offered before it works, and the list is currently
   empty. The brief's §4.2 warning describes a defect this codebase has already
   met and built a guard against.

---

## 1. Workflow engine and action registry — `VERIFIED_PRESENT`

| Item | Status | Evidence |
|---|---|---|
| Action registration, single entry point | `VERIFIED_PRESENT` | `lib/flows/actions/index.ts` — `registerAllActions()`, idempotent, called from `lib/workers/tick.ts` |
| Registered handlers | `VERIFIED_PRESENT` | 23 explicit `registerAction(...)` calls across `actions/{compute,crm,email,notify,webhook}.ts`, plus a dynamic set in `actions/hubble.ts:159` |
| Catalogue-vs-handler guard | `VERIFIED_PRESENT` | `lib/flows/definition.ts:139` `UNIMPLEMENTED_ACTIONS` (empty), checked by `tests/unit/flow-action-coverage.test.ts` |
| Durable waits | `VERIFIED_PRESENT` | `claimWaitingRuns` / `advanceRun`, driven by `runTick`'s `advance_flows` job |
| Immutable published versions | `VERIFIED_PRESENT` | `flow_versions` table; enrollments pin `version_id` (`app/(product)/flows/[id]/page.tsx`) |
| Registry-version deprecation warnings | `VERIFIED_PRESENT` | `flowDefinitionWarnings`, rendered on the flow page |

**Reusable for LinkedIn.** §4.14's DSL requirements — registered node types,
schema validation, permissions, credit classification, side-effect category —
map onto `ACTION_CATALOGUE` + `capabilityForFlowAction` without a parallel
system. The brief forbids building a second engine; nothing here requires one.

**Gap against §4.6's starter registry.** The LinkedIn intents
(`REVIEW_PROFILE`, `CONNECTION_REQUEST`, `DIRECT_MESSAGE`, `INMAIL`) and the
optional human tasks (`REVIEW_POST`, `FOLLOW_PROFILE`, `LIKE_POST`,
`COMMENT_POST`, `VOICE_NOTE`) do not exist. Adding them **must** go through
`UNIMPLEMENTED_ACTIONS` until their handlers and Action Inbox path work, or the
repo reproduces the exact defect the list was built to prevent.

---

## 2. Email coordination (§4.15) — `PARTIAL`, and this is the critical one

| Item | Status | Evidence |
|---|---|---|
| Suppression exists and is enforced | `VERIFIED_PRESENT` | `lib/email/send.ts:216` at enqueue, and again inside the claim |
| Checked at enrollment too | `VERIFIED_PRESENT` | `lib/email/enrollment.ts:146-211` |
| Stop-on-reply policy | `VERIFIED_PRESENT` | `lib/email/campaign-policy.ts:36,118` — `stepStopsOnReply` |
| **Contact-level stop honoured at dispatch** | **`MISSING`** | `lib/email/send.ts:217-221` queries `.eq('workspace_id', …).eq('email', toEmail)` |

### The precise defect

`email_suppressions` **has** a `contact_id` column. `enqueueEmail` never reads
it — suppression is resolved purely by email address.

So a do-not-contact recorded against a *contact*, which is exactly what a
LinkedIn reply or a manual `Mark DNC` produces, does not stop an email send.
It only stops one if a suppression row happens to exist carrying that person's
exact address.

This is G11/§4.15 stated as a code path rather than a concern. It is also
**narrow**: the fix is one additional predicate on an existing query against an
existing column, plus writing `contact_id` on every suppression insert. It is
not an architectural change.

### What the brief requires until it is fixed

Coordinated simultaneous programs stay **disabled**, and the integration is
reported incomplete. The brief anticipates this exact situation and says an
event stored in CRM "alone does not prove the email worker honors it."

**Recommended as phase 3 of the build**, before any LinkedIn enrollment exists —
the shared stop has to be real before two channels can rely on it.

### Update — phase 2, 2026-09-12

Closed in TypeScript, and the fix turned out to have a second half that the
first half depended on.

Reading `contact_id` in `enqueueEmail` was nearly inert: of the three
`suppressEmail` call sites, only the bounce path ever passed a contact.
One-click unsubscribe and the manual add did not — so the column the new check
reads was almost never written. Resolution now happens inside `suppressEmail`,
which every suppression passes through, rather than being each caller's job to
remember.

An address shared by several contacts (`info@`, `sales@`) resolves to **none**,
never to the first. §4.5 requires it — "shared inbox email addresses and
ambiguous matches must not cause automatic person merges" — and attributing a
do-not-contact to whichever colleague sorted first would invent a fact about a
person. The suppression is still recorded by address, which is what was
actually observed.

### Update — phase 3, 2026-09-12

Owner chose the channel-agnostic contact DNC. `crm_contact_suppressions`
(migration 0121) records a stop against a PERSON, with a scope of `all`,
`email` or `linkedin` and a reason that keeps §4.11's R06 "not interested"
distinct from R07 "explicit request" — the first suppresses prospecting, the
second routes into the privacy process, and collapsing them loses the fact that
decides which.

`email_suppressions` stays and remains authoritative for ADDRESSES: an
unsubscribe arrives for an address that may resolve to no contact, or to an
ambiguous shared inbox, and that has to be storable exactly as observed.
Neither table can express the other's case.

**What keeps them from diverging is `lib/crm/contact-stop.ts` — the one
predicate both channels call.** `enqueueEmail` now asks it instead of querying
suppression itself. It fails **closed**: a lookup that errors returns stopped,
the opposite of the rate limiter's deliberate fail-open, because mailing
somebody who asked not to be mailed cannot be undone.

Scope is respected exactly in both directions. A contact DNC scoped to `email`
does not stop LinkedIn, and an address suppression never stops a non-email
channel — it is evidence that one mailbox asked to be left alone and says
nothing about the person.

`crm_contacts.timezone` lands in the same migration, nullable, where null means
UNKNOWN rather than UTC. It is the first link of §5.7's fallback chain, which
`lib/email/schedule.ts` already implements correctly against the mailbox's zone
and had nowhere to read the recipient's from.

**Still open:** 0120 and 0121 are both unapplied. `types/database.ts` carries
0121's shapes by hand, marked with the migration number, and must be
regenerated with `npm run db:types` once it is run.

---

## 3. Sender identity and account policy (§4.10) — `MISSING`

Zero tables match `sender*`, `linkedin*`, or `inbox*` across 222 tables.

Everything in §4.10 is greenfield: real-account identity, ownership
verification, per-account daily/rolling-7-day budgets shared across campaigns,
ramp stages 0–3, sender states (`UNKNOWN`, `OWNER_REVIEWED`, `WARNING`,
`LIMIT_REACHED`, `PAUSED`, `RESTRICTED`, `DISCONNECTED`), warning capture,
pinned sender-per-thread assignment.

**Designed 2026-09-12** — see
[`LINKEDIN_PHASE_4_SENDER_DESIGN.md`](LINKEDIN_PHASE_4_SENDER_DESIGN.md).
Not built; blocked on 0121 being applied.

⚠️ **One constraint to carry into the design.** §4.10 requires a sender's budget
to be shared across *all* workspaces that owner participates in, while no
workspace may see another's activity. That is a service-only control record with
a per-workspace projection — the brief says so explicitly ("Do not create a
global browseable list of customer LinkedIn accounts"). It cuts across this
repo's `workspace_id` tenancy model and needs designing deliberately rather than
as a column on a workspace-scoped table.

---

## 4. Tasks and the Action Inbox (§4.13) — `PARTIAL`

`crm_tasks` exists with: `workspace_id`, `contact_id`, `company_id`,
`assigned_to_user_id`, `due_at`, `status`, `title`, `body`, `completed_at`,
`completed_by`, soft delete.

Good bones. **Absent** for §4.13: task kind/intent, sender identity, approved
content version, evidence reference, recorded-outcome distinct from completion,
skip reason, last-thread-check timestamp, and the
`REQUEST_MARKED_SENT` / `CONNECTION_ACCEPTANCE_RECORDED` /
`MESSAGE_MARKED_SENT` / `INBOX_REVIEW_RECORDED` event vocabulary from §4.7.

The brief's hardest requirement here is semantic, not structural: *"'Mark
request sent' cannot mark acceptance"* and *"task created ≠ message sent."* A
single `status` enum cannot carry that; §4.7's separate enrollment / task /
conversation / sender states are load-bearing.

### Update — phase 7 decision layer, 2026-09-12

The two pieces of §4.13 that do not depend on the sender model or the task
state split are built: `lib/linkedin/outcomes.ts` and
`lib/linkedin/profile-reference.ts`. The card itself still needs phases 4
and 5.

**Two vocabularies that must not mix.** `TaskOutcome` is what the operator did
with the task in front of them; `Observation` is what they later saw happen,
recorded against the contact. A result form offers the first and can never
offer the second, because an observation is not the outcome of doing anything.
That is *"'Mark request sent' cannot mark acceptance"* made structural rather
than remembered — and it matters because acceptance gates the first DM, so
collapsing the two sends a message into a connection that was never made.

`OUTCOME_UNKNOWN` is distinct from `FAILED` and keeps its quota slot (§4.17),
because an action we cannot rule out having happened has to keep counting.
Only `SKIPPED` may be applied in bulk — §4.13's *"manual tasks are never
bulk-marked sent"*, which is the difference between a decision made inside
Outlio and a claim that somebody performed N actions in LinkedIn's interface.

**The profile link is an allowlist, not a blocklist.** §4.13: *"Opening a
reference never performs a LinkedIn action."* LinkedIn has paths that do things
— invite, message, follow — and the URL on a contact came out of uploaded or
fetched HTML. A blocklist is a promise to have thought of every path LinkedIn
will ever add, so only read-only profile paths are permitted, the host check is
anchored, `javascript:` is refused before anything else, and query and fragment
are dropped rather than filtered.

---

### Update — phase 5 state core, 2026-09-12

`lib/linkedin/enrollment.ts` and `lib/linkedin/preflight.ts`. The tables are
not built — that is another migration and two are already unapplied — but the
semantics are, and they are the part a schema cannot enforce on its own.

**Durable cancellation is a VERSION check, not a message.** §4.7: *"Pending
outreach steps must fail their preflight once that version changes. Lost UI
notifications must not restore action permission."* A cancellation delivered as
a notification can be missed — a dropped socket, a closed laptop, a stale tab —
and if missing it leaves the task clickable then the guarantee is "usually".
Comparing the version an approval was granted at against the contact's version
now inverts that: permission is re-earned at the moment of use, so anything
that failed to arrive fails closed by construction.

The comparison is `!==`, not `>`. A counter that wrapped, was reset, or came
back from a backup would otherwise read as "nothing changed".

**Refusals are ordered by who is harmed.** Contact stopped, then stale
approval, then sender restricted, then out of budget, then no recent thread
check — so an operator sees the most consequential true reason rather than
whichever check ran first.

**No thread check is stale, not fresh.** `null` means nobody looked, and the
tempting reading is exactly backwards. A check timestamped in the future is
refused too: a wrong clock must not become permission.

**Only `GOAL_MET` is success.** `REPLIED` ends the sequence and leaves the
commercial goal unmet, which is why §4.18 wants qualified conversations and
held meetings as separate denominators — a wall of "replied" is not the channel
working.

**Terminal means terminal.** A late acceptance after `NOT_ACCEPTED` is recorded
against contact history and offered for a new owner review; it never replays
the expired invitation route, because the prospect would receive a message
about a request they answered weeks ago. It is never discarded either — a late
acceptance is still an acceptance.

---

## 5. Conversations (§4.11) — `MISSING` as a channel-agnostic concept

`email_threads` and `email_inbound_messages` exist; there is no
channel-neutral `conversations` table. §4.11 needs conversation ownership,
assignment, SLA timers and reply classification that a LinkedIn manual capture
and an email provider event can both write to.

---

## 6. Credits (§4.14) — `PARTIAL`

`hubble_spend_credits` and `hubble_refund_credits` exist
(`lib/hubble/execute.ts:141,190,225`). That is **spend-then-refund**, an
optimistic model.

§4.14 asks for **reserve / commit / release** "so concurrent workflows cannot
overspend." These are not the same: refund-on-failure cannot prevent two
concurrent flows from both spending past the balance, it only repairs one
afterwards. Whether that matters depends on the concurrency the LinkedIn build
introduces — recorded as a gap, not yet a required change.

---

## 7. Plan gates (§4.3) — `VERIFIED_PRESENT`

`lib/limits/plans.ts:76-81` — `crm_enabled`, `email_enabled`, `flows_enabled`,
`reports_enabled`, `integrations_enabled`, `hubble_enabled`, plus
`workspace_member_limit`. Module entitlement already lives in `plans.limits`
with a workspace flag that can only switch a module **off**, never on
(`lib/workspaces/entitlements.ts`).

A `linkedin_enabled` entitlement fits this existing mechanism with no new table,
which CLAUDE.md requires ("All plan limits come from `plans.limits` JSONB at
runtime. Never hardcode.").

---

## 8. Contact model — `PARTIAL`

`crm_contacts` has **no** `timezone` column and **no** contact-level DNC flag.

- The missing timezone is the same gap DECISION-20 records for send windows.
  §4.8's timing table needs it ("If recipient timezone is unknown, show the
  campaign fallback explicitly").
- The missing DNC flag is the other half of §2 above.

Both are additive columns on an existing table.

---

## 9. Not yet audited — `UNVERIFIED`

Stated rather than guessed, per the brief's evidence standard:

- How service-role background jobs enforce tenancy in practice. `CLAUDE.md`
  requires every service-role query to scope by `workspace_id`/`user_id` in
  code and `tests/unit/service-role-scoping.test.ts` exists, but this audit did
  not read it.
- Whether operator/member records already cross workspaces (§4.10's shared
  budget depends on the answer).
- Deployed capacity. §4.20's load targets cannot be assessed from source, and
  the brief is explicit that throughput is a measured deployment property.
- Which connectors hold legitimate signal or inbox capability. `Calendly` is
  wired; the rest is unread.

---

## 10. Proposed build order

Deviates from §4.19 in one place, for a stated reason.

| # | Phase | Why here |
|---|---|---|
| 1 | This map | done |
| 2 | **Contact-level stop at email dispatch** | §4.19 puts this at phase 3. It moves first because it is small, it is the one defect already shipping today, and every later coordination claim depends on it |
| 3 | Contact model additions (`timezone`, DNC) | unblocks both the stop above and §4.8 timing |
| 4 | Sender identity + account policy (§4.10) | the largest greenfield piece; everything in §4.8 releases through it |
| 5 | Task/enrollment/conversation state split (§4.7) | the semantic core: sent ≠ accepted, created ≠ sent |
| 6 | LinkedIn action types behind `UNIMPLEMENTED_ACTIONS` | registered only as handlers land |
| 7 | Action Inbox (§4.13) | needs 4 and 5 |
| 8 | Templates + fallback registry (§4.9) | pure rendering, testable in isolation |
| 9 | Metrics (§4.18) | denominators need the event vocabulary from 5 |

**Migrations required** (owner-applied, per CLAUDE.md): phases 3, 4, 5. Phase 2
needs none — it is a query predicate and an insert field.
