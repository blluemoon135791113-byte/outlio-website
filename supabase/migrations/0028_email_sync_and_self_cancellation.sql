-- 0028 — profile email sync and self-service cancellation
--
-- Two gaps this closes:
--
-- 1. `profiles.email` was written once by handle_new_user() and never again, so
--    a user who changed their address in Supabase Auth would keep the old one
--    everywhere the app reads the profile. Email changes now propagate.
--
-- 2. There was no way for a customer to cancel. Access is decided from
--    `profiles.access_expires_at`, so a cancellation that only set
--    `subscriptions.cancel_at` would have changed nothing — the user would keep
--    full access forever and believe they had cancelled. Cancelling therefore
--    moves the profile's expiry too, and stores the previous value so that
--    resuming before the date restores exactly what was there before.

-- ---------------------------------------------------------------------------
-- 1. Keep profiles.email in step with auth.users.email
-- ---------------------------------------------------------------------------

create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set email = new.email
   where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.sync_profile_email();

-- Backfill any address that drifted before this trigger existed.
update public.profiles p
   set email = u.email
  from auth.users u
 where u.id = p.id
   and p.email is distinct from u.email;

-- ---------------------------------------------------------------------------
-- 2. Self-service cancellation
-- ---------------------------------------------------------------------------

-- Remembering the pre-cancellation expiry is what makes "resume" honest: a
-- user on non-expiring access gets non-expiring access back, not a guess.
alter table public.subscriptions
  add column if not exists access_expires_at_before_cancel timestamptz;

-- ---------------------------------------------------------------------------
-- request_subscription_cancellation
--
-- Schedules the end of access rather than ending it immediately: a customer who
-- has paid for the period keeps what they paid for. The subscription row and
-- the profile's expiry move in ONE transaction, so access can never diverge
-- from what the billing state says.
-- ---------------------------------------------------------------------------

create or replace function public.request_subscription_cancellation(
  p_user_id uuid
)
returns table (status text, ends_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub_id        uuid;
  v_status        public.subscription_status;
  v_cancel_at     timestamptz;
  v_period_end    timestamptz;
  v_profile_end   timestamptz;
  v_ends          timestamptz;
begin
  select s.id, s.status, s.cancel_at, s.current_period_end
    into v_sub_id, v_status, v_cancel_at, v_period_end
    from public.subscriptions s
   where s.user_id = p_user_id
   order by s.created_at desc
   limit 1
     for update;

  if v_sub_id is null then
    return query select 'no_subscription'::text, null::timestamptz;
    return;
  end if;

  if v_status <> 'active' then
    return query select 'not_active'::text, null::timestamptz;
    return;
  end if;

  if v_cancel_at is not null then
    return query select 'already_scheduled'::text, v_cancel_at;
    return;
  end if;

  select pr.access_expires_at into v_profile_end
    from public.profiles pr
   where pr.id = p_user_id
     for update;

  -- Prefer the billing period's end. With manual access and no expiry, fall
  -- back to the end of the current month, which is when credits reset anyway.
  v_ends := coalesce(
    v_period_end,
    v_profile_end,
    date_trunc('month', now()) + interval '1 month'
  );

  update public.subscriptions
     set cancel_at = v_ends,
         access_expires_at_before_cancel = v_profile_end,
         updated_at = now()
   where id = v_sub_id;

  -- Never EXTEND access: an expiry already earlier than the cancellation date
  -- stands as it is.
  update public.profiles
     set access_expires_at = v_ends
   where id = p_user_id
     and (access_expires_at is null or access_expires_at > v_ends);

  return query select 'ok'::text, v_ends;
end;
$$;

revoke all on function public.request_subscription_cancellation(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- resume_subscription — undo a scheduled cancellation before it takes effect.
-- ---------------------------------------------------------------------------

create or replace function public.resume_subscription(
  p_user_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub_id      uuid;
  v_cancel_at   timestamptz;
  v_restore_to  timestamptz;
begin
  select s.id, s.cancel_at, s.access_expires_at_before_cancel
    into v_sub_id, v_cancel_at, v_restore_to
    from public.subscriptions s
   where s.user_id = p_user_id
   order by s.created_at desc
   limit 1
     for update;

  if v_sub_id is null then
    return 'no_subscription';
  end if;

  if v_cancel_at is null then
    return 'not_scheduled';
  end if;

  -- Past the date the plan has genuinely lapsed. Reinstating it is a grant,
  -- which only an admin may perform.
  if v_cancel_at <= now() then
    return 'already_ended';
  end if;

  update public.profiles
     set access_expires_at = v_restore_to
   where id = p_user_id;

  update public.subscriptions
     set cancel_at = null,
         access_expires_at_before_cancel = null,
         updated_at = now()
   where id = v_sub_id;

  return 'ok';
end;
$$;

revoke all on function public.resume_subscription(uuid)
  from public, anon, authenticated;
