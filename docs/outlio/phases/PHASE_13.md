# Phase 13 — Gemini Flow Copilot

Per §9. Status: **UNBLOCKED 2026-09-14 — every criterion this brief set for
itself is now met.** The original deferral text is kept below verbatim, because
the premise it rested on was refuted rather than argued away, and the difference
matters.

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


---

# RE-ASSESSMENT — 2026-09-14

The deferral above rested on exactly one premise, and that premise is false.

## Each stated blocker, checked rather than assumed

| This brief required | Status | Evidence |
|---|---|---|
| The engine must have executed | ✅ **Refuted the premise** | DECISION-15, resolved 2026-09-08: it executed **twice**. `OWNER_ASSIGNED` activities carrying `by: flow` + `run_id` are still in `crm_activities`, and that metadata shape is written by exactly one code path — `lib/flows/actions/crm.ts` ASSIGN_OWNER. The manual path writes `{from, to}`, so these cannot be reassignments |
| "Then Phase 10 or 11, then this" | ✅ Both COMPLETE | Phase 10: 33 fact keys / 7 domains, `flow-fact-coverage.test.ts` (401 lines). Phase 11: `FlowBuilder.tsx` (1,879 lines), both pickers filtering on `actionIsImplemented` |
| §5.10 closed-set registry | ✅ Exists | `lib/capabilities/registry.ts`, version 2, 30+ capabilities each with `credits`, `permission`, `status`, `since` |
| Must enter through `hubbleExecute` | ✅ Door exists | `lib/hubble/execute.ts:77` |
| The boundary guard must refuse it otherwise | ✅ **Proven by falsification** | Planted this phase's own first slice — a `lib/flows/copilot/generate.ts` calling `resolveLlmProvider()` directly. `model-call-boundary.test.ts` went from 6 passing to **2 failed**, naming the violation. Probe removed |

## ⚠️ WHY `flow_runs` WAS NOT RE-READ

It is **0**, and that number is uninformative — re-measuring it is the mistake
that caused this deferral in the first place.

DECISION-15 established why: `startRun` writes a row even when it HALTS, so zero
looked like "nothing ever reached the insert". The rows existed and were removed
by manual cleanup in the SQL editor after the owner's verification sessions, and
the live re-verification deliberately removed its own probe rows too. The
counter therefore reads zero **by construction**, and will keep reading zero
until someone uses a flow in anger.

A number that is zero for two unrelated reasons — "never ran" and "ran, then
tidied up" — cannot distinguish them. The activity trail can, which is why that
is the evidence above.

## What has NOT changed, and must not be smuggled back in

This brief drew a careful line against the Phase 5 argument, and that line still
holds in both directions.

Phase 5 was deferred for lack of **usage**. Phase 13 was deferred for lack of
proven **capability**. Capability is now proven, so this phase proceeds — and
re-deferring it on "but is anyone running flows?" would be adopting the Phase 5
argument this brief explicitly rejected. Noted so the question is answered once
rather than re-raised as if it were new.

## One thing the brief could not have known

The model infrastructure is **richer than it assumed**. `DEFAULT_GEMINI_MODEL`
is `gemini-3.6-flash` behind `createGeminiProvider`, inside a five-vendor
fallback chain (`gemini`, `groq`, `openrouter`, `cerebras`, `backboard`) with a
circuit breaker and a reset hook. Phase 13 does not need to build a provider.

Pricing is also already decided: DECISION-16 adopted *meter but do not charge* as
the starting point, so a Phase 13 registry entry priced at **0** is consistent
with the three existing AI HTTP entries rather than a new decision.

## RECOMMENDED BUILD ORDER — compiler first, model last

⚠️ **THE FIRST SLICE SHOULD CONTAIN NO MODEL CALL AT ALL.**

The compiler and validator are what make a generated definition *safe*: they
reject any capability ID or enum value absent from the registry snapshot, which
§5.10 requires be a validation failure and **not a repair opportunity**. That
logic is fully deterministic, so it can be mutation-tested offline, for free,
with no eval corpus and no tokens spent — and this codebase's entire defect
history says the guard should exist before the thing it guards.

Building the model call first inverts it: every bad output would have two
candidate causes, the prompt and the compiler, which is the same
two-candidate-causes problem this brief used to justify the original deferral.

Proposed slices:

1. **Compiler + validator against a pinned registry snapshot.** No network.
   Rejects unknown capability IDs, unknown enum values, and a snapshot version
   mismatch. Mutation-proven.
2. **Registry entry + `hubbleExecute` wiring**, priced 0 per DECISION-16. The
   boundary guard stops refusing it at this point, and that transition is itself
   the test.
3. **Generation and the two-attempt repair loop**, now that malformed output has
   somewhere safe to land.
4. **The ≥30-prompt eval corpus**, which only means something once 1–3 exist.

## COST IMPACT

Still **NONE** — nothing implemented. Slice 1 remains free: no model call, no
registry entry, no credits.
