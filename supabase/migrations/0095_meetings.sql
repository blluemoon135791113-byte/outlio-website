-- 0095 — meetings, as normalized internal events (M8 Phase 24)
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  NOTHING HERE IS CALENDLY-SHAPED. That is M8 criterion 4: "no integration ║
-- ║  logic inside CRM controllers (adapter + events only)".                   ║
-- ║                                                                           ║
-- ║  The adapter's whole job is to turn a provider's payload into a           ║
-- ║  `meeting_events` row. Everything downstream — matching a contact,        ║
-- ║  writing a CALL_BOOKED activity, notifying an owner, triggering a flow —  ║
-- ║  reads only these tables and never learns which provider it came from.    ║
-- ║  Calendly is the first; Cal.com, HubSpot Meetings and a plain ICS feed    ║
-- ║  would each add an adapter and change nothing else.                       ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

do $$
begin
  if not exists (select 1 from pg_type where typname = 'meeting_event_type') then
    create type public.meeting_event_type as enum (
      'booked',
      'cancelled',
      /*
       * ⚠️ ITS OWN TYPE, NOT a cancel followed by a book. M8 criterion 3 is
       * that a reschedule PRESERVES the original booking history — modelling
       * it as two events would lose the fact that they are the same meeting,
       * and a report counting bookings would double-count it.
       */
      'rescheduled',
      'no_show',
      'completed'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'meeting_status') then
    create type public.meeting_status as enum (
      'scheduled', 'cancelled', 'completed', 'no_show'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- meeting_bookings — the CURRENT state of one meeting.
-- ---------------------------------------------------------------------------

create table if not exists public.meeting_bookings (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,

  /* Which integration produced it. Text, not an enum: a new provider must not
     need a migration to be recorded. */
  provider        text not null,
  /* The provider's own id for the meeting, stable across reschedules. */
  provider_event_id text not null,

  contact_id      uuid references public.crm_contacts(id),
  /* Frozen: the address the invitee actually booked with. */
  invitee_email   text not null check (invitee_email = lower(invitee_email)),
  invitee_name    text,

  owner_user_id   uuid references auth.users(id) on delete set null,

  title           text,
  status          public.meeting_status not null default 'scheduled',

  scheduled_at    timestamptz not null,
  ends_at         timestamptz,
  join_url        text,

  /*
   * ⚠️ THE FIRST TIME IT WAS EVER BOOKED, never overwritten. `scheduled_at`
   * moves with each reschedule; this does not. "They rebooked three times and
   * the original was a month ago" is the fact a salesperson needs, and it is
   * unrecoverable if only the latest time is kept.
   */
  originally_scheduled_at timestamptz not null,
  reschedule_count integer not null default 0 check (reschedule_count >= 0),

  cancelled_at    timestamptz,
  cancel_reason   text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists meeting_bookings_provider_idx
  on public.meeting_bookings (workspace_id, provider, provider_event_id);

create index if not exists meeting_bookings_contact_idx
  on public.meeting_bookings (contact_id, scheduled_at desc);

create index if not exists meeting_bookings_workspace_idx
  on public.meeting_bookings (workspace_id, scheduled_at desc);

drop trigger if exists meeting_bookings_set_updated_at on public.meeting_bookings;
create trigger meeting_bookings_set_updated_at
  before update on public.meeting_bookings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- meeting_events — append-only history. CRITERION 1 and CRITERION 3.
-- ---------------------------------------------------------------------------

create table if not exists public.meeting_events (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  booking_id      uuid references public.meeting_bookings(id),

  type            public.meeting_event_type not null,
  provider        text not null,

  /*
   * ⚠️ CRITERION 1. The provider's own DELIVERY id, unique per workspace, so a
   * replayed or duplicated webhook writes nothing the second time and cannot
   * create a second activity.
   */
  provider_delivery_id text,

  occurred_at     timestamptz not null default now(),

  /* For a reschedule: where it moved FROM and TO. Both kept, so the history
     is readable without diffing consecutive rows. */
  previous_scheduled_at timestamptz,
  new_scheduled_at      timestamptz,

  /* Safe detail only. Never the invitee's answers to booking questions, which
     are free text a customer may treat as confidential. */
  metadata        jsonb not null default '{}'::jsonb,

  created_at      timestamptz not null default now()
);

create unique index if not exists meeting_events_delivery_idx
  on public.meeting_events (workspace_id, provider, provider_delivery_id)
  where provider_delivery_id is not null;

create index if not exists meeting_events_booking_idx
  on public.meeting_events (booking_id, occurred_at);

/* Append-only, reusing the CRM guard. History that can be edited is not
   history, and criterion 3 asks it to be preserved. */
drop trigger if exists meeting_events_append_only on public.meeting_events;
create trigger meeting_events_append_only
  before update or delete on public.meeting_events
  for each row execute function public.crm_guard_append_only();

-- ---------------------------------------------------------------------------
-- meeting_unmatched_invitees — CRITERION 2.
--
-- ⚠️ AN UNMATCHED INVITEE IS QUEUED, NEVER DROPPED AND NEVER A CRASH. Someone
-- booking with an address we have never seen is the NORMAL case for inbound —
-- a referral, a personal address, a colleague forwarding the link. Discarding
-- it loses a booked meeting; auto-creating a contact would fabricate a record
-- from a single email address.
-- ---------------------------------------------------------------------------

create table if not exists public.meeting_unmatched_invitees (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  booking_id    uuid not null references public.meeting_bookings(id) on delete cascade,

  invitee_email text not null check (invitee_email = lower(invitee_email)),
  invitee_name  text,

  resolved_at       timestamptz,
  resolved_contact_id uuid references public.crm_contacts(id),
  resolved_by       uuid references auth.users(id) on delete set null,

  created_at    timestamptz not null default now()
);

create index if not exists meeting_unmatched_pending_idx
  on public.meeting_unmatched_invitees (workspace_id, created_at desc)
  where resolved_at is null;

-- ---------------------------------------------------------------------------
-- record_meeting_event — the only way a meeting changes.
--
-- Returns the booking id and whether this delivery was NEW. The caller acts
-- (writes an activity, notifies, triggers a flow) only when it was new, which
-- is what makes criterion 1 hold.
-- ---------------------------------------------------------------------------

create or replace function public.record_meeting_event(
  p_workspace_id  uuid,
  p_provider      text,
  p_provider_event_id text,
  p_type          public.meeting_event_type,
  p_invitee_email text,
  p_scheduled_at  timestamptz,
  p_delivery_id   text default null,
  p_invitee_name  text default null,
  p_title         text default null,
  p_ends_at       timestamptz default null,
  p_join_url      text default null,
  p_owner_user_id uuid default null,
  p_contact_id    uuid default null,
  p_cancel_reason text default null,
  p_metadata      jsonb default '{}'::jsonb
)
returns table (booking_id uuid, is_new boolean, was_matched boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking public.meeting_bookings%rowtype;
  v_event_id uuid;
  v_previous timestamptz;
begin
  /*
   * ⚠️ THE DEDUPE HAPPENS FIRST AND CHEAPLY. A replayed delivery must not even
   * reach the booking update, or a reschedule replay would bump
   * reschedule_count a second time.
   */
  if p_delivery_id is not null then
    perform 1 from public.meeting_events
     where workspace_id = p_workspace_id
       and provider = p_provider
       and provider_delivery_id = p_delivery_id;

    if found then
      select b.* into v_booking from public.meeting_bookings b
       where b.workspace_id = p_workspace_id
         and b.provider = p_provider
         and b.provider_event_id = p_provider_event_id;

      return query select v_booking.id, false, v_booking.contact_id is not null;
      return;
    end if;
  end if;

  select b.* into v_booking
    from public.meeting_bookings b
   where b.workspace_id = p_workspace_id
     and b.provider = p_provider
     and b.provider_event_id = p_provider_event_id;

  if not found then
    insert into public.meeting_bookings
      (workspace_id, provider, provider_event_id, contact_id, invitee_email,
       invitee_name, owner_user_id, title, scheduled_at, ends_at, join_url,
       originally_scheduled_at,
       status)
    values
      (p_workspace_id, p_provider, p_provider_event_id, p_contact_id, lower(p_invitee_email),
       p_invitee_name, p_owner_user_id, p_title, p_scheduled_at, p_ends_at, p_join_url,
       p_scheduled_at,
       case p_type when 'cancelled' then 'cancelled' else 'scheduled' end)
    returning * into v_booking;
  else
    v_previous := v_booking.scheduled_at;

    update public.meeting_bookings b
       set scheduled_at = case when p_type = 'rescheduled' then p_scheduled_at else b.scheduled_at end,
           ends_at      = coalesce(p_ends_at, b.ends_at),
           join_url     = coalesce(p_join_url, b.join_url),
           /*
            * ⚠️ `originally_scheduled_at` IS NEVER TOUCHED. This is criterion 3:
            * the first booking survives every reschedule.
            */
           reschedule_count = b.reschedule_count + case when p_type = 'rescheduled' then 1 else 0 end,
           status = case p_type
                      when 'cancelled' then 'cancelled'
                      when 'no_show'   then 'no_show'
                      when 'completed' then 'completed'
                      else b.status
                    end,
           cancelled_at  = case when p_type = 'cancelled' then now() else b.cancelled_at end,
           cancel_reason = coalesce(p_cancel_reason, b.cancel_reason),
           contact_id    = coalesce(b.contact_id, p_contact_id)
     where b.id = v_booking.id
    returning * into v_booking;
  end if;

  insert into public.meeting_events
    (workspace_id, booking_id, type, provider, provider_delivery_id, occurred_at,
     previous_scheduled_at, new_scheduled_at, metadata)
  values
    (p_workspace_id, v_booking.id, p_type, p_provider, p_delivery_id, now(),
     v_previous, case when p_type = 'rescheduled' then p_scheduled_at else null end, p_metadata)
  on conflict (workspace_id, provider, provider_delivery_id)
    where provider_delivery_id is not null
    do nothing
  returning id into v_event_id;

  return query select v_booking.id, v_event_id is not null, v_booking.contact_id is not null;
end;
$$;

revoke all on function public.record_meeting_event(
  uuid, text, text, public.meeting_event_type, text, timestamptz, text, text, text,
  timestamptz, text, uuid, uuid, text, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['meeting_bookings', 'meeting_events', 'meeting_unmatched_invitees'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_member', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.is_workspace_member(workspace_id) or public.is_admin())',
      t || '_select_member', t
    );
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end
$$;

comment on table public.meeting_bookings is
  'Provider-neutral. `originally_scheduled_at` survives every reschedule (M8 '
  'criterion 3); `scheduled_at` is the current time.';

comment on table public.meeting_unmatched_invitees is
  'Someone booking from an address we have never seen is the NORMAL inbound '
  'case. Queued for a human rather than dropped, and never auto-created as a '
  'contact from an email address alone.';
