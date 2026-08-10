-- 0029 — referrals and bonus credit grants
--
-- Every user gets a referral code. When someone signs up with it and is later
-- APPROVED, both sides receive bonus credits.
--
-- WHY APPROVAL AND NOT SIGNUP
--   Paying out at signup is farmable: a handful of throwaway addresses becomes
--   free credits. Approval is a human decision that already exists, so it
--   cannot be automated by an attacker. When real payments arrive, move the
--   call in lib/payments/grant.ts to the payment path — the SQL does not care
--   which event triggers it.
--
-- WHY A SEPARATE GRANTS TABLE
--   A credit balance is "plan allowance minus usage this month". Bonus credits
--   fit nowhere in that: raising `plans.limits` would raise it for every user on
--   the plan, and decrementing usage would corrupt the usage record. Grants are
--   additive allowance, scoped to one usage period so a grant can never be
--   counted twice.

-- ---------------------------------------------------------------------------
-- 1. Referral codes on profiles
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists referral_code text;

create unique index if not exists profiles_referral_code_key
  on public.profiles (referral_code)
  where referral_code is not null;

-- Ambiguous characters are excluded: a code gets read aloud and retyped.
create or replace function public.generate_referral_code()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code     text;
  v_attempt  int := 0;
begin
  loop
    v_code := '';
    for _ in 1..8 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;

    exit when not exists (
      select 1 from public.profiles where referral_code = v_code
    );

    v_attempt := v_attempt + 1;
    if v_attempt > 20 then
      raise exception 'Could not allocate a unique referral code';
    end if;
  end loop;

  return v_code;
end;
$$;

revoke all on function public.generate_referral_code()
  from public, anon, authenticated;

-- Existing accounts get one too, so referrals work from the moment this lands.
do $$
declare
  r record;
begin
  for r in select id from public.profiles where referral_code is null loop
    update public.profiles
       set referral_code = public.generate_referral_code()
     where id = r.id;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. referrals
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.referral_status as enum ('pending', 'rewarded', 'void');
exception when duplicate_object then null; end $$;

create table if not exists public.referrals (
  id               uuid primary key default gen_random_uuid(),
  referrer_id      uuid not null references public.profiles(id) on delete cascade,
  -- One row per referred user: nobody can be referred twice.
  referred_user_id uuid not null unique references public.profiles(id) on delete cascade,
  code             text not null,
  status           public.referral_status not null default 'pending',
  rewarded_at      timestamptz,
  created_at       timestamptz not null default now(),
  -- Self-referral is not a referral.
  constraint referrals_not_self check (referrer_id <> referred_user_id)
);

create index if not exists referrals_referrer_idx on public.referrals (referrer_id);
create index if not exists referrals_status_idx on public.referrals (status);

alter table public.referrals enable row level security;

drop policy if exists referrals_select_own on public.referrals;
create policy referrals_select_own on public.referrals
  for select to authenticated
  using (referrer_id = auth.uid() or referred_user_id = auth.uid());

drop policy if exists referrals_admin_select on public.referrals;
create policy referrals_admin_select on public.referrals
  for select to authenticated
  using (public.is_admin());

-- No insert/update/delete policy: rows are written by security-definer
-- functions only. A user must never be able to invent their own referral.

-- ---------------------------------------------------------------------------
-- 3. credit_grants — additive allowance for a single usage period
-- ---------------------------------------------------------------------------

create table if not exists public.credit_grants (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  amount       int not null check (amount > 0),
  reason       text not null,
  -- Must match usage_counters.period_start exactly, or the grant would be
  -- re-counted every month.
  period_start timestamptz not null,
  referral_id  uuid references public.referrals(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists credit_grants_lookup_idx
  on public.credit_grants (user_id, period_start);

-- Paying out the same referral twice is the failure mode that matters.
create unique index if not exists credit_grants_referral_once_idx
  on public.credit_grants (referral_id, user_id)
  where referral_id is not null;

alter table public.credit_grants enable row level security;

drop policy if exists credit_grants_select_own on public.credit_grants;
create policy credit_grants_select_own on public.credit_grants
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- 4. record_referral — attribution at signup
--
-- Never raises. A wrong or missing code must not cost someone their signup.
-- ---------------------------------------------------------------------------

create or replace function public.record_referral(
  p_referred_user_id uuid,
  p_code             text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referrer uuid;
  v_code     text := upper(trim(coalesce(p_code, '')));
begin
  if v_code = '' then
    return 'no_code';
  end if;

  select id into v_referrer
    from public.profiles
   where referral_code = v_code
     and deleted_at is null;

  if v_referrer is null then
    return 'unknown_code';
  end if;

  if v_referrer = p_referred_user_id then
    return 'self_referral';
  end if;

  insert into public.referrals (referrer_id, referred_user_id, code)
  values (v_referrer, p_referred_user_id, v_code)
  on conflict (referred_user_id) do nothing;

  return 'ok';
exception when others then
  -- Attribution is never worth failing a signup over.
  return 'error';
end;
$$;

revoke all on function public.record_referral(uuid, text)
  from public, anon, authenticated;

-- Capture the code from signup metadata. A SEPARATE trigger from
-- handle_new_user, which raises to block unauthorized signups — referral
-- attribution must never be able to trip that wire.
create or replace function public.capture_signup_referral()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.record_referral(
    new.id,
    nullif(new.raw_user_meta_data ->> 'referral_code', '')
  );
  return new;
end;
$$;

-- Named to sort AFTER on_auth_user_created so the profile row already exists.
drop trigger if exists zz_on_auth_user_referral on auth.users;
create trigger zz_on_auth_user_referral
  after insert on auth.users
  for each row execute function public.capture_signup_referral();

-- ---------------------------------------------------------------------------
-- 5. reward_pending_referral — pays BOTH sides, once
--
-- Idempotent: the unique index on (referral_id, user_id) makes a double call a
-- no-op rather than a double payout.
-- ---------------------------------------------------------------------------

create or replace function public.reward_pending_referral(
  p_referred_user_id uuid,
  p_amount           int
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referral_id  uuid;
  v_referrer_id  uuid;
  v_status       public.referral_status;
  v_period_start timestamptz := date_trunc('month', now());
begin
  if p_amount is null or p_amount <= 0 then
    return 'invalid_amount';
  end if;

  select id, referrer_id, status
    into v_referral_id, v_referrer_id, v_status
    from public.referrals
   where referred_user_id = p_referred_user_id
     for update;

  if v_referral_id is null then
    return 'no_referral';
  end if;

  if v_status <> 'pending' then
    return 'already_rewarded';
  end if;

  insert into public.credit_grants (user_id, amount, reason, period_start, referral_id)
  values
    (v_referrer_id,      p_amount, 'referral_reward', v_period_start, v_referral_id),
    (p_referred_user_id, p_amount, 'referral_bonus',  v_period_start, v_referral_id)
  on conflict do nothing;

  update public.referrals
     set status = 'rewarded',
         rewarded_at = now()
   where id = v_referral_id;

  return 'ok';
end;
$$;

revoke all on function public.reward_pending_referral(uuid, int)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Bonus credits must count. Both the balance read and the spend path.
-- ---------------------------------------------------------------------------

create or replace function public.granted_credits(
  p_user_id      uuid,
  p_period_start timestamptz
)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount), 0)::int
    from public.credit_grants
   where user_id = p_user_id
     and period_start = p_period_start;
$$;

revoke all on function public.granted_credits(uuid, timestamptz)
  from public, anon, authenticated;

create or replace function public.consume_credit(
  p_user_id      uuid,
  p_amount       int default 1,
  p_period_start timestamptz default date_trunc('month', now()),
  p_period_end   timestamptz default date_trunc('month', now()) + interval '1 month'
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowance int;
  v_used      bigint;
  v_role      public.user_role;
begin
  select role into v_role from public.profiles where id = p_user_id;
  if v_role = 'admin' then
    return 999999;
  end if;

  select (p.limits ->> 'credits_per_month')::int
    into v_allowance
    from public.profiles pr
    join public.plans p on p.id = pr.plan_id
   where pr.id = p_user_id;

  -- No plan, or an unlimited plan.
  if v_allowance is null then
    return -1;
  end if;

  -- Referral and other bonus credits are spendable exactly like plan credits.
  v_allowance := v_allowance + public.granted_credits(p_user_id, p_period_start);

  insert into public.usage_counters (user_id, metric, period_start, period_end, count)
  values (p_user_id, 'credits', p_period_start, p_period_end, p_amount)
  on conflict (user_id, metric, period_start) do update
    set count = public.usage_counters.count + p_amount
  returning count into v_used;

  if v_used > v_allowance then
    -- Roll back the spend: the caller gets nothing and the balance is untouched.
    update public.usage_counters
       set count = count - p_amount
     where user_id = p_user_id
       and metric = 'credits'
       and period_start = p_period_start;
    return -1;
  end if;

  return v_allowance - v_used::int;
end;
$$;

revoke all on function public.consume_credit(uuid, int, timestamptz, timestamptz)
  from public, anon, authenticated;

-- Adding the `granted` column changes the OUT row type, which `create or
-- replace` cannot do. Nothing in SQL depends on this function — only the app
-- calls it — so dropping it is safe.
drop function if exists public.credit_balance(uuid);

create or replace function public.credit_balance(p_user_id uuid)
returns table (allowance int, used int, remaining int, granted int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowance    int;
  v_used         int;
  v_granted      int;
  v_period_start timestamptz := date_trunc('month', now());
begin
  select (p.limits ->> 'credits_per_month')::int
    into v_allowance
    from public.profiles pr
    join public.plans p on p.id = pr.plan_id
   where pr.id = p_user_id;

  select coalesce(count, 0)::int into v_used
    from public.usage_counters
   where user_id = p_user_id
     and metric = 'credits'
     and period_start = v_period_start;

  v_granted := public.granted_credits(p_user_id, v_period_start);

  granted   := v_granted;
  allowance := coalesce(v_allowance, 0) + v_granted;
  used      := coalesce(v_used, 0);
  remaining := greatest(allowance - used, 0);
  return next;
end;
$$;

revoke all on function public.credit_balance(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. referral_summary — what the dashboard card shows.
-- ---------------------------------------------------------------------------

create or replace function public.referral_summary(p_user_id uuid)
returns table (code text, pending int, rewarded int, credits_earned int)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select referral_code from public.profiles where id = p_user_id),
    (select count(*)::int from public.referrals
      where referrer_id = p_user_id and status = 'pending'),
    (select count(*)::int from public.referrals
      where referrer_id = p_user_id and status = 'rewarded'),
    (select coalesce(sum(amount), 0)::int from public.credit_grants
      where user_id = p_user_id and reason = 'referral_reward');
$$;

revoke all on function public.referral_summary(uuid) from public, anon, authenticated;
