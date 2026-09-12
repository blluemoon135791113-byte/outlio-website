# Phase 10 — Flow fact expansion

Per §9. Status: **COMPLETE. Verified 2026-09-09 — the expansion was already
built, and the brief below was investigating a premise that turned out to be
false.**

---

## ⚠️ RESOLVED TWICE OVER — READ THIS BEFORE THE INVESTIGATION BELOW

**1. The blocking premise was wrong.** DECISION-15 was resolved 2026-09-08: the
flow engine **has** run. `flow_runs = 0` was *deleted rows*, not a dead engine —
activity-evidenced runs `59f87a48` and `9b965940`. Everything below this line
was written while that was still unknown, and is kept as the investigation
record rather than rewritten.

**2. The phase was already implemented.** §9's Phase 10 asks for company,
opportunity, activity, task, email and conversation facts. `lib/flows/facts.ts`
produces all six, and its header says **"M7 Phase 10"** — it was built under the
earlier milestone numbering, before the §9 map was laid over this codebase.

⚠️ **This is the third phase the map has been wrong about for the same reason**,
after 12 (`lib/hubble/pricing.ts` — "M7 Phase 22") and 23 (`lib/api/webhooks.ts`
— "M8 Phase 25.5"). Reading §9 as a to-do list overstates what is left and hides
what is broken. **Measure the code, not the plan.**

### What is actually there — `VERIFIED` 2026-09-09

**33 fact keys across seven domains**, and the branch picker offers exactly the
33 the builder produces — not a superset, not a subset:

| Domain | Keys |
|---|---|
| contact | 8 — name parts, job title, headline, location, owner, company id |
| company | 6 — name, domain, industry, HQ, employee count, owner |
| opportunity | 6 — count, open count, latest status/title/value, total value |
| activity | 3 — count, latest type, latest at |
| task | 2 — count, open count |
| email | 4 — count, sent, failed, latest status |
| conversation | 4 — count, open count, latest direction, latest message at |

**The three kinds of missing are distinguished**, which is the part that would
otherwise produce confident lies:

- **observed zero** — the query ran and found none. `count` is `0`, a value, so
  `is_empty` reads **false**.
- **observed absent** — `primary_company_id` is null, so every company key is
  present with a null value and `is_empty` reads **true**. Never `0`, never
  omitted.
- **could-not-observe** — the query errored, so the whole domain is **omitted**.
  No branch ever reads a zero the database never returned. A contact must not be
  routed as having no deals because Postgres hiccuped.

**Every one of the seven queries is workspace-scoped in code.** They run on the
service role, which bypasses RLS, so the `WHERE` clause is the only tenancy
wall — a missing scope there is a cross-tenant read, not a slow query.

### The guard, and proof it is not vacuous

`tests/unit/flow-fact-coverage.test.ts` (20 tests) pins the builder's **runtime
output** against the picker's key list, key for key. That direction matters both
ways, and the file says why: a key the builder produces that the picker does not
offer is dead weight; a key the picker offers that the builder does not produce
is **the silent no-branch bug, in production** — every contact takes the same
path while the branch looks configured.

Proven by mutation 2026-09-09: deleting the single line that produces
`task.open_count` fails **4 tests**, including
`"task.open_count must be a number: expected undefined"`. Restored after.

## COST IMPACT

**NONE** — nothing was implemented for this phase; it was already delivered.

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

## ⚠️ THE CHAIN WORKS — PROVEN ON STAGING

A new integration test builds the exact scenario against staging: publish a
flow triggering on `contact_created`, then call `createContactManually` —
**not** `startRun`, which is what every existing flow test calls. A run appears.

That matters because it inverts the question. The code is not broken; the nine
existing engine tests all call `startRun` directly, so the chain a user
actually travels had never been covered, and now is. The test stays as a
regression guard.

So production's zero is **not** explained by the current code.

## WHAT IS NOT ESTABLISHED

**Why.** The remaining candidates cannot be told apart from outside:

- an exception between the dispatch call and the insert, swallowed upstream
- those contacts reached the database by a path not yet traced
- something environmental in production that staging does not reproduce

Ruled out since the first draft: workspace mismatch between `flows` and
`flow_versions` (they match), an invalid definition (validates), a broken
dispatch query (returns the flow), and the deploy timing — the dispatch landed
on `main` 2026-09-01, two days before the earliest qualifying contact.

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
