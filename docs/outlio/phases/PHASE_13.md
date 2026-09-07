# Phase 13 — Gemini Flow Copilot

Per §9. Status: **DEFERRED — it generates definitions for an engine that has
never executed one.**

---

## THE FACT

`VERIFIED` against production, read-only, 2026-09-08:

| | |
|---|---|
| `flows` | 4 |
| `flow_versions` | 5 |
| `flow_runs` | **0** |
| `flow_step_runs` | **0** |
| `hubble_calls` | **0** |

Phase 13 is natural-language flow generation, conversational patch editing, a
dry run and a credit preview. Every one of those produces or explains a **flow
definition**. Four already exist, written by hand, and not one has ever run.

## WHY THIS IS NOT THE PHASE 5 ARGUMENT REPEATED

Phase 5 was deferred because nobody had *used* a working capability. This is
worse and simpler: the capability does not demonstrably work. `flow_runs` is
empty, and `startRun` writes a row **even when it halts**, so zero rows means
nothing reached the insert at all — see `PHASE_10.md`, which is `BLOCKED` on the
same fact under DECISION-15.

A copilot that authors flows for an engine with no proven execution would make
the defect harder to find, not easier: every failure would then have two
candidate causes, the generated definition and the engine, with no way to tell
them apart from outside.

⚠️ **The dependency runs the wrong way to ignore.** Phase 11 (builder UX) is
already deferred behind Phase 10. Phase 13 is the same dependency with a model
in front of it.

## WHAT WOULD UNBLOCK IT

DECISION-15, in this order:

1. One contact created by hand in production; read `flow_runs`.
2. If still zero, the Vercel logs for that request show whether
   `dispatchFlowTrigger` threw.

Then Phase 10 or 11, then this.

## WHAT IS WORTH SALVAGING NOW — AND IT IS ALREADY DONE

§5.10's registry half was the prerequisite this phase would otherwise have had
to invent: *"the model may emit only capability IDs and enum values present in
the registry snapshot handed to it. Anything else = validation failure, not a
repair opportunity."*

`lib/capabilities/registry.ts` is that closed set, shipped in Phase 12 with a
version to pin and a test refusing deletions. When Phase 13 runs, the snapshot
it hands the model already exists.

The compiler, the ≥30-prompt eval corpus and the two-attempt repair loop stay
with this phase, deliberately. Building an eval harness for a compiler that does
not exist is the Phase 5 mistake in a different costume.

## COST IMPACT

**NONE** — nothing implemented. Note for when it is: this is the first phase
whose feature is *itself* a model call, so it must enter through
`hubbleExecute` and carry a registry entry with a price. The boundary guard
(`tests/unit/model-call-boundary.test.ts`) will refuse it otherwise, which is
the intended behaviour rather than an obstacle.
