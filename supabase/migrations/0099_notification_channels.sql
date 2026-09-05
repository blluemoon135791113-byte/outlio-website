-- 0099 — Slack and Teams notification channels (M8 Phase 25)
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PROVIDER-NEUTRAL, LIKE EVERY OTHER INTEGRATION HERE. A channel is a URL, ║
-- ║  a provider name and the events it wants. Slack and Teams differ only in  ║
-- ║  how the message BODY is shaped, which lives in                          ║
-- ║  `lib/notifications/format.ts` and nowhere else.                         ║
-- ║                                                                           ║
-- ║  ⚠️ SEPARATE FROM `webhook_subscriptions` ON PURPOSE. A webhook delivers  ║
-- ║  a machine-readable EVENT to a consumer that will parse it; a channel     ║
-- ║  notification delivers a HUMAN SENTENCE to a room of people. They share   ║
-- ║  a shape and nothing else — one is an API contract that must stay stable, ║
-- ║  the other is copy we should be free to improve.                         ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

do $$
begin
  if not exists (select 1 from pg_type where typname = 'notification_provider') then
    create type public.notification_provider as enum ('slack', 'teams');
  end if;
end
$$;

create table if not exists public.notification_channels (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,

  name          text not null check (length(trim(name)) between 1 and 120),
  provider      public.notification_provider not null,

  /*
   * ⚠️ THE URL IS THE CREDENTIAL. A Slack incoming-webhook URL is
   * unauthenticated: anyone holding it can post to that channel as the app.
   * It is service-role only for the same reason the webhook signing secrets
   * are, and it is never returned to a browser.
   */
  /*
   * ⚠️ https, OR PLAIN HTTP TO LOOPBACK — the same split 0098 settled for
   * `webhook_subscriptions`: the database allows the shape, and
   * `lib/api/webhook-url.ts` refuses loopback in production. A constraint
   * cannot express "not a private network", so it must not pretend to.
   */
  url           text not null check (
                  url like 'https://%'
                  or url like 'http://localhost:%'
                  or url like 'http://localhost/%'
                  or url like 'http://127.0.0.1:%'
                  or url like 'http://127.0.0.1/%'
                ),

  /* Empty means every event. */
  events        text[] not null default '{}',

  is_active     boolean not null default true,
  failure_count integer not null default 0 check (failure_count >= 0),
  last_error    text,
  last_sent_at  timestamptz,

  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists notification_channels_workspace_idx
  on public.notification_channels (workspace_id)
  where is_active;

drop trigger if exists notification_channels_set_updated_at on public.notification_channels;
create trigger notification_channels_set_updated_at
  before update on public.notification_channels
  for each row execute function public.set_updated_at();

alter table public.notification_channels enable row level security;
revoke all on table public.notification_channels from public, anon, authenticated;
grant select, insert, update, delete on table public.notification_channels to service_role;

comment on table public.notification_channels is
  'Slack and Teams destinations. The URL is a credential -- a Slack incoming '
  'webhook is unauthenticated, so anyone holding the URL can post as the app -- '
  'hence service-role only, never returned to a browser.';
