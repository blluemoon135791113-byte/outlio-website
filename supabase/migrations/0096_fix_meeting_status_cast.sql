-- 0096 — fix an untyped CASE in 0095 (M8 Phase 24)
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  0095 APPLIED CLEANLY AND FAILED ON EVERY CALL.                          ║
-- ║                                                                           ║
-- ║    ERROR 42804: column "status" is of type meeting_status but             ║
-- ║                 expression is of type text                                ║
-- ║                                                                           ║
-- ║  The INSERT's status came from:                                          ║
-- ║                                                                           ║
-- ║    case p_type when 'cancelled' then 'cancelled' else 'scheduled' end    ║
-- ║                                                                           ║
-- ║  Every branch is an untyped literal, so the CASE resolves to `text` and   ║
-- ║  Postgres refuses to assign it to an enum column. Nothing in the function ║
-- ║  body is checked at CREATE time — a PL/pgSQL body is only parsed, not     ║
-- ║  type-resolved — so it was accepted and then broke on the first real      ║
-- ║  call. Exactly the shape of the 0072 bug fixed in 0073.                   ║
-- ║                                                                           ║
-- ║  ⚠️ THE HARNESS WOULD HAVE CAUGHT THIS. 0095 shipped without it because   ║
-- ║  Docker Desktop has been down since M7 Phase 20; the smoke test calls the ║
-- ║  function, which is the whole point of having one.                       ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

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
  -- Dedupe FIRST and cheaply: a replayed delivery must not reach the booking
  -- update, or a reschedule replay would bump reschedule_count again.
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
       originally_scheduled_at, status)
    values
      (p_workspace_id, p_provider, p_provider_event_id, p_contact_id, lower(p_invitee_email),
       p_invitee_name, p_owner_user_id, p_title, p_scheduled_at, p_ends_at, p_join_url,
       p_scheduled_at,
       /* ⚠️ THE FIX. Every branch was an untyped literal, so the CASE resolved
          to `text`. The cast is on the CASE rather than on one branch, so
          adding a branch later cannot reintroduce the bug. */
       (case p_type when 'cancelled' then 'cancelled' else 'scheduled' end)::public.meeting_status)
    returning * into v_booking;
  else
    v_previous := v_booking.scheduled_at;

    update public.meeting_bookings b
       set scheduled_at = case when p_type = 'rescheduled' then p_scheduled_at else b.scheduled_at end,
           ends_at      = coalesce(p_ends_at, b.ends_at),
           join_url     = coalesce(p_join_url, b.join_url),
           -- `originally_scheduled_at` is deliberately absent: criterion 3.
           reschedule_count = b.reschedule_count + case when p_type = 'rescheduled' then 1 else 0 end,
           status = (case p_type
                       when 'cancelled' then 'cancelled'
                       when 'no_show'   then 'no_show'
                       when 'completed' then 'completed'
                       else b.status::text
                     end)::public.meeting_status,
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

comment on function public.record_meeting_event(
  uuid, text, text, public.meeting_event_type, text, timestamptz, text, text, text,
  timestamptz, text, uuid, uuid, text, jsonb) is
  'Provider-neutral meeting recorder. Dedupes on the provider delivery id BEFORE '
  'touching the booking (M8 criterion 1) and never writes originally_scheduled_at '
  'twice (criterion 3).';
