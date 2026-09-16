# CRM decision log

Phase 0 output required by `Outlio_CRM_Pipedrive_Master_Implementation.md` §0.
Companion to the existing `docs/outlio/03_ADRS.md` and `04_DECISIONS_NEEDED.md`.

**Opened:** 2026-09-13

---

## Part 1 — Decisions taken during Phase 0

### CRM-D-01 — The spec is treated as a gap list, not a build order

**Decision:** The Pipedrive master spec is mapped onto existing code and reduced
to a defect + gap list. It is **not** executed as a greenfield build.

**Why:** The repository already contains a working workspace-scoped CRM —
119 migrations, 23 `lib/crm/` modules, 231 test files, and a prior phased build
in `docs/outlio/05_PHASE_STATUS.md` that reached Phase 9. The spec's own §0 says
*"Do not replace existing authentication, CRM, email delivery, subscription
billing or Hubble integrations with parallel systems"* and §17 says *"If a phase
is substantially implemented already, verify and extend it rather than
recreating it."*

**Rejected alternative:** executing §§1–20 in order as written. This would have
duplicated a mature CRM and is the failure mode both documents warn about.

---

### CRM-D-02 — Ledgers live in `docs/outlio/`, not the repo root

**Decision:** `crm-implementation-map.md`, `crm-decisions.md`, `crm-progress.md`
and `crm-verification.md` are created under `docs/outlio/`.

**Why:** §0 asks for them *"under the existing documentation convention"* and
names them only as suggestions. `docs/outlio/` already holds the build contract,
ADRs, gap matrix, risk register and phase docs. The repo root is already
cluttered with stale marketing docs; adding four more files there would bury them.

---

### CRM-D-03 — The graphify wiki is reference material, not repo content

**Decision:** `graphify-out.zip` was extracted to a scratch directory and used
read-only. Nothing from it was copied into the repository.

**Why:** `CLAUDE.md` forbids unrequested files. The archive is a knowledge graph
of the project's *documentation corpus* (`cost.json` records 51 files;
`.graphify_root` is `/private/tmp/outlio-migration-corpus`), not of source code —
useful for locating decisions, not authoritative about code. Every status in the
implementation map is cited to `path:line` in this repository instead.

**Note:** the archive is **not** an agent pack. It contains no `scripts/install.sh`
and no `engineering/` directory, so the installation commands that accompanied it
could not be run. The repo's own five agents in `.claude/agents/` were used.

---

## Part 2 — Decisions REQUIRED from the owner

> ## ✅ RULED 2026-09-13 — all four decided, owner took the recommendation
>
> Each section below keeps its full reasoning; the ruling is recorded at the top
> of each. Summary of what is now decided, and what it costs:
>
> | # | Ruling | Migration? | Status |
> |---|---|---|---|
> | CRM-DN-01 | Option 3 — configurable, **defaulting to today's owner-only behaviour** | Yes | Not started. Largest item in the plan. |
> | CRM-DN-02 | Option 3 — keep the unique email, add an admin override for shared/role addresses | Yes | **Deferred** until Pile A closes, per the recommendation. |
> | CRM-DN-03 | Keep the unique domain, revisit alongside CRM-DN-02 | Yes | **Deferred.** |
> | CRM-DN-04 | Keep 200 nodes / 90-day wait; **add** the run-lifetime cap and per-path side-effect ceiling | Probably not | Ready to implement. |
>
> ⚠️ **Being ruled is not being built.** Two of the four were recommended as
> *defer*, so accepting the recommendations does not schedule them now. The only
> immediately buildable piece is CRM-DN-04's two missing safeguards; CRM-DN-01
> is a large change to the CRM's whole read path and should be planned as its
> own phase, not appended to a defect fix.

**These four blocked implementation.** In each case the repository made a
deliberate, documented choice that the specification contradicts. Writing code
against the spec here would regress working behaviour.

---

### CRM-DN-01 — Default record visibility ⚠️ largest blast radius

> **✅ RULED 2026-09-13: option 3.** Visibility becomes a workspace setting.
> **Existing workspaces keep owner-only** — the default does not change under
> anyone, which was the whole point of choosing this over option 2.
>
> Scope, so it is not underestimated: a new workspace setting and migration,
> `dataScope` taking the setting rather than the role alone, and every list,
> detail, export, dashboard and report read path taught to respect it. Plan it
> as its own phase with its own gate. `crm_move_opportunity_stage` aside, this
> touches more of the CRM than any other item in the map.

**The conflict:**

| | Position |
|---|---|
| **Repo** | `lib/workspaces/permissions.ts:282-285` returns `dataScope: 'assigned'` for both setter and viewer. Members see only records they own. Not configurable. |
| **Spec §2** | Default is a **shared** directory — members *see* the workspace's records and the owner, but may only *edit* their own. Owner-only visibility is an opt-in mode. |

**Why it matters:** every contact list, detail page, export, dashboard and
report in the product was written against the `assigned` assumption. This is not
a settings toggle; it is a change to the read path of the whole CRM.

**Options:**
1. **Keep repo behaviour, amend the spec.** Cheapest, zero regression risk. Loses the spec's collaboration model.
2. **Implement the spec default.** Large. Touches every list/detail/export/report read path, and needs a new workspace setting plus a migration for existing workspaces.
3. **Make it configurable, defaulting to current behaviour.** Middle path — new setting, both code paths, existing workspaces unaffected.

**Recommendation: option 3.** It satisfies the spec's actual requirement (that
the mode be a choice) without forcing a silent visibility change on live
workspaces. Option 2 would, on deploy, expose every member's records to every
other member — a privacy change no customer asked for.

---

### CRM-DN-02 — Workspace-wide unique email on people

> **✅ RULED 2026-09-13: option 3, deferred.** Keep the unique index; add an
> admin override for addresses explicitly marked shared or role.
>
> ⚠️ The deferral is part of the ruling, not a delay in acting on it. The index
> is load-bearing for the ingest race guard (`0072_crm_ingestion.sql:355` relies
> on `unique_violation` to resolve concurrent creates to one canonical row), so
> the override has to be designed without removing that guarantee. Scheduling it
> next to a defect fix is how the race guard gets broken by accident.

**The conflict:**

| | Position |
|---|---|
| **Repo** | `crm_contact_emails_identity_uniq` (`0071_crm_core_identity.sql:290`) makes an email identity key unique per workspace. |
| **Spec §4 / T06** | Explicitly forbids a universal unique email constraint on people — shared switchboards and role addresses (`info@`, `sales@`) legitimately belong to several people. |

**Complication:** the index is **load-bearing**. `crm_ingest_contacts` relies on
`exception when unique_violation` (`0072_crm_ingestion.sql:355`) to resolve
concurrent creates to one canonical row. Dropping it removes the race guard.

**Options:**
1. **Keep the constraint.** Shared inboxes stay impossible; T06 cannot pass.
2. **Drop it and rebuild the race guard** on a different key (e.g. an identity registry with an advisory lock).
3. **Keep it, add an admin override** for addresses explicitly marked shared/role.

**Recommendation: option 3**, deferred until after Pile A. It is the smallest
change that unblocks T06 while preserving the race guard. Note that §4's full
"identity registry" is a larger design (see CRM-DN-04 in `04_DECISIONS_NEEDED.md`
territory) and should not be smuggled in as part of a defect fix.

---

### CRM-DN-03 — Workspace-wide unique company domain

> **✅ RULED 2026-09-13: keep, revisit with CRM-DN-02.** Lower urgency — no
> acceptance test blocks on it, and the failure mode (two subsidiaries sharing a
> domain collapse into one company) is rarer than the shared-inbox case. Both
> are the same shape of change and should be designed together.

**The conflict:** `crm_companies_domain_uniq` (`0071:137`) enforces one company
per domain per workspace. Spec §4 forbids treating a domain as globally unique —
subsidiaries and distinct legal entities share one.

**Options:** same shape as CRM-DN-02 — keep / drop / override.

**Recommendation:** keep for now, revisit with CRM-DN-02. Lower urgency: no
acceptance test blocks on it, and the failure mode (two subsidiaries collapse
into one company record) is rarer than the shared-inbox case.

---

### CRM-DN-04 — Workflow safeguard numbers

> **✅ RULED 2026-09-13: keep the repo's numbers, add the two missing limits.**
>
> 200 nodes and a 90-day maximum wait stand; the spec is amended, not the code.
> The two safeguards that do **not** exist are added, because they are the ones
> that bound damage rather than express taste:
>
> - a **maximum run lifetime** — nothing currently expires a long-lived run
> - a **per-path side-effect ceiling** — nothing currently caps side effects on
>   a single path through a graph
>
> This is the only one of the four that is ready to build. Both limits look
> implementable in `lib/flows/definition.ts` (publish-time validation) and the
> engine (run age), so probably no migration — to be confirmed when started.

**The conflict:**

| Safeguard | Repo | Spec §10 |
|---|---|---|
| Max nodes | 200 (`lib/flows/definition.ts:228`) | 25 |
| Max wait | 90 days (`:193`) | 30 days |
| Side-effect nodes per path | none | 10 |
| Max run lifetime | **none** | 90 days |

**Assessment:** the node and wait limits are a judgement call and the repo's are
defensible. The two *missing* safeguards are not — nothing currently expires a
long-lived flow run, and nothing caps side effects on a single path.

**Recommendation:** leave 200/90-day as-is (amend the spec), but **add the run
lifetime cap and the per-path side-effect ceiling**. Those two are the ones that
bound damage from a misconfigured flow.

---

## Part 3 — Open question, not blocking

### CRM-Q-01 — Windows guard-test blindness

13 static-analysis guard tests fail on Windows for path/line-ending reasons
(see `crm-verification.md`). They enforce real invariants — hard rule 3, service-role
tenancy scoping, "every server action calls an auth gate".

On Windows they do not merely fail; for a developer who filters them out as
"known environment noise", they **fail open** — the same vacuous-guard defect
class recorded twice already in `docs/PROGRESS.md`.

**Suggested:** normalise `\\`→`/` on collected paths and `\r\n`→`\n` after
`readFileSync` in the affected tests. Small, self-contained, and it restores the
safety net before any CRM work starts. Recommended as the first task.
