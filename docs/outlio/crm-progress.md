# CRM progress ledger

Resumption point for any future session working the Pipedrive-informed CRM spec.

§0 requires: *"A new agent session must resume from that ledger and verify
current code, rather than regenerate the application from this prompt."*
**Read this file and verify against current code. Do not rebuild from the spec.**

**Spec:** `Outlio_CRM_Pipedrive_Master_Implementation.md` (731 lines, §§0–20)
**Companion ledgers:** `crm-implementation-map.md` · `crm-decisions.md` · `crm-verification.md`

---

## Entry 001 — Phase 0: inspect and map

**Date:** 2026-09-13
**Phase:** 0 (Inspect and map) — spec §17
**Status:** ✅ COMPLETE

### Requirement IDs covered

Spec §§1–16 and §18 mapped requirement-by-requirement. §§17, 19, 20 read but not
mapped (they are process, not product). Six parallel read-only agents, one per
section group; every EXISTING claim required a `path:line` citation.

| Agent scope | Spec sections |
|---|---|
| Tenancy, ownership, command API | §2, §3, §15 |
| Contacts, companies, identity, imports | §1, §4, §5, §6 |
| Activities, deals, custom fields, deal files | §7, §8, §9, §13 |
| Workflow engine, channels, Hubble | §10, §11, §12 |
| Reporting, migration, acceptance gates | §14, §16, §18 |
| Documentation accuracy audit | — |

### Changed paths

Documentation only. **No application code, schema or migration was touched.**

- `docs/outlio/crm-implementation-map.md` (new)
- `docs/outlio/crm-decisions.md` (new)
- `docs/outlio/crm-progress.md` (new — this file)
- `docs/outlio/crm-verification.md` (new)

### Migrations

None created. Highest existing remains `0119_scheduler_diagnostics.sql`.

### Checks and results

Full detail in `crm-verification.md`.

| Check | Result |
|---|---|
| `npm install` | ✅ clean (no `node_modules` existed) |
| `npx next typegen` | ✅ — **required before typecheck** |
| `npm run typecheck` | ✅ 0 errors (after typegen) |
| `npm run lint` | ✅ 0 errors, 8 warnings |
| `npm test` | ⚠️ 26 failed / 3,189 passed — **all 26 environmental** |
| `npm run build` | ⬜ not run |
| integration / e2e / test:email | ⬜ not run (need staging / Docker) |

Failures classified: **7** from missing `UNSUBSCRIBE_TOKEN_SECRET` (predicted
verbatim by `ci.yml`'s own comment, confirmed fixed by setting it), **19** from
Windows CRLF + backslash paths in static-analysis guard tests. No application
defect among them.

### Key finding

**The spec is ~60% already implemented.** The repository holds a working
workspace-scoped CRM: 119 migrations, 23 `lib/crm/` modules, 231 test files, and
a prior phased build (`05_PHASE_STATUS.md`) that reached Phase 9. Remaining work
splits three ways — 10 defects in shipped code, ~10 absent subsystems, and
4 spec/repo conflicts needing an owner ruling. See `crm-implementation-map.md`.

### Blockers

| # | Blocker | Needs | Status |
|---|---|---|---|
| B1 | **4 spec/repo conflicts** | Owner ruling | ✅ **CLEARED 2026-09-13** — all four ruled, owner took the recommendations. See `crm-decisions.md` Part 2. |
| B2 | Integration + E2E unverified | Staging Supabase credentials | Open |
| B3 | Guard tests blind on Windows | Decision on CRM-Q-01 | ✅ **CLEARED** — fixed and merged, see entry 002 |

⚠️ **Clearing B1 did not schedule all four.** Two of the rulings were *defer*
(CRM-DN-02, CRM-DN-03), and CRM-DN-01 is a phase-sized change to the CRM's whole
read path. The only immediately buildable piece is CRM-DN-04's two missing
safeguards.

### Next executable task

Superseded — see entries 002 and 003 below.

---

## Entry 002 — CRM-Q-01: the guard tests

**Date:** 2026-09-13 · **Status:** ✅ MERGED (PR #14, merge commit `9346bb2`)

Thirteen static-analysis guards could not run on Windows, and 55 further tests
never executed at all because two suites died at collection.

Two causes, neither in application code: no `.gitattributes`, so 1,247 LF-stored
files checked out CRLF; and `path.join` output compared against POSIX literals.
Failures pointed both ways — `worker-wiring` and `orphan-module` failed **open**
(live code reported dead), while `action-authorization` and `hard-rules` failed
**closed**, reporting five legitimately session-less auth actions as ungated and
four first-party innerHTML uses as rule-3 violations.

**Changed:** `.gitattributes` (new) + 9 files under `tests/unit/`. No
application code.

**Result:** 26 failed / 3,189 passed → **3,270 passed / 3,270**, 186 files.

---

## Entry 003 — A6: duplicate detection disclosed records the caller could not read

**Date:** 2026-09-13 · **Status:** PR #16 open, `verify` green locally

**Requirement:** spec §4 create-time outcomes; acceptance test **T04**.

Dedup runs on the service role and matches the whole workspace, but the manual
create path applied no visibility filter to the match. It returned the matched
contact's id and "already in your CRM" whoever owned them — an enumeration
oracle over the private half of the contact database, one guessed address at a
time.

Adds §4's missing fourth outcome, the private admin-review conflict: no id, no
name, no owner, no count, and the conflict routed to the existing
`crm_reassignment_requests` queue so T04's "admin review path still prevents
unsafe duplication" half is satisfied too. A repeat attempt returns
byte-identical to the first, because `DuplicateRequestError` surfacing would
confirm the guess.

**Changed:** `lib/crm/contact-actions.ts`, `lib/crm/ingest.ts`,
`components/crm/NewContact.tsx`, `tests/unit/crm-duplicate-disclosure.test.ts`
(new). **No migration.**

**Result:** **3,277 passed / 3,277**, 187 files. Mutation-verified per §2.1 —
neutralising the visibility check fails exactly 3 of the new file's 7 tests.

---

## Entry 004 — A5, and a correction to A4

**Date:** 2026-09-13 · **Status:** PR open

**A5 — a departed member's authority outlived their membership.** The send step
read `config.actorAuthorized`, a boolean stamped into an immutable published
version. On its own it asserted only "this person could send in March", so a
member removed in April kept sending from every flow they had published until
somebody re-published it. The same shape applied to `config.userId`: their
personal AI credit allowance kept being spent by a workspace they had left.

Fixed by re-checking authority at execution against the CURRENT membership.
**No migration was required**, because `flow_versions.created_by` already
records the publisher — so the fix works for every already-published version,
with no re-stamping and no deploy ordering hazard. It rides on a query
`advanceRun` was already making, so it costs no extra reads.

Stamp **and** live check, not either: dropping the stamp would let a flow
published by somebody unauthorized start sending the moment they were later
granted the permission. Keeping both can only refuse more than before.

**Changed:** `lib/workspaces/authority.ts` (new), `lib/flows/engine.ts`,
`lib/flows/actions/email.ts`, `lib/flows/actions/hubble.ts`,
`tests/unit/removed-member-authority.test.ts` (new).

**Result:** 3,532 passed / 3,532. Mutation-verified both ways.

### ⚠️ A4 was overstated, and is now mostly closed

Phase 0 recorded that a removed member "keeps a live session". That is wrong —
`assertWorkspacePermission` re-reads membership uncached on every call, so
interactive access stops on their next request. The prescribed session
revocation is both impossible on the installed SDK (`signOut` takes a JWT, not a
user id) and wrong for this product, where a user's Lead Engine data is
personally theirs and independent of any workspace.

Full reasoning in `crm-implementation-map.md`. **Remaining A4 work:** the
`status` column, so an inactive membership survives for attribution. Needs a
migration; scope it with CRM-DN-02/03.

---

## Next executable task

**CRM-DN-04's two missing safeguards** — the only ruled decision that is ready
to build. A maximum run lifetime (nothing expires a long-lived flow run) and a
per-path side-effect ceiling. Both look implementable in
`lib/flows/definition.ts` and the engine, probably without a migration.

**Then Pile A, in this order** — grouped by what they need:

| Needs nothing | Needs a migration you must apply | Phase-sized |
|---|---|---|
| A3 (audit written before the update, not atomic) | A1 (multi-currency sum) | CRM-DN-01 (visibility setting) |
| A10 (custom-field options keyed by label) | A9 (probability cannot be unknown) | |
| | A2 (stage_age vs engagement_age) | |
| | `crm_tasks.opportunity_id` | |

A4 (membership hard-delete, no session revocation) and A5 (published flows
freeze publisher authority) are the security pair and should be scoped together,
not picked off individually.

**Do not start Pile B** (deal files, social profiles, My Work, Hubble→workflow)
until Pile A is closed — several Pile B items are built on the defective
behaviour.

---

## Working rules for the next session

From `CLAUDE.md`, unchanged and binding:

- **One phase per session.** Stop at the end and report.
- **Never advance with a failing build.** Baseline is in `crm-verification.md` —
  anything beyond it is yours.
- **No stubs.** If it cannot be finished, leave it unstarted and say so.
- **When uncertain, stop and ask** with `BLOCKER:` + options + trade-offs + a
  recommendation.
- **Migrations are applied by hand** in the Supabase SQL editor, never by an
  agent. Validate first: `scripts/check-migration.sh <file>`.
- **Update `docs/PROGRESS.md`** at the end of every phase, and append here.
- Two tenancy models coexist — `workspace_id` (64 tables) and `user_id` (42).
  Scoping to the wrong one is a silent empty result, not an error.
