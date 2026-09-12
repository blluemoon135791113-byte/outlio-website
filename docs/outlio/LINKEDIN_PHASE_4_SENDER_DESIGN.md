# Phase 4 — sender identity and account policy

Design, 2026-09-12. Implements §4.10 of `Outlio_LinkedIn_Workflow_Master.md`.
Nothing here is built yet. Phase 1's map records this area as `MISSING`: zero
tables match `sender*` or `linkedin*` across 222.

---

## 1. The problem that decides the schema

§4.10 states two requirements that pull in opposite directions:

> An owner participating in multiple Outlio workspaces still shares one account
> budget; tenant UIs must not reveal other tenants' contacts or activity.

> Do not create a global browseable list of customer LinkedIn accounts.

A budget shared across workspaces needs a key that is **not** workspace-scoped.
Every other table in this repo is scoped by `workspace_id`, and CLAUDE.md's rule
is that a service-role query must scope by it in code. So this is the one place
that deliberately does not, and it needs a different wall.

### Resolution: a service-only record with an opaque availability result

Three tables, with the boundary between them doing the work.

| Table | Scoped by | Readable by |
|---|---|---|
| `linkedin_senders` | nothing — one row per real LinkedIn account | **service role only.** No `authenticated` select policy at all |
| `linkedin_sender_links` | `workspace_id` | workspace members, normal RLS |
| `linkedin_sender_actions` | `workspace_id` for attribution, `sender_id` for budget | workspace members see **their own workspace's rows only** |

A workspace member can see: that a sender is linked here, its display label, its
state, and **how much budget remains**. They cannot see which other workspaces
link it, or any action row belonging to one.

Remaining budget is the only number that crosses the boundary, and it crosses as
a scalar from a `security definer` function — never as rows:

```sql
-- Returns an integer. Never a row, never a workspace id, never a contact.
linkedin_sender_budget_remaining(p_sender_id uuid, p_kind linkedin_action_kind)
```

This is §4.10's "Expose only the current workspace's permitted view and an
opaque availability result" read literally. The function checks that
`auth.uid()` is a member of some workspace linked to that sender before it
answers, so it cannot be used to probe senders you have no relationship with.

⚠️ **A residual disclosure, stated rather than hidden.** Remaining budget is
computed from activity this workspace cannot see, so a member *can* infer that
the sender was used elsewhere by watching the number drop. That is inherent to
the requirement — a shared budget is observable by definition — and it is the
narrowest possible leak: a count, with no time, no workspace, no contact. The
alternative is per-workspace budgets, which §4.10 rejects because the platform
does not get a second allowance for the same human.

---

## 2. Identity and ownership, without credentials

Rule 2 and §4.6 are unrevised: no password, no cookie, no session. So a sender
is not *authenticated*, it is **asserted and reviewed**.

- The canonical key is the normalised profile URL. `canonicalLinkedInUrl`
  (`lib/intelligence/identity.ts:145`) already exists and is already used for
  contact identity; senders reuse it rather than growing a second rule.
- A sender row binds to exactly one `owner_user_id` — the Outlio user who says
  "this is my account". Another Outlio user claiming the same `identity_key` is
  **account sharing**, which LinkedIn's User Agreement prohibits and §4.10 names
  directly. It is refused.
- The same person linking their account into a second workspace is **not** a
  conflict. It is the shared-budget case §4.10 asks for, and it adds a
  `linkedin_sender_links` row against the existing sender.

⚠️ **The refusal message must be generic.** "Already claimed by another user"
would confirm that a given profile is on Outlio. `ERR_SENDER_UNAVAILABLE` plus
an `admin_audit_logs` row, and support resolves the genuine case by hand. This
is the same reasoning as the not-found page refusing to say whether a record
exists.

**Ownership is never proven, only attested.** Stage 0 exists for exactly this:
zero proactive actions until the owner reviews and confirms. The UI must say
"Owner confirmed at [time]", never "Verified".

---

## 3. Budgets are derived, never stored

§4.10: *"No unused-quota carryover or end-of-week catch-up burst."*

The way to guarantee that is not to enforce it — it is to make it
unrepresentable. `linkedin_sender_actions` is append-only and every budget is a
`count(*)` over a window. There is no counter to carry over, no reset job to
forget to run, and no drift between a stored number and what actually happened.

Three windows, all of which must pass:

| Window | Definition |
|---|---|
| Daily | calendar day in the sender's **fixed** budget timezone |
| Rolling 24h | `occurred_at > now() - interval '24 hours'` |
| Rolling 7 days | `occurred_at > now() - interval '7 days'` |

The rolling-24h cap is what stops a sender doing a full day at 23:50 and another
at 00:10 — legal under a calendar-day cap, and exactly the burst LinkedIn names
as a restriction trigger.

### The fixed timezone, and why it is change-controlled

§4.10: *"Day rollover uses a fixed sender timezone and cannot be changed
repeatedly to refresh quota."*

`budget_timezone` is stored on the sender with `budget_timezone_changed_at`.
Changing it is allowed at most once per 7 days, and the new zone takes effect at
the next day boundary **in the old zone**. Without that, moving from
`Pacific/Auckland` to `America/Los_Angeles` hands the sender a second Monday.

### Reservation, not consumption at record time

A slot must be held when a task is **released** as actionable, not when the
action is recorded — otherwise fifty tasks can be released against five slots
and the budget means nothing.

So every row has a lifecycle:

```
reserved ──> performed        (owner recorded it)
         ──> skipped          (owner declined, with a reason)
         ──> expired          (release window elapsed, owner never acted)
         ──> unknown          (§4.17: an expired action-ready session does
                               not prove "not sent")
```

⚠️ **`unknown` keeps holding its slot.** §4.17 is explicit: *"retain its
action/quota reservation conservatively."* An action we cannot rule out having
happened counts against the budget, because the cost of being wrong is a
restriction on someone's real account. Only `skipped` and `expired` release the
slot, and `expired` only after the owner is asked and says it was not sent.

This is the same reserve/commit/release shape §4.14 wants for credits, which the
existing `hubble_spend_credits` optimistic model does not provide — noted in the
phase 1 map §6 and worth building once, here, rather than twice.

---

## 4. State: some stored, some derived, never mixed

§4.10 lists `UNKNOWN`, `OWNER_REVIEWED`, `WARNING`, `LIMIT_REACHED`,
`AUTH_EXPIRED`, `PAUSED`, `RESTRICTED`, `DISCONNECTED`.

⚠️ **`LIMIT_REACHED` is not like the others and must not share their column.**
It is a function of the ledger and the clock — true at 16:00 and false at
midnight, with nothing having been written. Storing it means a background job to
clear it, which means a window where a sender is wrongly frozen because a job
did not run. This repository has that failure mode written across it already.

So:

- **Stored** (`linkedin_senders.status`): `UNKNOWN`, `OWNER_REVIEWED`,
  `WARNING`, `PAUSED`, `RESTRICTED`, `DISCONNECTED`, `AUTH_EXPIRED`. These are
  facts somebody asserted or a provider reported.
- **Derived at release time**: `LIMIT_REACHED`, from
  `linkedin_sender_budget_remaining() = 0`.
- **Effective state** = stored status, unless it is `OWNER_REVIEWED` and the
  budget is exhausted, in which case `LIMIT_REACHED`.

`AUTH_EXPIRED` applies only to an authorized provider connection, which does not
exist and may never. It is in the enum so the state machine is complete; nothing
sets it in manual mode.

### Warnings stop release immediately and never auto-resume

§4.10: *"never auto-retry based on a fixed 24/48-hour assumption. Follow the
actual notice."*

`WARNING` and `RESTRICTED` halt new releases for that sender at once and cancel
short-lived action-ready reservations. Resuming requires an explicit owner action
recording that they read the notice and what it said. **No timer resumes a
sender**, and `resume` must not clear DNC or conversation state.

---

## 5. Stages advance by review, not by elapsed time

§4.10's stages, as data rather than code: a `linkedin_sender_stages` lookup
holding the per-kind caps, and `linkedin_senders.stage` pointing at one.

| Stage | Invitations/day | /7d | Proactive DMs/day | /7d | Profile reviews/day |
|---|---|---|---|---|---|
| 0 — unreviewed | 0 | 0 | 0 | 0 | 0 |
| 1 — first five working days | 5 | 25 | 10 | 50 | 10 |
| 2 — after explicit review | 10 | 50 | 15 | 75 | 15 |
| 3 — after another five days + review | 15 | 75 | 20 | 100 | 20 |

InMail is separate: 1/day, 5/7d, **and** bounded by recorded available credits,
paused when that evidence is missing or stale. Optional engagement
(like/follow/comment) is disabled and starts at a combined 5/day if deliberately
enabled.

⚠️ **These are Outlio pilot defaults, not LinkedIn limits.** §4.10 and F10 both
say no universal numeric cap was verifiable from LinkedIn's own documentation.
The table must be editable per workspace, a lower observed platform limit always
wins, and no UI may present these as "safe".

Advancement is a recorded human decision — `stage_changed_by`,
`stage_changed_at`, `stage_change_note`. Never a timer. §4.10: *"Do not advance
automatically on a timer. A new account does not become trusted merely because
several days elapsed."*

---

## 6. Assignment is pinned, and never re-rotated

§4.10: *"Sender rotation means initial assignment."*

The sender is chosen once, when a lead is enrolled, from those linked to the
workspace, permitted for the program, and with capacity. It is written onto the
enrollment and **not recomputed**. When that sender hits a limit or takes a
warning, the lead waits — a second sender must not pick up their unsolicited
outreach, because from the prospect's side that is a second stranger.

Internal conversation *ownership* can be transferred. A change of LinkedIn
sender needs an explicit review and a recorded reason.

---

## 7. Schema sketch

```sql
create table linkedin_senders (            -- service-role only. No RLS select.
  id                         uuid primary key,
  identity_key               text not null unique,   -- canonicalLinkedInUrl
  owner_user_id              uuid not null references auth.users(id),
  display_label              text not null,
  status                     linkedin_sender_status not null default 'unknown',
  stage                      smallint not null default 0,
  budget_timezone            text not null,
  budget_timezone_changed_at timestamptz,
  last_owner_review_at       timestamptz,
  external_reserve_per_day   integer not null default 0,  -- §4.10 manual use
  created_at, updated_at
);

create table linkedin_sender_links (       -- workspace-scoped, RLS as usual
  id, workspace_id, sender_id, linked_by_user_id, permitted_kinds[], created_at,
  unique (workspace_id, sender_id)
);

create table linkedin_sender_actions (     -- append-only ledger
  id, sender_id, workspace_id, contact_id, enrollment_id,
  kind        linkedin_action_kind not null,   -- invitation | dm | inmail | …
  lifecycle   linkedin_action_lifecycle not null default 'reserved',
  reserved_at, occurred_at, resolved_at, resolution_note,
  logical_action_id text not null unique       -- §4.17 idempotency
);
```

`logical_action_id` is §4.17's stable key: workspace + enrollment + published
node + bounded occurrence, and **deliberately excludes the attempt number** —
the brief calls that out as a defect in the original spec.

---

## 8. Deliberately not built

- **Any authenticated LinkedIn connection.** Rules 1 and 2 stand. `AUTH_EXPIRED`
  exists in the enum for completeness; nothing sets it.
- **Live account-health monitoring.** §4.10: manual mode cannot claim it. The UI
  shows "Owner checked at [time]" and never a green "safe" badge.
- **Any inference of restriction risk.** No score, no probability, no badge.
- **Budget increases from profile signals.** §4.10: *"Neither a profile photo nor
  follower count nor an SSI-like score automatically raises the budget."*

---

## 9. Open questions — owner decisions

1. **External activity reserve.** §4.10 wants manual LinkedIn use outside Outlio
   subtracted from the budget, via an owner-reported figure. Sketched as
   `external_reserve_per_day`. Is a flat daily reserve enough, or does it need to
   be recorded per day?
2. **`linkedin_enabled` plan entitlement.** Phase 1 §7 confirms `plans.limits`
   already carries module entitlements and is the required home for them. Should
   LinkedIn gate on a new key, and at which tiers?
3. **Seats vs senders.** Does a plan cap how many senders a workspace may link,
   separately from `workspace_member_limit`? A 5-seat workspace linking 40
   senders is the shape §4.10 warns about ("one person using multiple borrowed,
   purchased, or shared accounts is not the supported way to scale").
4. **Stage table scope.** Per workspace, or platform defaults with per-workspace
   overrides? Overrides are more work but are the only way a customer can go
   *lower*, which the brief requires.

Nothing in phases 5+ depends on 1 or 3. Question 2 is needed before any UI ships.

---

## 10. Dependencies

Blocked on **0121 being applied** — `crm_contact_suppressions` and
`crm_contacts.timezone` land there, and `types/database.ts` carries their shapes
by hand until it is. Adding a second unapplied migration on top would stack
three.

The design above needs no decision from phases 5–9 and can be implemented as
soon as 0121 lands.
