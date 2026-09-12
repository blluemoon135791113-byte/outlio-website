# Phase 8 — Email campaign productization + compliance

Per §9. Status: **BRIEF — no open questions, no new cost, so it proceeds (§10).**

---

## GOAL

Make the suppression list visible and manageable by the workspace that owns it.

## ⚠️ SCOPE IS NARROWER THAN §9 LISTS, DELIBERATELY

§9 says "unsubscribe, suppression, rotation, variants". Two of those four are
built and verified; two are speculative at this usage level and are deferred
with the rest of the productization work.

`VERIFIED` against production 2026-09-06:

| Table | Rows |
|---|---|
| `email_campaigns` | 3 |
| `email_sequence_steps` | **0** |
| `email_enrollments` | 1 |
| `email_suppressions` | **0** |
| `email_templates` | 0 |
| `email_accounts` | 1 |

**Mailbox rotation** distributes send volume across several accounts. There is
one account. **A/B variants** compare two versions of a step. There are zero
steps. Building either now repeats the Phase 4 and Phase 5 mistake — designing
against a population that does not exist — and they are deferred on the same
standard, not abandoned.

What is left is not speculative: it is a legal obligation with no interface.

## CURRENT STATE — `VERIFIED`

| Capability | Where | State |
|---|---|---|
| Unsubscribe token sign/verify | `lib/email/unsubscribe.ts:89` | built, tested unit + integration |
| Public unsubscribe route | `app/u/[token]/route.ts` GET+POST | built |
| `List-Unsubscribe` headers + visible footer | `lib/email/compliance.ts` | built, sent on every non-manual campaign |
| Postal address required at launch | `campaign-policy.ts:198` | built, tested 2026-09-06 |
| Suppression written on unsubscribe | `lib/email/unsubscribe-action.ts` | built |
| Suppression written on hard bounce | `lib/email/reply-sync.ts` | built |
| Suppression enforced at enqueue | `lib/email/send.ts:216` | built, integration-tested |
| **Suppression visible to the workspace** | — | **DOES NOT EXIST** |
| **Manual suppression / removal** | — | **DOES NOT EXIST** |

`grep -rl "email_suppressions\|suppressEmail" app components` returns **nothing**.
Every write path exists; there is no read path outside SQL.

## WHY THIS IS THE COMPLIANCE HALF, NOT A FEATURE

CAN-SPAM §7704(a)(4) requires honouring an opt-out within 10 business days. The
product honours them — `enqueueEmail` refuses a suppressed address, proven by
mutation on 2026-09-06 (removing the check fails 5 integration tests).

What it cannot do is **demonstrate** that. A customer asked "did you remove me?"
or a regulator asking the same gets no answer from any screen. An invisible
compliance control is one nobody can audit, and one the owner cannot correct
when it is wrong — there is currently no way to un-suppress someone who asked
to be re-added, which is its own problem.

## WHAT IS MISSING

1. A suppression list per workspace: address, reason, source, when.
2. Manually suppressing an address (reason `manual`).
3. Removing a suppression — with the reason it was there shown first, because
   un-suppressing a `hard_bounce` is a different act from un-suppressing
   someone who changed their mind.

## ARCHITECTURE TO REUSE

`suppressEmail` (`lib/email/send.ts`) already writes with a reason and source.
`app/(product)/dashboard/settings/email/` exists and is the natural home.
`BulkAssign`'s toolbar idiom and `PipelineManager`'s confirm-before-destructive
pattern both apply.

## DO-NOT-TOUCH

- `enqueueEmail`'s suppression check. Integration-tested; the guard is the
  product's legal position.
- The unsubscribe token secret. Rotating `UNSUBSCRIBE_TOKEN_SECRET` invalidates
  every link already sitting in a recipient's inbox.

## PERMISSIONS

Read and write both gate on `email.account.manage` (admin-and-above, the same
gate the sender address uses). Removing a suppression is a compliance-relevant
act; a setter should not be able to re-add someone who opted out.

## TESTS TO WRITE

- Unit: reason/label mapping; the removal-confirmation copy differs by reason.
- Reachability: every new action reachable, `KNOWN_UNREACHABLE` stays empty.
- RBAC: a setter is refused both read and write, server-side.
- Tenant: workspace A cannot see or delete workspace B's suppressions.

## E2E ACCEPTANCE JOURNEY

1. Owner opens email settings and sees an empty suppression list with an
   explanation, not a blank panel.
2. Owner manually suppresses an address; it appears with reason `manual`.
3. A campaign to that address is refused at enqueue.
4. Owner removes the suppression, after a confirmation that names the reason.
5. A setter is refused at step 2 and 4 by the server, not by a hidden button.

## COST IMPACT

**NONE.** No new dependency, no new table, no new recurring cost.

## OPEN QUESTIONS

None. Proceeding under §10.
