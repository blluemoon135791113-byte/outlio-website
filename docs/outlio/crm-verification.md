# CRM verification ledger

Phase 0 baseline required by `Outlio_CRM_Pipedrive_Master_Implementation.md` §0:
*"Establish the existing baseline by running the repository's documented checks.
Separate pre-existing failures from changes caused by this implementation."*

**Measured:** 2026-09-13
**Machine:** Windows 10 Pro 19045, Node **24.19.0**, npm 11.17.0
**Commit:** `e5baee9` (merge of PR #13, `platform-m1-workspaces`)

> ⚠️ Node 24.19.0, not 22. `winget install OpenJS.NodeJS.LTS` now resolves to the
> 24 LTS line. CI pins its own version in `.github/workflows/ci.yml`; this
> baseline was not taken on the CI version.

---

## Baseline results

| Check | Result | Notes |
|---|---|---|
| `npm install` | ✅ clean | No `node_modules` existed before this session. |
| `npx next typegen` | ✅ | **Required before typecheck.** |
| `npm run typecheck` | ✅ **0 errors** | Only after `typegen` — see below. |
| `npm run lint` | ✅ **0 errors**, 8 warnings | All 8 are `no-unused-vars` in test files + `types/database.ts:827`. |
| `npm test` (unit) | ⚠️ **26 failed / 3,189 passed** (3,215 total) | **All 26 are environmental.** See classification. |
| `npm run build` | not run | Deferred — see Not Yet Verified. |
| `npm run test:integration` | not run | Requires real staging Supabase credentials. |
| `npm run test:e2e` | not run | Playwright, staging only. |

### Typecheck depends on typegen

Running `npm run typecheck` on a fresh clone reports 2 errors:

```
components/integrations/ConnectorLogo.tsx(7,22): error TS2307: Cannot find module '@/app/clay-transparent.png'
components/integrations/ConnectorLogo.tsx(8,21): error TS2307: Cannot find module '@/app/gohighlevel.png'
```

Both PNGs **exist and are git-tracked** (`git ls-files` confirms both). The
declarations come from `next typegen`, which `ci.yml` runs first. After
`npx next typegen`, typecheck is **completely clean**.

This is a documentation gap, not a defect: `CLAUDE.md`'s Commands section lists
`npm run typecheck` with no mention that `next typegen` must precede it on a
fresh clone.

---

## The 26 test failures are all environmental

No failure below indicates a defect in application code. Two independent causes,
both artifacts of running a Linux-CI repository on Windows.

### Cause 1 — missing `UNSUBSCRIBE_TOKEN_SECRET` (7 failures)

All 7 in `tests/unit/email-compliance.test.ts`. This is **predicted in-repo**:
`.github/workflows/ci.yml` sets the variable with the comment that
`applyCompliance` throws without a signing secret and *"7 tests fail for a reason
unrelated to the code"*. Exactly 7 failed. Confirmed fixed:

```
UNSUBSCRIBE_TOKEN_SECRET=ci-placeholder-not-a-real-secret
→ tests/unit/email-compliance.test.ts  12 passed (12)
```

Root cause is `tests/setup.ts` loading `.env.local`, which does not exist on a
fresh clone.

### Cause 2 — Windows CRLF + backslash paths (19 failures)

`git config core.autocrlf` = **`true`**, and
`git ls-files --eol lib/hubble/summarize.ts` reports **`i/lf w/crlf`** — stored
LF, checked out CRLF.

The repo's "guard" tests are static analysers: they `readFileSync` source files
and assert on their text, or glob the tree and compare POSIX relative paths.
Both break on Windows and neither touches runtime behaviour.

**CRLF vs `\n` in expected strings:**
- `tests/unit/hubble-summarize.test.ts` (4) — e.g. `expect(s).toMatch(/do not\nrecommend further research/)`
- `tests/unit/flow-fact-coverage.test.ts` (1) — `expect(ENGINE).toContain("await finish(db, runId, 'failed')\n    return {\n...")`

**Backslash path separators:**
- `tests/unit/extension-auth-guard.test.ts` (2) — the failure text itself prints `app\api\extension\pair\route.ts`
- `tests/unit/worker-wiring.test.ts` (3) — `expect(APP_SOURCES).toContain('lib/email/send.ts')` against 458 backslash paths
- `tests/unit/access-decision.test.ts`, `action-authorization.test.ts` (2), `admin-page-guard.test.ts`, `flat-surface-system.test.ts`, `hard-rules.test.ts`, `module-page-guard.test.ts`, `orphan-module.test.ts`, `saved-views.test.ts`, `service-role-scoping.test.ts`, `use-server-exports.test.ts`

⚠️ **These guards are load-bearing and they are blind on Windows.** They enforce
hard rules — rule 3 (no HTML injection), service-role tenancy scoping, "every
server action calls an auth gate", "no page imports raw decision functions". A
Windows-only developer gets *no signal at all* from them, and a guard that
silently fails open is exactly the "vacuous guard" defect class this repo has
already been bitten by twice (`docs/PROGRESS.md`, R15 and the E2E staging guard).

**Recommendation:** make the guards OS-independent — normalise `\\`→`/` when
collecting paths, and normalise `\r\n`→`\n` after `readFileSync`. Small change,
restores the safety net on Windows. This is itself a candidate first task.

---

## Corrections to existing documentation

| Claim | Source | Measured | Verdict |
|---|---|---|---|
| "3,054 unit tests across 172 files" | `docs/PROGRESS.md` | **3,215 tests, 186 files** | Stale — understates both. |
| "typecheck 0; lint 0 errors" | `docs/PROGRESS.md` | Confirmed (typecheck needs `typegen` first) | ✅ |
| "471 integration tests" | `docs/PROGRESS.md` | 45 integration *files*; test count not verified | Unverified — needs staging. |
| "build clean" | `docs/PROGRESS.md` | Not run this session | Unverified. |
| "Scheduler holding at 299-301s" | `docs/PROGRESS.md` | Not measurable locally | Unverified — needs production `worker_runs`. |
| `npm run test:email` | `package.json:26` | Exists | Undocumented in `CLAUDE.md` Commands. |

---

## Not yet verified

Everything here is unproven, and is recorded as unproven rather than assumed:

- `npm run build` — not run.
- Integration suite (45 files) — needs real staging Supabase.
- E2E (6 specs) — needs staging + Playwright browsers.
- `npm run test:email` — needs Docker + GreenMail.
- Every runtime claim in `docs/PROGRESS.md` about production scheduler behaviour.

Per §0: *"Do not substitute fake success for a live dependency."* None of the
above is reported as passing.

---

## Baseline statement

**For the purposes of separating pre-existing failures from future changes:**

> On this Windows machine, at commit `e5baee9`, with `next typegen` run and
> `UNSUBSCRIBE_TOKEN_SECRET` set, the unit suite's expected state is
> **19 failures across 14 files, all Windows path/line-ending artifacts in
> static-analysis guard tests.** Typecheck 0, lint 0 errors.
>
> Any *other* failure appearing later is caused by the change under test.

**Measured, not predicted.** The full suite was re-run with the variable set:

```
Test Files  14 failed | 172 passed (186)
     Tests  19 failed | 3196 passed (3215)
```

26 − 7 = 19 exactly, confirming the two causes account for every failure and
that nothing else is hiding behind them.
