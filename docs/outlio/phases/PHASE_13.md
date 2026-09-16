# Phase 13 — Gemini Flow Copilot

Per §9. Status: **DELIVERED 2026-09-14 — all four slices.** Unblocked and built
in one session; every criterion this brief set for itself was met first. The original deferral text is kept below verbatim, because
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

1. ~~**Compiler + validator against a pinned registry snapshot.**~~
   **✅ MOSTLY ALREADY BUILT — corrected 2026-09-14 after looking.** See below.
2. ✅ **The generated-input tier** — `lib/flows/generated.ts`. Done.
3. ✅ **Registry entry, `hubbleExecute` wiring, generation and the two-attempt
   repair loop** — `lib/flows/copilot.ts`, `generateFlowAction`, `FlowCopilot`.
   Done. Registry version bumped to **3** for `flows.copilot`, priced 0 per
   DECISION-16, gated on `flow.manage` rather than `hubble.use`.
4. ✅ **The ≥30-prompt eval corpus** — `tests/eval/flow-copilot-corpus.ts` (41
   cases), scored by `tests/eval/flow-copilot.eval.ts`, validated for free by
   `tests/unit/flow-copilot-corpus.test.ts`. Done.

### Slice 4 as built — 2026-09-14

⚠️ **TEN OF THE FORTY-ONE CASES ARE REFUSALS, AND THEY ARE THE POINT.** A corpus
of only-satisfiable prompts scores a model that invents capabilities exactly as
highly as one that refuses honestly — which is the single behaviour §5.10 cares
about. Each refusal names a specific absence (`contact.seniority`, no SMS action,
no dialler), and the offline test asserts that absence against the live snapshot
so a case cannot silently become satisfiable and then mark a correct answer
wrong forever.

**The corpus is checked before it is ever used to judge a model.** A case
expecting `ADD_TAG` after that action is renamed would score every model as
failing, and the fault would read as the model's. `flow-copilot-corpus.test.ts`
runs offline, free, in the default loop: 13 tests over coverage, uniqueness,
satisfiability and staleness.

**A third vitest project, because it has a third constraint: it spends money.**
Unit must be fast, integration must be serial, and this must be neither
automatic nor accidental — one model call per case plus a `hubble_calls` row
each. `test:all` now names its projects explicitly so the eval cannot be swept
in. Run it with `npm run eval:copilot`.

⚠️ **A HALF-CONFIGURED EVAL THAT SILENTLY SKIPS IS THE TRAP, and the first
version had it.** `console.log` was useless — vitest suppresses output from
skipped files, so the reason printed to nobody and the run read as "41 skipped".
Someone who set a model key but forgot `EVAL_WORKSPACE_ID` would have concluded
the copilot scored perfectly. Now: nothing configured is a silent skip (correct
in CI), and anything configured is intent, so a missing piece **fails and names
itself**. Verified both ways, and that a model key alone still attempts zero
paid cases.

**The aggregate is reported, not asserted against a threshold.** A baked-in
`expect(rate).toBeGreaterThan(0.8)` gets quietly lowered the first time it fails,
and then it measures nothing. The per-case assertions are the gate.

### Slices 2 and 3 as built — 2026-09-14

⚠️ **SLICE 2's REGISTRY ENTRY WAS MOVED INTO SLICE 3, DELIBERATELY.** Adding a
priced capability before the call it meters exists creates exactly the orphan
this repo keeps producing — the sender cap was "designed, typed, schema'd and
never asked". The entry now lands with its caller.

**The copilot proposes; it does not publish.** `generateFlowAction` writes a
flow and a version 1 draft with `published_at` null, following the template
path's own rule: someone who typed a sentence to see what Outlio would build has
agreed to even less than someone who picked a template. `publishFlow` remains
the only gate that matters — it stamps send authority from the publisher's
permissions and runs `publishProblems`.

**`flows.copilot` has no `flowAction`,** so it can never become a flow step. A
flow that generates and publishes flows writes flows unattended, and 0093's loop
protection counts RUNS, not authored definitions.

**The model emits `registryVersion`; the server does not stamp it.** Stamping
would make the version check vacuous — always matching, never able to fail. A
mismatch is real evidence that the model answered from training data rather than
the snapshot it was handed.

**Two attempts, and the number is a decision.** One wastes a correctable
near-miss; three is where a model that has misunderstood starts reshaping the
flow to satisfy the validator rather than the person, at real cost, while
looking like progress.

⚠️ **NO SILENT REPAIR.** §5.10's "not a repair opportunity" is the load-bearing
half. Mapping `ADD_TAGS`→`ADD_TAG` is a guess about intent made for someone who
is not present; the test asserts no such lookup exists.

### What the guards caught, in order

Worth recording, because each was the mechanism working rather than an obstacle:

1. `module-reachability` + `orphan-module` flagged `generated.ts` the moment it
   was written → ADR-006, with a named exit condition.
2. The same guards then declared that entry **stale** once `copilot.ts` called
   it — ADR-006's exit fired within the same session and the allowlist shrank.
3. `action-reachability` caught `generateFlowAction` gated with **zero callers**,
   which is the failure CLAUDE.md says this repo has shipped repeatedly. That is
   what forced the UI to exist rather than being deferred.

### ⚠️ SLICE 1 WAS ALREADY BUILT, AND SAYING SO IS THE POINT

Written above as if the compiler had to be created. It does not. Checked:

| §5.10 requirement | Where it already lives |
|---|---|
| Accept untrusted input | `validateFlowDefinition(input: unknown)` — already the exact signature a model's output needs |
| Reject unknown capability IDs | `z.enum(Object.keys(ACTION_TYPES))` on the ACTION step |
| Reject unknown enum values | `z.enum(TRIGGER_TYPES)`, `z.enum(['all','any'])`, `conditionSchema` |
| Pin the registry version | `registryVersion` on `flowDefinitionSchema`, citing §5.10 by name |
| Reject a definition that cannot terminate | Graph checks: duplicate ids, missing entry step, dangling `next`, unreachable steps, and a cycle with no WAIT in it |
| A dry run | `lib/flows/simulate.ts` → `simulateFlow` |

Building a second compiler beside this one would have been the
"one question, two implementations" defect this codebase is full of. **The
lesson for slices 2–4: look before writing the brief's next noun.**

### What slice 1 actually turned out to be

One real gap, narrower and more interesting than a compiler.

`actionIsImplemented` had exactly one caller: `FlowBuilder.tsx`'s two action
pickers. Nothing server-side asked. Rule 8 — hiding a button is not access
control — and publish is a server action, so a definition can arrive without
passing a picker. **Latent, not live**: `UNIMPLEMENTED_ACTIONS` is empty and
`flow-action-coverage.test.ts` fails if an action ships without a runner, but
that protects the repo at CI time rather than refusing a request.

Phase 13 is what makes it load-bearing — a model never touches the picker.

Fixed in `publishProblems`, deliberately **not** in the parser: `advanceRun`
parses every stored definition on every run, so tightening the parser would stop
a published flow from LOADING the moment an action was retired, and its author
could no longer open it to repair it. `tests/unit/flow-action-availability.test.ts`
(34 tests) asserts that tier separation as an absence, because it is invisible in
behaviour while the list is empty.

### Remaining open question for slice 2

`registryVersion` is **optional**, deliberately, so that five pre-registry
`flow_versions` rows in production still parse. For a *generated* definition it
must be **required and matched** against the snapshot handed to the model — a
generated flow with no pinned version defeats §5.10 entirely. That is a third
validation tier (parse → publish → generated), not a change to either existing
one, and it belongs with slice 2 rather than being retrofitted into the parser.

## COST IMPACT

Still **NONE** — nothing implemented. Slice 1 remains free: no model call, no
registry entry, no credits.
