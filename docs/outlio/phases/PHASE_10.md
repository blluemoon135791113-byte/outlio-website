# Phase 10 — Flow fact expansion

Per §9. Status: **BLOCKED — an open defect must be understood before the
surface is expanded. Cause not yet found; do not implement.**

---

## ⚠️ THE FLOW ENGINE HAS NEVER RUN, AND THAT IS NOT A USAGE PROBLEM

`VERIFIED` against production, 2026-09-07:

| | |
|---|---|
| `flows` | 4 (3 draft, **1 published**) |
| `flow_runs` | **0** |
| `flow_step_runs` | **0** |

Phase 10 expands the *facts* flows can act on. Before adding facts, the engine
has to act on the ones it has — and it never has, once.

"Zero runs" would be unremarkable if nothing had triggered. Something did.

## WHAT IS ESTABLISHED — each checked, not inferred

1. **One published flow**, `"Saboor's Lead"`, live since `2026-09-03T17:37:37Z`,
   trigger `contact_created`.
2. **Three contacts created in that same workspace after publication** —
   17:38:20 (43 seconds later), 23:49:08, and 2026-09-05T16:04:18. All
   `source = manual`.
3. **The manual path dispatches.** `createContactAction` →
   `createContactManually` (`lib/crm/ingest.ts:634`), which calls
   `dispatchFlowTrigger` with `contact_created` when `outcome.created > 0`.
4. **That dispatch predates the contacts** — added in `93902d3`,
   2026-09-01, two days before the earliest one.
5. **The dispatch query returns the flow.** Running its exact shape —
   including the `flow_versions!flows_published_version_fk` join — against
   production returns one row with `trigger.type = contact_created`. The join
   is populated, not null.
6. **The definition is valid.** `validateFlowDefinition` on the real published
   definition passes; `entryStepId` is `assign`.
7. **`flow_check_loop_protection` is callable** and answers.
8. **`flow_runs` is genuinely empty** — verified with the error checked, not a
   swallowed failure returning an empty array.

⚠️ Point 8 matters more than it looks: `startRun` inserts a `flow_runs` row
**even when it halts**, with `status = 'halted'` and a reason. So this is not a
flow being refused. Nothing reached the insert at all.

## WHAT IS NOT ESTABLISHED

**Why.** The remaining candidates cannot be told apart from outside:

- the deployed code at the time differed from `HEAD`
- an exception between the dispatch call and the insert, swallowed upstream
- those contacts reached the database by a path not yet traced

⚠️ **No fix is proposed, deliberately.** Mid-investigation I concluded that the
manual path never dispatched and began patching `createContactAction` to add
it — the dispatch was already there, in `createContactManually`, and the patch
would have added a second one. Nearly shipping a duplicate trigger while
looking for a missing one is the reason this brief stops at evidence.

## WHAT WOULD SETTLE IT

1. Create a contact by hand in that workspace, now, and read `flow_runs`. One
   row of either kind — started or halted — narrows this to history rather
   than code.
2. If still zero: Vercel logs for the request will show whether
   `dispatchFlowTrigger` threw.

Both need a production action, so both belong to the owner.

## COST IMPACT

**NONE** — no implementation proposed.

## OPEN QUESTION → `04_DECISIONS_NEEDED.md`

**DECISION-15: is the flow engine's first run worth chasing before Phase 10
adds more facts to it?** An engine with zero runs and four flows is not short
of facts. My recommendation is to settle this defect first, because expanding
what a never-executing engine can see is the same mistake as designing a
feature for a population of zero.
