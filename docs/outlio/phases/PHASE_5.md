# Phase 5 — Opportunity expansion

Per §9. Status: **BRIEF — contains an open question, so it needs approval
before implementation (§10).**

---

## ⚠️ THE HEADLINE: THERE ARE NO OPPORTUNITIES TO EXPAND

`VERIFIED` against production, 2026-09-06:

| Table | Rows |
|---|---|
| `crm_pipelines` | 3 |
| `crm_opportunities` | **0** |
| `crm_opportunity_stage_history` | **0** |
| `crm_custom_field_definitions` | **0** |
| `crm_custom_field_values` | **0** |

Phase 5 is "contact roles, custom fields, conditional fields, files, followers"
— five additions to a record type that has never been created once, by anyone,
since the CRM shipped.

**This is the shape Phase 4 was withdrawn for.** That brief divided a two-week
extraction history by a CRM that shipped afterwards and read the ratio as
behaviour. This one would design five features against a population of zero and
call the result a product decision.

The difference from Phase 4 is worth stating precisely, because it is the
argument someone will make against deferring: Phase 4 proposed CHANGING
behaviour on bad evidence, while Phase 5 proposes ADDING capability, and you
cannot have usage before capability exists. That objection fails here on a
verified fact — **the capability already exists**. An opportunity can be created
from the board today.

## WHAT ALREADY WORKS — `VERIFIED`

| Capability | Where | Reachable |
|---|---|---|
| Create opportunity | `lib/crm/opportunities.ts:187` | yes — `createOpportunityAction`, `NewOpportunityButton` |
| Move stage, with staleness detection | `opportunities.ts:299` | yes — board |
| Board / columns / cards | `opportunities.ts:417` | yes — `PipelineBoard` |
| Stage history | `opportunities.ts:492` | yes |
| Pipeline create / rename / archive / default | `opportunities.ts:47,535,567,612` | yes — wired 2026-09-06 |
| Custom-field validators | `lib/crm/custom-fields.ts:166,265` | **NO — zero callers** |

`createOpportunity` shipped in M3 with no caller; the header of
`opportunities-actions.ts` still records that. It was wired later. The button
exists. Nobody has pressed it.

## WHAT IS MISSING

Everything §9 lists — contact roles, per-entity custom fields, conditional
fields, file attachments, followers. Also a caller for the two validators,
which are the only part of Phase 5 already written.

## THE OPEN QUESTION → `04_DECISIONS_NEEDED.md`

**DECISION-14: does Phase 5 proceed, or defer on the Phase 4 standard?**

Three options, with what each costs if wrong:

1. **Defer until N opportunities exist** (the Phase 4 precedent, which set
   N=20 for extraction jobs). *Wrong if:* the reason nobody creates
   opportunities is a missing field they need, in which case waiting for usage
   waits forever. Nothing in the data suggests that — but nothing rules it out,
   because there is no usage to ask.
2. **Build the smallest slice: custom fields only**, giving the two written
   validators a caller and letting a workspace add one field. *Wrong if:*
   nobody creates opportunities regardless, and five more tables join the four
   already sitting empty.
3. **Reorder: take Phase 6 first** (pipeline productization — list view, stage
   totals, forecasting). *Wrong if:* forecasting zero opportunities is equally
   hollow, which on the numbers above it is.

**My recommendation: option 1, defer** — with an explicit trigger rather than
"later". Revisit at **20 opportunities created after 2026-09-06**, mirroring
Phase 4's standard. Until then the honest blocker is not a missing feature; it
is that opportunities are not yet part of anyone's workflow, and no amount of
schema fixes that.

⚠️ **I am not confident enough in that to act on it unasked.** Deferring two
consecutive phases on the same argument is exactly how a plan quietly stops
moving, and "there is no data" can become a reason to never build anything. It
is the owner's call whether the pipeline is a priority at all — that is a
product question, and §11 says to stop rather than guess it.

## WHAT IS UNAMBIGUOUS, AND NEEDS NO DECISION

**Phase 7 (email end-to-end with authorized mailboxes) is substantially
complete and unrecorded.** It was done on 2026-09-05/06 outside the contract:
real Zoho mailbox connected, message sent and received, reply detected over
IMAP, attached to a contact, sequence stopped with `stop_reason: replied`. §9
moved Phase 7 up precisely so those provider truths would be learned early, and
they were.

Recording it is bookkeeping of finished work rather than new building, so it
proceeds without approval. `PHASE_7_EVIDENCE.md` next.

## COST IMPACT

**NONE** either way. No new recurring dependency in any option.

## DO-NOT-TOUCH

`crm_opportunity_stage_history` is append-only (0075 trigger). Attribution
columns (`owner_user_id_at_event`) are frozen at write time by design — 0109
made those FKs `NO ACTION` deliberately, so a schema change here needs the same
care the extension work did.
