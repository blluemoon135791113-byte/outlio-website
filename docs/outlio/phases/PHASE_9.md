# Phase 9 — Unified Conversations foundation

Per §9. Status: **PARTIALLY DELIVERED — the foundation existed and was wrong.
One defect found and fixed; the rest is deferred with Phases 5 and 6.**

---

## ⚠️ THE FOUNDATION COULD NOT TELL A CONVERSATION FROM A REPLY

`VERIFIED` against production, 2026-09-07:

| | |
|---|---|
| `email_threads` | 261 |
| …with a contact attached | **1** |
| …with none | **260** |
| `email_events` type `replied` | **254** |
| `email_events` type `auto_replied` | 7 |
| Messages ever sent by the product | **2** |

**254 replies against two sends.** `syncMailbox` reads the whole mailbox —
which is what a unified inbox is for — but nothing downstream asked whether an
arriving message was a reply to something *we* sent. Every newsletter, receipt
and notification in the owner's inbox was recorded as a prospect reply.

Consequences, all silent:

- Reply-rate reporting is meaningless: the denominator is 2.
- `dispatchFlowTrigger('email_replied')` fired for each, so automation runs on
  unrelated correspondence.
- A bounce for mail we never sent would call `suppressEmail`, adding an address
  this workspace has no relationship with to its permanent do-not-contact list.
- The CRM timeline records conversations nobody had with a prospect.

## WHAT WAS FIXED

A message is treated as a reply only when the workspace has actually mailed
the address — enrollments for sequences, `email_messages` for one-off sends the
enrollment table never sees. Unrelated mail is **still stored** (the inbox is
meant to show the mailbox) and counted as `unrelated`, but produces no event, no
suppression and no trigger.

⚠️ The gate sits after `email_record_inbound` and before every action. Placed
after the bounce branch it would still suppress; after the reply branch it
would still fire automation. A test pins that ordering, and removing the gate
fails three tests.

Existing rows are left alone. Deleting 254 events would be rewriting history to
match a fix, and they are the evidence that the bug was real.

## WHAT IS DEFERRED, AND WHY

§9's Phase 9 is a *foundation for multichannel conversations* — one timeline
per person across email, LinkedIn and calls. Phases 15–20 (LinkedIn) are not
started, so today "unified" can only mean email, and a conversation model built
for one channel is a model built against the same population problem as Phases
5 and 6.

Deferred with them, on the same standard: revisit when a second channel exists.

## WHAT ALREADY WORKS — `VERIFIED`

| Capability | Where |
|---|---|
| Inbox list + thread view | `app/(product)/email/inbox/` |
| Thread storage with provider thread key | `email_record_inbound` RPC |
| Message-ID / In-Reply-To threading | migration 0104 |
| Classification before any action | `lib/email/auto-reply.ts` |
| Reply attaches to a contact, stops the sequence | `reply-sync.ts` |

## LIMITATIONS — mandatory per §10

- **Integration tests were not run for this change.** Docker on the
  development machine is wedged: `com.docker.backend` starts, the engine VM
  never does, and neither socket responds. The reasoning says the fixtures
  still pass — `enroll()` inserts both an enrollment and an `email_messages`
  row, which is exactly what the new check looks for — but that is reasoning,
  not evidence. The nightly Integration workflow settles it.
- **The 254 historical events remain miscategorised.** Anything reading
  reply-rate over that period is still wrong, and correcting it would mean
  inferring which of them were genuine.
- **No backfill of `unrelated`.** Existing threads are not reclassified.

## COST IMPACT

**NONE.**
