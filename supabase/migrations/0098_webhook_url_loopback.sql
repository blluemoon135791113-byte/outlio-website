-- 0098 — allow a loopback webhook URL for local development (M8 Phase 25.5)
--
-- ⚠️ THE `https://` CONSTRAINT IN 0097 WAS RIGHT AND IS KEPT for every real
-- address. The payload carries a customer's own CRM data, and a signature
-- proves who SENT a message — not that nobody read it in transit.
--
-- What it also blocked was a developer pointing a subscription at their own
-- machine, which is how webhook integrations are actually built and tested.
-- Loopback over plain http is now permitted at the database level, and
-- `assertSafeWebhookUrl` refuses it in production — the same split the mail
-- endpoints already use (Phase 12): the database allows the shape, the
-- application decides the environment.
--
-- ⚠️ THE APPLICATION GUARD IS THE REAL CONTROL. A webhook URL is
-- customer-controlled, which makes it an SSRF vector: pointed at
-- 169.254.169.254 it reaches the cloud metadata service. The constraint below
-- cannot express that; `lib/api/webhook-url.ts` does.

alter table public.webhook_subscriptions
  drop constraint if exists webhook_subscriptions_url_check;

alter table public.webhook_subscriptions
  add constraint webhook_subscriptions_url_check
  check (
    url like 'https://%'
    or url like 'http://localhost:%'
    or url like 'http://localhost/%'
    or url like 'http://127.0.0.1:%'
    or url like 'http://127.0.0.1/%'
  );

comment on column public.webhook_subscriptions.url is
  'https, or plain http to loopback for local development. The SSRF check that '
  'refuses private networks lives in lib/api/webhook-url.ts, because a CHECK '
  'constraint cannot express it.';
