# Phase 12 — Capability registry + validator + permission/entitlement checks

Per §9. Status: **ALL FOUR ITEMS DELIVERED. Items 1–3 on 2026-09-08 (below);
item 4 on 2026-09-08 under DECISION-16's starting answer — meter at 0 —
recorded at the end of this file.**

⚠️ **CORRECTION, AND IT IS THE HEADLINE'S NUMBER.** This brief said three
unmetered routes. There are **four**. `/api/intelligence/runs/[id]/summary`
reaches a model through `lib/hubble/summarize.ts`; its 25-module closure
reaches `hubbleExecute` zero times.

The first scan missed it by grepping for the identifier `hubbleExecute` and
counting a hit in `lib/hubble/reason.ts` — which only names it in a *comment*.
That is the comment-matching trap this project's own memory warns about, for
the sixth time. The guard shipped in item 3 reads imports, not text.

---

## ⚠️ THE HEADLINE: THE SAME AI WORK IS BILLED OR FREE DEPENDING ON THE DOOR

`VERIFIED` by import-closure analysis of the running source, 2026-09-07.

Outlio has exactly one credit-spending path in the entire codebase:

```
rpc('hubble_spend_credits')   — 2 call sites, both in lib/hubble/execute.ts
rpc('hubble_refund_credits')  — 1 call site, same file
```

`lib/hubble/execute.ts` is careful work. It reserves *before* the call, refunds
on failure, and logs a failed refund as a loud error because "the customer has
been charged for a failed call". Its own header states the rule:

> anything outside this function is a charge nobody metered

**Four HTTP routes are outside that function.**

| Route | Reaches a metering module? | Calls a model? |
|---|---|---|
| `app/api/hubble/ask` | **no** (49-module closure) | yes — `reason.ts` → `llm.generateJson` |
| `app/api/intelligence/query` | **no** (76-module closure) | yes |
| `app/api/intelligence/clarify` | **no** (74-module closure) | yes |
| `app/api/intelligence/runs/[id]/summary` | **no** (25-module closure) | yes — via `summarize.ts` |
| `lib/flows/actions/hubble.ts` *(control)* | **yes** → `lib/hubble/execute.ts` | yes |

The control matters. A scan that finds "no metering" everywhere is a broken
scan; this one finds it exactly where it should, on the flows path, and the only
hit inside the route closures is `types/database.ts`, which merely *names* the
RPC in generated types.

⚠️ **The fourth row was added 2026-09-08 and the first three were written on
2026-09-07 — the correction at the top of this file explains why.** It is left
visible rather than back-dated: a brief that quietly grew a row would hide that
the original method could miss one.

### The same task, two prices

`research` costs **3 credits** through a flow. Through `/api/hubble/ask` it
costs **0** — and the route arguably does *more* work, since `askHubble` runs
search, crawl, embedding and retrieval around the model call.

The only thing standing between a signed-in user and unlimited model spend is
the rate limiter:

```
research: { maxAttempts: 20, windowSeconds: 600 }
```

20 per 10 minutes is ~2,880 research calls per user per day, each one a model
call plus fetches, charged to the owner's provider account and to no plan.

⚠️ **There is no second metering mechanism.** `consume_credit`, `credit_balance`
and `grant_fastspring_period_credits` all read one pool —
`plans.limits.credits_per_month`. AI reached through a flow draws on it. AI
reached through the four routes draws on nothing.

## WHY THIS IS PHASE 12 AND NOT A BUG FIX

§5.11 says: *"Every model call passes a credit context; a call without one fails
closed."* Today a call without one succeeds. §5.10 asks for one registry that is
the closed set of automatable capabilities, with an `is_ai` flag, so that
metering is "enforced by the capability registry, not by convention".

Convention is precisely what failed here. Nothing is broken in
`lib/hubble/execute.ts`; the defect is that being metered depends on a caller
remembering to import it. That is the argument for the registry, restated by the
codebase rather than by the spec — which is the only form of that argument worth
acting on.

## SCOPE

1. **A capability registry** — one file, the closed set, each entry carrying
   `id`, `is_ai`, `credits`, and the permission/entitlement it requires.
   Versioned; deprecated, never deleted (§5.10).
2. **A single guarded entry point.** Every model call goes through it. It fails
   closed without a credit context.
3. **A structural guard**, in the style of the existing ones: no module may
   import an LLM provider except the guarded entry point. This is the part that
   survives contact with future code, and the reason to do 1 and 2 at all.
4. **Retrofit the four routes** onto it.

⚠️ Item 3 is the deliverable. Items 1, 2 and 4 without it produce a fifth
unmetered route the first time someone adds one in a hurry.

## WHAT IS NOT IN SCOPE

The compiler, the eval corpus and the repair loop (§5.10's second half) belong
with Phase 13's NL generation. Building a compiler eval harness before there is
a compiler is the Phase 5 mistake.

## COST IMPACT

**Engineering only.** No new infrastructure, no new dependency, no new table —
`hubble_spend_credits` and the credit pool already exist.

**Revenue impact is the open question, and it is the owner's**, because item 4
turns a currently free feature into a charged one.

## OPEN QUESTION → `04_DECISIONS_NEEDED.md`

**DECISION-16: what do `/api/hubble/ask` and the three intelligence routes cost?**
Recommendation in the decision entry. Items 1–3 do not depend on the answer and
can proceed; item 4 cannot.

## LIMITATIONS — mandatory per §10

- **The closure scan reads static imports only**, so a dynamically imported
  metering module would be invisible to it. Scanned separately: the combined
  94-module closure holds **four** dynamic imports — `lib/hubble/ask.ts:104`,
  `lib/intelligence/run.ts:103` and `:118` are `import('…')` in *type* positions
  with no runtime effect, and `lib/search/engines.ts:201` is
  `await import('cheerio')`. None reaches a metering module or a model provider.

  ⚠️ Recorded because the first draft of this file asserted the check had been
  run when it had not. Had that stood, the ceiling of the method would have been
  described as measured when it was assumed — which is the failure this whole
  document is about.
- **No production spend figure.** This brief proves the routes are unmetered by
  construction. What they have actually cost is in the provider's billing
  console, which is an owner action.
- **`assertHubbleAccess` does gate the ask route.** This is an entitlement gap,
  not an authentication one — the caller is a signed-in, permitted user. The
  exposure is cost, not access.

---

## WHAT WAS DELIVERED — 2026-09-08

| Item | State | Where |
|---|---|---|
| 1. Capability registry | **DONE** | `lib/capabilities/registry.ts` |
| 2. One guarded entry point, failing closed | **DONE** | `lib/hubble/execute.ts` |
| 3. Structural guard on provider imports | **DONE** | `tests/unit/model-call-boundary.test.ts` |
| 4. Retrofit the four routes | **DONE 2026-09-08** | metered at 0 (DECISION-16), see below |

**The registry** is one closed set of 32 capabilities, each carrying `isAi`, a
price and a permission. It is pure — no `server-only`, no database — because the
flow editor renders prices from it in the browser while a step is being edited.

**The entry point** now refuses three ways *before* anything is spent or run: a
capability the registry does not list as AI, one it lists with no price, and a
call with no credit context. Each refusal is recorded, so a silence can be
explained. The model is handed to the runner as `tools.llm` rather than fetched
by it, so reaching a model requires already being inside a metered call.

**The guard is the deliverable.** `hubbleExecute` was correct the entire time
and four routes called a model anyway, because being metered depended on a
caller remembering to import it. Only the provider layer and the one metered
door may now obtain a model at runtime. Type-only imports are excluded — a type
cannot call anything, and a guard that flags signatures earns an allowlist entry
instead of a fix.

⚠️ **The exemption list is asserted in both directions.** Three modules serve
the four unmetered routes and are listed with the route each serves. A module
that stops importing a provider must lose its exemption, or a dead entry
silently re-authorises the next import into that file. Shrinking the list to
empty is what item 4 looks like.

### Three duplicate tables became one

`TASK_FOR` existed three times — in `lib/flows/actions/hubble.ts`, the flow page
and `FlowBuilder.tsx`. All three now read the registry. This mattered
immediately: the mid-refactor state deleted one copy and left two, and
`flow-action-coverage.test.ts` failed because it text-scraped the literal that
had gone. That failure was correct, and its own vacuity assertions are what
produced it rather than a silent empty set.

### A behaviour change that would have been invisible

`reason.ts` lost its `OllamaLlmProvider` import while still constructing one.
Routing that call through `createHubbleLlm()` typechecks — and silently changes
behaviour, because `LlmWaterfall` exposes no `isUsable` of its own, so
`evidenceBudgetFor` would read "not local" and hand a **local** model the full
hosted passage set. The comment three lines above forbids exactly that. Fixed by
re-importing the local provider, with the reason written at the call site.

## EVIDENCE

`tsc` 0 errors · `lint` 0 errors / 99 warnings · **3,086 unit tests, 173 files**
· `next build` clean.

Every new assertion proven able to fail:

| Mutation | Result |
|---|---|
| Provider import smuggled into `lib/crm` | boundary test fails |
| Type-only import of the same module | still passes — no false positive |
| An exemption made stale | stale-exemption test fails |
| Provider modules renamed | all three vacuity guards fail |
| `flow.add_tag` deleted | deletion test fails |
| A deterministic action priced at 4 | zero-price test fails |
| `hubble.ask` quietly priced | unpriced-count test fails |
| `registerAction` loop removed | 3 of 8 flow-coverage tests fail |

## LIMITATIONS — mandatory per §10

- **The guard is static.** It reads import statements. A provider obtained
  through a dynamic `import()` or a runtime string would not be seen. The
  combined closure was checked for dynamic imports and holds four, three
  type-only and one `cheerio`; none reaches a provider.
- **Item 3 does not meter anything.** It prevents a *fifth* unmetered path. The
  four that exist stay unmetered until DECISION-16.
- **No production spend figure.** What these routes have actually cost is in the
  provider's billing console, which is an owner action.
- **The registry declares permissions; it does not enforce them.** Enforcement
  stays where the call enters. A future item could assert the two agree.

---

## ITEM 4 — DELIVERED 2026-09-08: the four routes entered the door

DECISION-16 was answered with its recommended starting point, **option 2 —
meter but do not charge**: the three HTTP entries (`hubble.ask`,
`intelligence.plan`, `intelligence.summarize`) are priced at **0**, so
`hubble_calls` fills with real rows before a real price is chosen. Registry
version bumped 1 → 2; deprecated entries are never deleted, so version 1
definitions stay readable. Raising a price is a one-line registry change with
this file's history as its audit trail.

### What changed

| Route | How it reaches a model now |
|---|---|
| `/api/hubble/ask` | `askHubble` wraps its whole pipeline (cache check aside) in one `hubbleExecute('hubble.ask')` runner; `planResearch` and `answerFromEvidence` take the model as a parameter |
| `/api/intelligence/query` | `hubbleExecute('intelligence.plan')` around `planQuery` |
| `/api/intelligence/clarify` | reaches no model directly — its plan was already fixed by `/query`; `applyClarifications` is deterministic |
| `/api/intelligence/runs/[id]/summary` | `hubbleExecute('intelligence.summarize')` around `summarizeRun` |

`reason.ts`, `summarize.ts` and `planner.ts` no longer construct a model. Their
provider imports are type-only, and `LlmWaterfall.isUsable()` (new) delegates
the local-health probe so `evidenceBudgetFor` no longer needs a bare
`OllamaLlmProvider` built outside the door — the very thing the boundary test
refuses.

The exemption list `UNMETERED_PENDING_DECISION_16` is **empty** and asserted to
stay empty in both directions. The live test
(`tests/integration/hubble-llm-live.test.ts`) now enters the door too, so the
live path exercises the same boundary as production.

### Two defects found in the in-flight work, both fixed before shipping

1. **The guard's own regex failed for the wrong reason.** The scanner's lazy
   `([\s\S]*?)` matched from `import 'server-only'` (a side-effect import with
   no `from` of its own) across to the NEXT import's `from` clause, so
   `summarize.ts`'s `import type { LLMProvider }` was read as a runtime
   import. The work-in-progress had already emptied the exemption list, so the
   guard cried wolf on a file that was clean. This is the mirror image of the
   project's signature defect — a check that *passes* for a reason that is
   wrong — and either colour proves nothing. Fixed with a negative lookahead
   that keeps one match per import statement; a dynamic-import scan was added
   at the same time, closing the bypass item 3's LIMITATIONS honestly recorded.
2. **A refused runner produced fabricated copy.** `askHubble` mapped a
   `no_credits` refusal to the `budget_exhausted` message — *"Hubble found
   relevant sources, but research used the available time"* — for a refusal
   that happens BEFORE any page is read. Sources-were-found is a claim about
   the world the refusal never made; that is rule-4 fabrication in
   customer-facing copy. The refusal now surfaces the door's own message,
   which states what is true: the allowance is gone, nothing ran.

### Evidence

`tsc` 0 errors · `lint` 0 errors (7 warnings) · **3,101 unit tests, 175 files**
· `next build` clean. New `tests/unit/ai-route-metering.test.ts` drives the
real routes (only auth, workspace, the admin client and the model-adjacent
helpers mocked) and asserts the spend RPC, the `hubble_calls` row, and that
the runner receives `tools.llm` — including the out-of-credits refusal, which
0094's zero-spend branch still refuses once the allowance is spent, so even a
free capability degrades gracefully (M7 criterion 4).

Every new assertion proven able to fail:

| Mutation | Result |
|---|---|
| `hubbleExecute` wrapper removed from the query route | 2 metering tests fail |
| `hubbleExecute` wrapper removed from the summary route | 1 metering test fails |
| `workspaceId` threading dropped from the ask route | ask metering test fails (NO_CREDIT_CONTEXT) |
| A value import of `createHubbleLlm` added outside the door | boundary test fails |
| A dynamic `import()` of a provider module added outside the door | boundary test fails |
| Scanner regex reverted to the bridging form | boundary test fails (the false positive returns) |
| A price other than 0 on one of the three entries | zero-price pin fails |
| An unpriced AI entry added | unpriced-set test fails |

### Limitations — item 4

- **Still no production spend figure.** `hubble_calls` starts filling on the
  next deployed call; what these routes cost to date remains in the provider's
  billing console (an owner action).
- **Metering at 0 is a placeholder by decision, not an oversight.** DECISION-16's
  real price is still to be chosen, now with evidence accumulating under it.
- **The rate limiter remains the only live control** against volume (20 per 10
  minutes per user), which at price 0 is the correct state — the registry exists
  so a future price is one reviewed line, not a new mechanism.
