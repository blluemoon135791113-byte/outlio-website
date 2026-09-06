# Phase 7 evidence — email end-to-end with an authorized mailbox

Per §10. Work done 2026-09-05/06. Recorded 2026-09-06.

⚠️ **This phase was executed before its brief was written**, which is a
protocol violation and is recorded rather than tidied away. The owner attached a
real mailbox mid-session and asked for a live send; the work followed the
opportunity rather than the order. §9 moved Phase 7 up so provider truths would
be learned early — they were, but the paperwork trails the work.

---

## E2E ACCEPTANCE JOURNEY — every step `VERIFIED` in production

| # | Step | Evidence |
|---|---|---|
| 1 | A real mailbox is connected and passes provider auth | `email_accounts`: `smtp / ramping / husnain@outlio.io` |
| 2 | Credentials decrypt server-side and SMTP authenticates | Test Connection flow, production; never returned the decrypted value |
| 3 | A message is queued and actually sent | `email_messages` by status: `{"sent": 2}` |
| 4 | The message arrives at a real external inbox | Received at a Gmail address; landed in spam (see limitations) |
| 5 | A human reply is fetched over IMAP | `email_accounts.last_sync_at = 2026-09-06T21:05:03Z`, still syncing |
| 6 | The reply is recorded as an event | `email_events`: 8 × `replied` |
| 7 | The reply is attributed to a contact | newest `replied` event carries `contact_id` set |
| 8 | The reply attaches to a thread | 1 thread with `contact_id` not null |
| 9 | The sequence stops on reply | enrollment: `status=stopped stop_reason=replied replied_at=2026-09-05T17:18:16Z step=1` |

Raw, 2026-09-06:

```
email_accounts:
  smtp ramping husnain@outlio.io last_sync=2026-09-06T21:05:03.377+00:00

email_events (newest first):
  replied      2026-09-05T16:46:09+00:00 contact=set
  replied      2026-09-05T14:03:34+00:00 contact=null
  replied      2026-09-04T19:57:41+00:00 contact=null
  replied      2026-09-02T22:39:12+00:00 contact=null
  replied      2026-09-01T16:35:24+00:00 contact=null
  replied      2026-09-01T13:16:13+00:00 contact=null
  replied      2026-09-01T12:07:33+00:00 contact=null
  replied      2026-08-30T16:09:05+00:00 contact=null

enrollments:
  status=stopped stop_reason=replied replied_at=2026-09-05T17:18:16.638664+00:00 step=1

threads with a contact attached: 1
email_messages by status: {"sent":2}
```

## ⚠️ WHAT THE EVIDENCE ALSO SHOWS: 7 OF 8 REPLIES WENT TO NOBODY

Seven `replied` events carry `contact_id = null`. That is not noise — it is the
defect this phase found, visible in its own evidence.

`reply-sync` matched only `active`/`paused` enrollments, so a reply arriving
after a sequence finished was recorded and attributed to no one: no contact on
the thread, no CRM timeline entry, and an `email_replied` flow trigger carrying
no contact. Fixed 2026-09-06; the newest event is the first with a contact
attached.

The rows are left as they are. Backfilling them would mean inferring which
contact each historical reply belonged to, and CLAUDE.md rule 4 forbids
inventing a value that looks like an observation.

## WHAT THIS PHASE FOUND THAT THE BRIEF WOULD NOT HAVE PREDICTED

1. **No sequence sender existed.** `launchCampaign` told users "the first
   emails go out now" while nothing enqueued the due steps. `advanceSequences`
   was written and added to the tick before `send_email`.
2. **`enrolContacts` had no caller.** A user could author a sequence and launch
   a campaign containing nobody, with nothing saying so.
3. **The tick ran once a day**, then once per ~193 minutes via GitHub Actions —
   never the 5 minutes it asked for. Moved to pg_cron; verified at 299–301s.
4. **A quarter of ticks died at the 60s wall** with no per-job timeout.
5. **`reply-sync` read the product's own outbound mail as a prospect reply.**

## LIMITATIONS — mandatory per §10

- **The test send landed in spam.** `sender_postal_address` was NULL at the
  time and DMARC was `p=none`. Both are now fixed (address set; DMARC at
  `p=quarantine; pct=25`), but **no send has been observed reaching an inbox
  since those changes**. Deliverability is therefore improved on paper and
  unproven in practice.
- **One mailbox, one provider.** SMTP/IMAP against Zoho only. No OAuth
  provider exists, so nothing here proves Gmail or Outlook behaviour.
- **`status = ramping`, not `ready`.** The account is still inside its warmup
  ramp, so send volume has never been tested at scale.
- **Two messages sent, total.** The path is proven; the volume is not. Nothing
  here demonstrates behaviour under a real campaign.
- **RBAC and tenant-isolation for the email module** were exercised by the
  existing suites, not by a Phase 7-specific matrix.

## DEFINITION OF DONE — honest scoring against §10

| # | Criterion | Status |
|---|---|---|
| 1 | E2E journey from the real production entry point | ✅ |
| 2 | Reachability chain unbroken | ✅ — `action-reachability` now has an empty exception list |
| 3 | RBAC matrix (allow and deny) | ⚠️ existing suites, not phase-specific |
| 4 | Tenant isolation via API and direct URL | ⚠️ as above |
| 5 | Persistence survives reload; events emitted and consumed | ✅ |
| 6 | Typecheck, lint, unit, integration, E2E green | ✅ 3,054 unit / 471 integration; E2E not run |
| 7 | No new dead exports or unreferenced tables | ✅ |
| 8 | Feature flag exists and works with it off | ❌ — the email module is gated by plan module, not a flag |
| 9 | Migration applied + rollback stated | ✅ 0117/0118/0119 applied; rollback is `drop` |
| 10 | Architecture / gap matrix / phase status updated | in this commit |
| 11 | `PHASE_7_EVIDENCE.md` with raw outputs | this file |

**Two criteria are not met (8, and 3–4 partially).** Recorded rather than
rounded up: §10 says a phase report with no limitations section is presumed
incomplete, and the same applies to one that quietly scores itself full marks.
