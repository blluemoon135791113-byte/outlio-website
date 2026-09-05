-- 0094 — an unambiguous credit spend for the Hubble boundary (M7 Phase 22)
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  `consume_credit` RETURNS -1 FOR TWO OPPOSITE THINGS.                     ║
-- ║                                                                           ║
-- ║  Reading 0015:                                                            ║
-- ║    if v_allowance is null then return -1;   -- UNLIMITED plan             ║
-- ║    if v_used > v_allowance then ... return -1;  -- EXHAUSTED              ║
-- ║                                                                           ║
-- ║  A caller cannot distinguish "this customer has no limit" from "this      ║
-- ║  customer has run out". Both are the most permissive and the most         ║
-- ║  restrictive answer at once, and a boundary built on it must guess:       ║
-- ║                                                                           ║
-- ║    - treat -1 as unlimited → exhausted customers get free AI forever      ║
-- ║    - treat -1 as exhausted → paying unlimited customers are blocked       ║
-- ║                                                                           ║
-- ║  M7 criterion 4 is precisely "credit-exhausted step fails gracefully",    ║
-- ║  which is unimplementable while the two are indistinguishable.            ║
-- ║                                                                           ║
-- ║  ⚠️ `consume_credit` IS LEFT UNTOUCHED. It has existing callers whose     ║
-- ║  behaviour must not change under them. This is a NEW function with an     ║
-- ║  explicit outcome, and Hubble is its only caller.                        ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

do $$
begin
  if not exists (select 1 from pg_type where typname = 'credit_spend_outcome') then
    create type public.credit_spend_outcome as enum (
      'spent',      -- charged; `remaining` says how many are left
      'unlimited',  -- no allowance applies; nothing was charged
      'exhausted'   -- the allowance is used up; NOTHING was charged
    );
  end if;
end
$$;

/**
 * Spends credits, saying plainly what happened.
 *
 * ⚠️ ATOMIC INCREMENT-THEN-CHECK, exactly as `consume_credit` does. Reading the
 * balance and then spending would let two concurrent Hubble steps both see
 * room for the last credit and both take it. The insert is the arbiter; a
 * spend that would exceed the allowance is rolled back within the same
 * statement, so an exhausted caller is charged nothing at all.
 */
create or replace function public.hubble_spend_credits(
  p_user_id      uuid,
  p_amount       integer default 1,
  p_period_start timestamptz default date_trunc('month', now()),
  p_period_end   timestamptz default date_trunc('month', now()) + interval '1 month'
)
returns table (
  outcome   public.credit_spend_outcome,
  remaining integer,
  allowance integer,
  used      integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_allowance int;
  v_used      bigint;
  v_role      public.user_role;
begin
  if p_amount < 0 then
    raise exception 'A credit spend cannot be negative.' using errcode = 'check_violation';
  end if;

  select role into v_role from public.profiles where id = p_user_id;

  /*
   * Platform admins are unlimited, consistent with the entitlements layer
   * (`resolveModules`). Reported as `unlimited` rather than as a huge number,
   * so the UI can say "unlimited" instead of "999999 left".
   */
  if v_role = 'admin' then
    return query select 'unlimited'::public.credit_spend_outcome, null::int, null::int, null::int;
    return;
  end if;

  select (p.limits ->> 'credits_per_month')::int
    into v_allowance
    from public.profiles pr
    join public.plans p on p.id = pr.plan_id
   where pr.id = p_user_id;

  -- No plan row, or a plan with no credit ceiling. Genuinely unlimited.
  if v_allowance is null then
    return query select 'unlimited'::public.credit_spend_outcome, null::int, null::int, null::int;
    return;
  end if;

  -- A zero spend is a legitimate question ("how many are left?") and must not
  -- create a usage row or change anything.
  if p_amount = 0 then
    select coalesce(count, 0) into v_used
      from public.usage_counters
     where user_id = p_user_id and metric = 'credits' and period_start = p_period_start;

    return query select
      case when v_used >= v_allowance then 'exhausted' else 'spent' end::public.credit_spend_outcome,
      greatest(v_allowance - v_used::int, 0),
      v_allowance,
      v_used::int;
    return;
  end if;

  insert into public.usage_counters (user_id, metric, period_start, period_end, count)
  values (p_user_id, 'credits', p_period_start, p_period_end, p_amount)
  on conflict (user_id, metric, period_start) do update
    set count = public.usage_counters.count + p_amount
  returning count into v_used;

  if v_used > v_allowance then
    -- ⚠️ ROLLED BACK IN FULL. An exhausted caller is charged NOTHING, so a
    -- failed Hubble step never costs the customer anything.
    update public.usage_counters
       set count = count - p_amount
     where user_id = p_user_id
       and metric = 'credits'
       and period_start = p_period_start;

    return query select
      'exhausted'::public.credit_spend_outcome,
      greatest(v_allowance - (v_used - p_amount)::int, 0),
      v_allowance,
      (v_used - p_amount)::int;
    return;
  end if;

  return query select
    'spent'::public.credit_spend_outcome,
    (v_allowance - v_used)::int,
    v_allowance,
    v_used::int;
end;
$$;

revoke all on function public.hubble_spend_credits(uuid, integer, timestamptz, timestamptz)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- hubble_refund_credits
--
-- ⚠️ A SEPARATE FUNCTION, NOT A NEGATIVE SPEND. Allowing `hubble_spend_credits`
-- to take a negative amount would make the one entry point that charges
-- customers also the one that can silently un-charge them, which is exactly
-- the kind of thing that should require typing a different name.
--
-- Refunds exist because the customer paid for an answer and did not get one.
-- Charging for a failed call is the small dishonesty that erodes trust in every
-- number the product shows.
-- ---------------------------------------------------------------------------

create or replace function public.hubble_refund_credits(
  p_user_id      uuid,
  p_amount       integer,
  p_period_start timestamptz default date_trunc('month', now())
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_used bigint;
begin
  if p_amount <= 0 then
    raise exception 'A refund must be positive.' using errcode = 'check_violation';
  end if;

  -- `greatest(..., 0)`: a refund can never push usage below zero and hand out
  -- credits the customer never had.
  update public.usage_counters
     set count = greatest(count - p_amount, 0)
   where user_id = p_user_id
     and metric = 'credits'
     and period_start = p_period_start
  returning count into v_used;

  return coalesce(v_used, 0)::int;
end;
$$;

revoke all on function public.hubble_refund_credits(uuid, integer, timestamptz)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- hubble_calls — what the AI boundary actually did.
--
-- ⚠️ EVERY EXECUTION IS RECORDED, INCLUDING THE ONES THAT WERE REFUSED. "Why
-- did my flow stop personalising?" is answerable only if a refusal left a row.
-- A log that records successes alone cannot explain a silence.
-- ---------------------------------------------------------------------------

create table if not exists public.hubble_calls (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid references public.workspaces(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,

  task          text not null,
  outcome       text not null check (outcome in ('ok', 'refused_no_credits', 'failed')),

  credits_quoted integer not null default 0 check (credits_quoted >= 0),
  credits_spent  integer not null default 0 check (credits_spent >= 0),

  /** Where it came from: a flow run, a manual action, a background sweep. */
  source        text,
  flow_run_id   uuid references public.flow_runs(id) on delete set null,

  duration_ms   integer,
  error_code    text,
  error_message text,

  created_at    timestamptz not null default now()
);

create index if not exists hubble_calls_workspace_idx
  on public.hubble_calls (workspace_id, created_at desc);

create index if not exists hubble_calls_user_idx
  on public.hubble_calls (user_id, created_at desc);

alter table public.hubble_calls enable row level security;

drop policy if exists hubble_calls_select_member on public.hubble_calls;
create policy hubble_calls_select_member on public.hubble_calls
  for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_admin());

revoke all on table public.hubble_calls from public, anon, authenticated;
grant select on table public.hubble_calls to authenticated;
grant select, insert on table public.hubble_calls to service_role;

comment on function public.hubble_spend_credits(uuid, integer, timestamptz, timestamptz) is
  'Unambiguous credit spend. `consume_credit` returns -1 for BOTH an unlimited '
  'plan and an exhausted one, which makes M7 criterion 4 unimplementable; this '
  'returns an explicit outcome. An exhausted spend is rolled back in full, so a '
  'refused call costs the customer nothing.';

comment on table public.hubble_calls is
  'Every AI execution, including refusals. A log of successes alone cannot '
  'answer "why did my flow stop personalising?".';
