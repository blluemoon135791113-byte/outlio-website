# Phase 12 — Capability registry + validator + permission/entitlement checks

Per §9. Status: **BRIEF — contains an open question (pricing), so it needs
approval before implementation (§10).**

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

**Three HTTP routes are outside that function.**

| Route | Reaches a metering module? | Calls a model? |
|---|---|---|
| `app/api/hubble/ask` | **no** (49-module closure) | yes — `reason.ts` → `llm.generateJson` |
| `app/api/intelligence/query` | **no** (76-module closure) | yes |
| `app/api/intelligence/clarify` | **no** (74-module closure) | yes |
| `lib/flows/actions/hubble.ts` *(control)* | **yes** → `lib/hubble/execute.ts` | yes |

The control matters. A scan that finds "no metering" everywhere is a broken
scan; this one finds it exactly where it should, on the flows path, and the only
hit inside the three route closures is `types/database.ts`, which merely *names*
the RPC in generated types.

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
reached through the three routes draws on nothing.

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
4. **Retrofit the three routes** onto it.

⚠️ Item 3 is the deliverable. Items 1, 2 and 4 without it produce a fourth
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

**DECISION-16: what do `/api/hubble/ask` and the two intelligence routes cost?**
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
