# Phase 14 — Reporting foundation

Per §9. Status: **MOSTLY ALREADY BUILT. Audited 2026-09-09 — this brief was
written without measuring the code, and two of its central claims were wrong.**

---

## ⚠️ CORRECTION 1: THE PHASE IS LARGELY IMPLEMENTED

This brief said "nothing implemented". Present in the source today:

| §5.14 element | State |
|---|---|
| Day-grain rollup table | built — `crm_reporting_daily` (migration `0082`) |
| Rollup run ledger | built — `crm_reporting_runs` |
| Rollup function | built — `crm_rollup_activity_metrics()` |
| Reconciliation | built — `crm_reconcile_reporting()`, surfaced as `reconcileReporting()` |
| Metric reads | built — `getMetricTotals`, `replyRate`, `SetterDashboard` in `lib/crm/metrics.ts` |
| **Reachable?** | **yes** — `lib/crm/reports.ts`, `lib/crm/report-export.ts`, `app/(product)/crm/reports/page.tsx`, and an export route |

⚠️ **This is the FOURTH phase the map was wrong about**, after 10, 12 and 23, and
for the same reason every time: the §9 numbering was laid over a codebase with
its own milestones. **Measure the code, not the plan.**

What §5.14 still asks for and this does *not* have: a **metric registry** with a
formula AST and whitelist grammar. Today the metric set is fixed in SQL
(`'emails_sent'`, `'contacts_emailed'`, `'replies'`, `'openers_sent'`, …) rather
than composed from a registry. That is the genuine remaining scope.

## ⚠️ CORRECTION 2: THE 12,700% WARNING BELOW WAS WRONG ABOUT THE MECHANISM

The version of this brief written 2026-09-08 claimed a reply-rate metric "built
today computes 254/2 and renders 12,700%". **That described a system that does
not exist.**

`replyRate()` does not read `email_events`. It divides two rollup metrics, and
migration `0082` sources both from **`crm_activities`**:

```sql
('contacts_emailed', a.activity_type = 'EMAIL_SENT'    and a.contact_id is not null)
('replies',          a.activity_type = 'EMAIL_REPLIED' and a.contact_id is not null)
```

Two things follow. The 254 false `replied` rows live in `email_events`, which
this path never touches. And the `contact_id is not null` filter excludes
exactly the shape those false replies had — Phase 9 measured **260 of 261
threads with no contact attached**.

So the denominator is contacts emailed, not messages sent, which the code
comments already argue for on its own merits: counting events would quarter the
rate of a team that follows up four times.

⚠️ **What is still unverified, and it is the only live question:** whether any
`crm_activities` row of type `EMAIL_REPLIED` *with* a `contact_id` was created
from a false reply before the Phase 9 fix. That is one production count. It was
attempted 2026-09-09 and refused — production reads need explicit owner
authorisation in the session. **Until it is run, treat the historical accuracy
of `replies` as unknown rather than either safe or broken.**

I am recording the correction rather than quietly editing the old text, because
the wrong version was confident, specific, and would have sent the next person
to fix a bug in the wrong file.

---

## THE ORIGINAL BRIEF, KEPT FOR ITS EVIDENCE

Status as written 2026-09-08: **DEFERRED — the inputs it would aggregate are
empty.** The row counts below are still accurate and still the reason the
*registry* half is not worth building yet.

---

## THE CONTRACT SAW THIS COMING

§9 moved reporting **down** from 7 to 14, and gave the reason:

> at your Phase 7 there is almost no real campaign, conversation or opportunity
> data to report on. You'd build a metric layer against imaginary inputs.

The move was right. The wait was not long enough.

## THE FACT

`VERIFIED` against production, read-only, 2026-09-08:

| Would-be metric source | Rows |
|---|---|
| `email_campaigns` | 3 |
| `email_messages` (ever sent) | **2** |
| `email_enrollments` | **1** |
| `crm_opportunities` | **0** |
| `flow_runs` | **0** |
| `hubble_calls` | **0** |
| `crm_contacts` | 50 |
| `crm_companies` | 44 |

A dashboard builder over this reports: two sends, one enrolment, no pipeline, no
automation, no AI spend. Every chart is a zero or a single point.

⚠️ **`email_events` holds 261 rows and is the trap, not the exception.** 254 of
them are the false `replied` events Phase 9 found — a whole mailbox recorded as
prospect replies against two messages ever sent. The fix stopped new ones; the
historical rows were deliberately left, because deleting them would be rewriting
history to match a fix. **A reply-rate metric built today would compute 254/2 and
render 12,700%.** The one table with enough rows to plot is the one whose rows
are known wrong.

## WHY THIS IS THE MOST EXPENSIVE PHASE TO GET WRONG

§5.14 asks for a metric registry, a formula AST, a whitelist grammar,
parameterized SQL with a statement timeout, and **campaign/channel/sender/day
rollup tables built in the same phase as the builder**. Rollups are a schema
commitment: their grain is chosen from how the data is actually shaped, and
changing that grain later means a migration plus a backfill across
expand → backfill → contract (§5.15).

Choosing a grain from two messages is choosing it from noise. That is not a
delay that costs a phase; it is a schema someone inherits.

## WHAT WOULD UNBLOCK IT

Not a date — a shape. Reporting becomes answerable when the numbers can be wrong
in a way somebody would notice:

- a campaign with enough sends that a rate is not one message moving it 50 points
- opportunities existing at all, so pipeline and forecasting have a subject
- `flow_runs` non-zero, so automation is a reportable event (DECISION-15)
- the 254 historical `replied` rows either excluded by a documented rule or
  reclassified, so the denominator is honest

⚠️ The fourth is a prerequisite, not a nicety. A metric layer that launches on
top of known-bad rows makes them authoritative — the fastest way to turn a
recorded defect into a number people quote.

## WHAT CAN BE DONE WITHOUT THE DATA — AND IS NOT PROPOSED

The metric *registry* (§5.14's id/source/aggregation/formula AST) could be
written now against zero rows. It is not proposed, because the registry's value
is the whitelist it enforces, and a whitelist chosen without seeing a real query
whitelists the queries its author imagined. Phase 12 is the counter-example
worth naming: its registry was written **after** four unmetered routes made the
closed set obvious, and the fourth one was found only because a structural guard
went looking. There is no equivalent evidence here yet.

## COST IMPACT

**NONE** — nothing implemented.
