# How the background tick is scheduled

`/api/cron` runs every background worker once: reap stale claims, send queued
email, sync replies, advance waiting flows, deliver webhooks. Something has to
call it on a schedule.

## Why not Vercel Cron alone

**The Hobby plan allows one cron invocation per day.** For a product whose send
worker paces email through a ramp and a sending window, one tick a day means a
campaign takes weeks to go out and a reply is noticed tomorrow. That is not a
slower product; it is a broken one.

So there are two schedulers, deliberately:

| Scheduler | Cadence | Role |
|---|---|---|
| `.github/workflows/cron.yml` | every 5 min | **the real one** |
| `vercel.json` | daily, 06:00 UTC | a floor, in case the Action is disabled |

The Vercel entry is not redundant. If the GitHub Action is disabled, its secret
rotates, or the repository is archived, the queue still drains once a day
instead of never — which is the failure this whole phase existed to fix, and it
should not be able to come back silently.

⚠️ **GitHub delays scheduled runs under load**, sometimes by several minutes,
and skips them during incidents. That is acceptable *because the tick is
idempotent and claim-based*: a late tick does the same work and a missed one
leaves the queue for the next. It would not be acceptable for anything that had
to happen at an exact time.

## Setup

Both callers need the same secret. Generate one:

```bash
openssl rand -base64 32
```

1. **Vercel** → Project → Settings → Environment Variables → `CRON_SECRET`.
   Vercel sends it automatically as `Authorization: Bearer <secret>` for its own
   cron. Redeploy after adding it.
2. **GitHub** → repository → Settings → Secrets and variables → Actions → New
   repository secret → `CRON_SECRET`, same value.
3. Optionally set an Actions *variable* `APP_URL` if the app is not at
   `https://app.outlio.io`.

⚠️ **The endpoint fails closed.** Until `CRON_SECRET` is set in Vercel, every
request is refused with 401 and nothing sends. That is deliberate: this route
sends email, and an open one lets anyone drain a customer's daily allowance and
burn their sending-domain reputation.

## Checking it works

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" https://app.outlio.io/api/cron
```

A healthy response is `200` with a per-job report:

```json
{
  "jobs": {
    "reap_email_claims": { "ok": true, "detail": "0 stale claims released" },
    "send_email":        { "ok": true, "detail": "2 claimed, 2 sent, 0 failed, 0 skipped" },
    "sync_replies":      { "ok": true, "detail": "1 workspace(s), 0 replies, 0 failed" },
    "advance_flows":     { "ok": true, "detail": "0 run(s) advanced, 0 failed" },
    "deliver_webhooks":  { "ok": true, "detail": "0 delivered, 0 retrying, 0 exhausted" }
  },
  "durationMs": 812
}
```

A `401` means `CRON_SECRET` is missing or mismatched.

⚠️ **A 200 with a failing job inside is intentional.** Schedulers retry on a
non-2xx, and retrying the whole tick because one workspace's mailbox is
misconfigured would re-do the sends that already succeeded. Read `jobs` to see
what failed.

## If you outgrow this

The tick is bounded — 25 emails, 20 flow runs, 20 webhooks, 10 mailboxes per
run — and leaves the rest for the next tick. When a single tick can no longer
keep up with the queue, that is the signal to move to a long-running worker
loop, which the Ledger has always described as the eventual destination. The
queue semantics do not change: same claims, same `FOR UPDATE SKIP LOCKED`, same
reaper.
