-- 0116 — let the database decide which webhook deliveries are due
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  A DELIVERY'S DUE TIME WAS WRITTEN BY ONE CLOCK AND COMPARED BY ANOTHER.  ║
-- ║                                                                           ║
-- ║  `enqueue_webhook_delivery` inserts with `next_attempt_at` defaulting to   ║
-- ║  `now()` — the DATABASE clock. `deliverPendingWebhooks` then selected      ║
-- ║  `.lte('next_attempt_at', new Date().toISOString())` — the APPLICATION     ║
-- ║  clock. Whenever the database is ahead, a delivery that was just queued    ║
-- ║  is invisible to its own worker until the difference elapses.             ║
-- ║                                                                           ║
-- ║  Measured against staging on 2026-09-05, three samples:                   ║
-- ║                                                                           ║
-- ║      skew(db - local) = 1914ms, 1836ms, 1887ms                            ║
-- ║                                                                           ║
-- ║  and the resulting behaviour, queued and delivered back to back:          ║
-- ║                                                                           ║
-- ║      queued  = 1                                                          ║
-- ║      row     = pending, attempts 0, next_attempt_at 10:40:08.595Z         ║
-- ║      outcome = { delivered: 0, retrying: 0, exhausted: 0 }   ← found none ║
-- ║      row     = pending, attempts 0, untouched                             ║
-- ║                                                                           ║
-- ║  ⚠️ MILD IN PRODUCTION, WRONG EVERYWHERE. Vercel and Supabase are both     ║
-- ║  NTP-synced, so the gap there is milliseconds and the worker's next tick   ║
-- ║  collects anything it missed. Nothing is lost. But a due-time comparison   ║
-- ║  that spans two clocks is not a thing to leave in a retry loop, and it     ║
-- ║  makes the delivery test fail deterministically on any developer machine   ║
-- ║  whose clock has drifted — which is how it was found.                     ║
-- ║                                                                           ║
-- ║  ⚠️ IT WAS NOT SHARED-STATE POLLUTION, WHICH IS WHAT I FIRST ASSUMED.      ║
-- ║  `webhook_deliveries` was empty and `webhook_subscriptions` was zero when  ║
-- ║  the suite ran. Nor was it the SSRF guard: `assertSafeWebhookUrl` reports  ║
-- ║  ALLOWED for the loopback test server, because it permits loopback when    ║
-- ║  NODE_ENV is not production. Both were plausible and both were wrong.     ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- The fix is to ask the side that owns the timestamps. `next_attempt_at` is
-- written by the database, so the database decides when it has arrived.

create or replace function public.due_webhook_deliveries(p_limit integer default 20)
returns table (
  id              uuid,
  workspace_id    uuid,
  subscription_id uuid,
  event_id        uuid,
  event_type      text,
  payload         jsonb,
  attempts        integer,
  max_attempts    integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.id, d.workspace_id, d.subscription_id, d.event_id,
         d.event_type, d.payload, d.attempts, d.max_attempts
    from public.webhook_deliveries d
   where d.status = 'pending'
     /* ⚠️ `now()`, EVALUATED HERE. This is the whole migration: the comparison
        happens on the same clock that wrote the value. */
     and d.next_attempt_at <= now()
   order by d.next_attempt_at
   limit greatest(coalesce(p_limit, 20), 1);
$$;

-- ⚠️ The worker runs with the service role. No customer-facing caller has any
-- business enumerating deliveries across workspaces, and this function returns
-- rows from every one of them.
revoke all on function public.due_webhook_deliveries(integer) from public, anon, authenticated;
grant execute on function public.due_webhook_deliveries(integer) to service_role;

comment on function public.due_webhook_deliveries(integer) is
  'Deliveries whose next_attempt_at has arrived, judged by the database clock. '
  'Exists because next_attempt_at defaults to now() server-side while the worker '
  'was filtering with the application clock, so a freshly queued delivery was '
  'invisible to its own worker for the duration of any skew. See 0116.';
