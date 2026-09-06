-- 0090 — email events and webhook idempotency (M6 Phase 17)
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  EVENTS ARE APPEND-ONLY AND ARE THE SOURCE OF EVERY EMAIL METRIC.        ║
-- ║                                                                           ║
-- ║  M6 criterion 5 is that campaign reports reconcile with raw email_events. ║
-- ║  That is only possible if the events are the RECORD rather than a         ║
-- ║  by-product: no counter columns updated alongside, nothing that can drift ║
-- ║  from the stream it is supposed to summarise.                            ║
-- ║                                                                           ║
-- ║  M6 criterion 4 is that duplicate provider webhooks are processed exactly ║
-- ║  once. Providers retry aggressively and deliver out of order — Gmail and  ║
-- ║  SES both guarantee AT-LEAST-once, never exactly-once. Dedupe therefore   ║
-- ║  cannot be optional, and it cannot live in application memory.           ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

do $$
begin
  if not exists (select 1 from pg_type where typname = 'email_event_type') then
    create type public.email_event_type as enum (
      'queued',
      'sent',
      'delivered',
      'replied',
      -- Recorded, but NEVER counted as a reply. Kept as its own type so the
      -- timeline can show "they are away until Tuesday" without the reply rate
      -- absorbing it.
      'auto_replied',
      'bounced',
      'failed',
      'unsubscribed',
      'complaint',
      /*
       * ⚠️ OPENS AND CLICKS ARE DELIBERATELY LAST AND DELIBERATELY OPTIONAL.
       * The brief says "do not over-rely on opens", and it is right: Apple
       * Mail Privacy Protection pre-fetches every image, so an "open" from an
       * Apple device means a machine loaded a pixel, not that a human read
       * anything. They are recorded where configured and must never gate a
       * sequence branch on their own.
       */
      'opened',
      'clicked'
    );
  end if;
end
$$;

create table if not exists public.email_events (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,

  -- Nullable: an event can arrive for a message we no longer hold, and losing
  -- the event would be worse than holding an orphan.
  message_id     uuid references public.email_messages(id) on delete set null,
  enrollment_id  uuid references public.email_enrollments(id) on delete set null,
  campaign_id    uuid references public.email_campaigns(id) on delete set null,
  contact_id     uuid references public.crm_contacts(id) on delete set null,

  type           public.email_event_type not null,
  email          text not null check (email = lower(email)),

  occurred_at    timestamptz not null default now(),

  /*
   * ⚠️ THE PROVIDER'S OWN EVENT ID — THIS IS CRITERION 4.
   *
   * Unique per workspace, so replaying the same webhook writes nothing the
   * second time. NULL for events we generate ourselves (queued, sent), which
   * is why the unique index below is partial: a NULL here means "not from a
   * provider", and several such events legitimately coexist.
   */
  provider_event_id text,

  /* Safe detail only: bounce codes, classifier reasons. Never message bodies. */
  metadata       jsonb not null default '{}'::jsonb,

  created_at     timestamptz not null default now()
);

create unique index if not exists email_events_provider_dedupe_idx
  on public.email_events (workspace_id, provider_event_id)
  where provider_event_id is not null;

create index if not exists email_events_message_idx
  on public.email_events (message_id, occurred_at);

create index if not exists email_events_campaign_type_idx
  on public.email_events (campaign_id, type, occurred_at);

create index if not exists email_events_workspace_type_idx
  on public.email_events (workspace_id, type, occurred_at desc);

create index if not exists email_events_contact_idx
  on public.email_events (contact_id, occurred_at desc);

/*
 * ⚠️ APPEND-ONLY, ENFORCED. Reuses the same guard the CRM activity stream uses
 * (0075). An event stream that can be edited is not evidence, and criterion 5
 * asks reports to reconcile against it.
 */
drop trigger if exists email_events_append_only on public.email_events;
create trigger email_events_append_only
  before update or delete on public.email_events
  for each row execute function public.crm_guard_append_only();

alter table public.email_events enable row level security;

drop policy if exists email_events_select_member on public.email_events;
create policy email_events_select_member on public.email_events
  for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_admin());

revoke all on table public.email_events from public, anon, authenticated;
grant select on table public.email_events to authenticated;
grant select, insert on table public.email_events to service_role;

-- ---------------------------------------------------------------------------
-- email_webhook_deliveries
--
-- ⚠️ DEDUPE AT THE DELIVERY, NOT ONLY AT THE EVENT. One webhook POST may carry
-- a batch of events. Recording the delivery separately means a retry of the
-- whole POST is rejected before any of its contents are re-processed, which is
-- both cheaper and safer than relying on each event's own uniqueness.
-- ---------------------------------------------------------------------------

create table if not exists public.email_webhook_deliveries (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid references public.workspaces(id) on delete cascade,
  provider       public.email_provider not null,

  /* The provider's delivery id, or a hash of the body when it sends none. */
  delivery_key   text not null,

  received_at    timestamptz not null default now(),
  event_count    integer not null default 0,
  /* Null while processing, set when finished. A row that never gets one is a
     crash, and is visible as such rather than silently retried. */
  processed_at   timestamptz
);

create unique index if not exists email_webhook_deliveries_key_idx
  on public.email_webhook_deliveries (provider, delivery_key);

alter table public.email_webhook_deliveries enable row level security;
revoke all on table public.email_webhook_deliveries from public, anon, authenticated;
grant select, insert, update on table public.email_webhook_deliveries to service_role;

comment on table public.email_webhook_deliveries is
  'Webhook replay protection. Providers guarantee at-least-once delivery, so a '
  'duplicate POST is normal traffic rather than an attack.';

-- ---------------------------------------------------------------------------
-- record_email_event — the only way an event is written.
--
-- Returns TRUE when the event was new, FALSE when it was a duplicate. The
-- caller uses that to decide whether to act (stop a sequence, suppress an
-- address) — so an action can never fire twice for one provider event.
-- ---------------------------------------------------------------------------

create or replace function public.record_email_event(
  p_workspace_id      uuid,
  p_type              public.email_event_type,
  p_email             text,
  p_message_id        uuid default null,
  p_enrollment_id     uuid default null,
  p_campaign_id       uuid default null,
  p_contact_id        uuid default null,
  p_provider_event_id text default null,
  p_occurred_at       timestamptz default now(),
  p_metadata          jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inserted uuid;
begin
  insert into public.email_events
    (workspace_id, type, email, message_id, enrollment_id, campaign_id,
     contact_id, provider_event_id, occurred_at, metadata)
  values
    (p_workspace_id, p_type, lower(p_email), p_message_id, p_enrollment_id,
     p_campaign_id, p_contact_id, p_provider_event_id, p_occurred_at, p_metadata)
  /*
   * ⚠️ ON CONFLICT DO NOTHING IS THE IDEMPOTENCY. Checking for an existing row
   * first and inserting second would leave a race between two concurrent
   * webhook deliveries of the same event — and providers retry in parallel.
   * The unique index arbitrates; this just reports the outcome.
   */
  on conflict (workspace_id, provider_event_id)
    where provider_event_id is not null
    do nothing
  returning id into v_inserted;

  return v_inserted is not null;
end;
$$;

revoke all on function public.record_email_event(
  uuid, public.email_event_type, text, uuid, uuid, uuid, uuid, text, timestamptz, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- campaign_event_totals — criterion 5's reconciliation surface.
--
-- ⚠️ COUNTED FROM THE EVENT STREAM, NOT FROM COUNTER COLUMNS. There are no
-- counters to drift. `replied` deliberately excludes `auto_replied`.
-- ---------------------------------------------------------------------------

create or replace function public.campaign_event_totals(p_campaign_id uuid)
returns table (
  sent          bigint,
  delivered     bigint,
  replied       bigint,
  auto_replied  bigint,
  bounced       bigint,
  unsubscribed  bigint,
  complaints    bigint,
  failed        bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    count(*) filter (where e.type = 'sent'),
    count(*) filter (where e.type = 'delivered'),
    count(*) filter (where e.type = 'replied'),
    count(*) filter (where e.type = 'auto_replied'),
    count(*) filter (where e.type = 'bounced'),
    count(*) filter (where e.type = 'unsubscribed'),
    count(*) filter (where e.type = 'complaint'),
    count(*) filter (where e.type = 'failed')
  from public.email_events e
  where e.campaign_id = p_campaign_id;
$$;

revoke all on function public.campaign_event_totals(uuid)
  from public, anon, authenticated;

comment on table public.email_events is
  'Append-only. The source of every email metric — reports reconcile against '
  'this rather than against counters that could drift (M6 criterion 5). '
  'auto_replied is its own type and never counts as a reply.';
