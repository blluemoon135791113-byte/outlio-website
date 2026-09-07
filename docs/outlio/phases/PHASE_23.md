# Phase 23 — Integrations: Calendly, calendars, Slack/Teams, public API, webhooks

Per §9. Status: **MOSTLY ALREADY BUILT — and one half of it has never worked.
Not started as a phase; audited 2026-09-08.**

---

## ⚠️ FIRST, THE MAP IS WRONG ABOUT THIS PHASE

`05_PHASE_STATUS.md` carried Phase 23 as `NOT_STARTED`. It is not. Present in
the source today:

| §9 element | State |
|---|---|
| Calendly | built — `lib/integrations/calendly/` |
| Calendars | built — `lib/integrations/google*.ts` |
| Public API | built — `app/api/v1/` with 6 resources (contacts, companies, opportunities, tasks, lists, activities), migration `0097_public_api.sql` |
| Webhooks | built — signing, backoff, delivery queue, SSRF-safe URLs, worker delivery, migration `0116` |
| Slack/Teams | partial — `lib/notifications/send.ts`, `lib/flows/actions/notify.ts` |

The reason is worth recording once: **the §9 phase map was laid over a codebase
that already had its own milestone numbering.** `lib/api/webhooks.ts` says
"M8 Phase 25.5"; `lib/hubble/pricing.ts` says "M7 Phase 22". Later §9 phases are
not uniformly unstarted, and reading the map as a to-do list overstates what is
left while hiding what is broken.

⚠️ This is the Phase 0 lesson recurring: **measure the code, do not trust the
plan.** It is also why this file audits rather than proposes.

## THE FINDING: TWELVE WEBHOOK EVENTS, AND NONE OF THEM EVER FIRES

`VERIFIED` 2026-09-08 by exhaustive search of the repository:

```
publishEvent  — 1 definition (lib/api/webhooks.ts:38)
              — 7 call sites, ALL in tests/integration/webhook-delivery.test.ts
              — 0 call sites in product code
enqueue_webhook_delivery — 1 caller, inside publishEvent itself
```

Checked for the ways this conclusion could be wrong, because a scan that
accuses correct code has been wrong here seven times before: aliased imports,
re-exports, and a direct RPC call bypassing the helper. None exists.

So the machinery is complete and correct — HMAC signing, a stable event id that
survives retries, exponential backoff at 30s/2m/8m/32m/2h, an SSRF-safe URL
check, a delivery log, and a worker that drains the queue every tick — and
**nothing ever puts an event into it.**

A customer can open Settings → Developers, register an endpoint, subscribe to
any of twelve events, and receive silence forever. Nothing errors. Nothing is
retried. Nothing has gone wrong, because nothing has happened at all.

### The same defect, in the same building, already fixed once

`lib/flows/dispatch.ts` opens with this:

> **SEVENTEEN TRIGGER TYPES. ONE OF THEM EVER FIRED.** … a customer could build
> a flow, publish it, watch it sit at "published" and never run — with no error
> anywhere, because nothing had gone wrong. Nothing had happened at all.

That was found and fixed in R8. The sibling system — same shape, same
consequence, one directory away — was never checked. **Twelve events, none
fired.**

⚠️ **And the tests hide it, exactly as the flow tests did.** Phase 10 recorded
that "the nine existing engine tests all call `startRun` directly, so the chain
a user actually travels had never been covered." `webhook-delivery.test.ts`
calls `publishEvent` directly. It passes. It proves delivery works and says
nothing about whether anything is ever published — a green number that is not
about the thing it appears to be about.

## WHY THIS IS A DEFECT AND NOT A DEFERRAL

Six phases are deferred in this project for building against a population of
zero. This is not that.

The feature is **shipped**. The settings page offers it, the catalogue names
twelve events, the migration is applied, the worker drains the queue on every
five-minute tick. A customer configuring it today is not an early adopter of
something unbuilt; they are a customer of something that does not work.

The population argument governs whether to *build*. It does not license leaving
a shipped promise unfulfilled.

## THE WIRING THAT IS MISSING — AND THE POINTS ALREADY EXIST

The publish points do not need to be discovered. The flow engine already
dispatches at exactly these moments, six sites:

| Source | Flow trigger dispatched | Webhook event that should publish |
|---|---|---|
| `lib/crm/ingest.ts` | `contact_created` | `crm.contact.created` |
| `lib/crm/opportunities.ts` ×2 | stage change, won | `crm.opportunity.stage_changed`, `crm.opportunity.won` |
| `lib/email/reply-sync.ts` ×2 | replied, bounced | `email.message.replied`, `email.message.bounced` |
| `app/(product)/crm/tasks/actions.ts` | task completed | `crm.task.completed` |

Six of the twelve events have a live source today. The remaining six —
`crm.contact.assigned`, `email.message.sent`, `email.contact.unsubscribed`, and
the three `meeting.*` — have no dispatch point yet and must not be claimed as
working.

⚠️ **The fix must not be six remembered call sites.** That is precisely the
defect Phase 12 spent a phase removing: *being metered depended on a caller
remembering to import it.* Two parallel event systems fanning out from one
moment, each requiring the author to remember both, will diverge again — and the
next person to add a domain event will wire one and not the other, exactly as
happened here.

The shape that survives contact with future code is **one emitter** that fans a
domain event out to both, with a structural guard that neither
`dispatchFlowTrigger` nor `publishEvent` is called directly outside it.

## STATUS OF THIS FILE

Audit only. The wiring is **not** implemented in this commit, and is the next
piece of work rather than an open question — no decision, no cost, no schema
change, and no new customer-facing promise: only the delivery of one already
made.

## COST IMPACT

**NONE.** No new infrastructure; `webhook_deliveries` and the delivery worker
already exist and already run every tick.
