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

| # | Blocker | Needs |
|---|---|---|
| B1 | **4 spec/repo conflicts** — visibility default, unique email, unique domain, safeguard numbers | Owner ruling. See `crm-decisions.md` Part 2. **CRM-DN-01 blocks the most work.** |
| B2 | Integration + E2E unverified | Staging Supabase credentials |
| B3 | Guard tests blind on Windows | Decision on CRM-Q-01 |

⚠️ **B1 is a hard blocker for Pile C only.** Pile A defect work can start now —
none of the ten defects depend on an unresolved conflict.

### Next executable task

**Recommended: CRM-Q-01 — make the guard tests OS-independent.**

Normalise `\\`→`/` on collected paths and `\r\n`→`\n` after `readFileSync` in the
13 affected tests (listed in `crm-verification.md`). Self-contained, touches no
application code, and restores a safety net that currently fails *open* on
Windows — the same vacuous-guard defect class recorded twice in
`docs/PROGRESS.md`. Doing it first means every later change is actually guarded.

**Then, Pile A in order.** A1 (multi-currency sum), A2 (staleness on
`updated_at`) and A9 (probability cannot be unknown) are self-contained and
independently shippable. A4 (membership hard-delete, no session revocation) and
A5 (flows freeze publisher authority) are the security pair and should be
scoped together.

**Do not start Pile B** (deal files, social profiles, My Work, Hubble→workflow)
until Pile A is closed — several Pile B items are built on top of the defective
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
