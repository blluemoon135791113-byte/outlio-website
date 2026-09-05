-- 0069 — FastSpring charge records and paid-period credit allocation
--
-- 0068 mirrors FastSpring state and reconciles entitlement. This adds the money
-- half: a durable record of every charge attempt, and credit replenishment on a
-- successful one.
--
-- Credits in this system are allowanced per CALENDAR month
-- (`date_trunc('month', now())` in consume_credit, credit_balance,
-- granted_credits, charge_extraction_leads and finalize_upload_job), while
-- FastSpring rebills on the subscription anniversary. Rather than re-period the
-- whole credit system, a successful charge tops the user back up to a full plan
-- allowance for the current period using the existing `credit_grants`
-- mechanism. See grant_fastspring_period_credits for why that is exact.

-- ---------------------------------------------------------------------------
-- Charge records — one row per charge attempt, successful or not
-- ---------------------------------------------------------------------------

create table if not exists public.fastspring_charges (
  -- Keyed by the webhook event, not the order: subscription.charge.failed
  -- carries no order object, and this makes a duplicate billing record
  -- impossible by construction.
  event_id        text primary key,
  event_type      text not null,
  charge_id       text,
  subscription_id text,
  account_id      text,
  user_id         uuid references auth.users(id) on delete set null,
  status          text not null,
  currency        text,
  total           numeric(12, 2),
  decline_reason  text,
  product_path    text,
  plan_key        text,
  credits_allocated int not null default 0,
  occurred_at     timestamptz not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint fastspring_charges_status_check check (status in ('completed', 'failed')),
  constraint fastspring_charges_plan_check check (
    plan_key is null or plan_key in ('starter', 'professional', 'custom')
  )
);

create index if not exists fastspring_charges_subscription_idx
  on public.fastspring_charges (subscription_id);
create index if not exists fastspring_charges_user_idx
  on public.fastspring_charges (user_id);
create index if not exists fastspring_charges_status_idx
  on public.fastspring_charges (status, occurred_at desc);

alter table public.fastspring_charges enable row level security;

drop policy if exists fastspring_charges_select_own on public.fastspring_charges;
create policy fastspring_charges_select_own on public.fastspring_charges
  for select to authenticated using (auth.uid() = user_id or public.is_admin());

-- ---------------------------------------------------------------------------
-- Credit grants gain a FastSpring event key
-- ---------------------------------------------------------------------------

alter table public.credit_grants
  add column if not exists fastspring_event_id text;

-- The hard guarantee behind "a retry never allocates credits twice".
create unique index if not exists credit_grants_fastspring_event_idx
  on public.credit_grants (fastspring_event_id)
  where fastspring_event_id is not null;

-- ---------------------------------------------------------------------------
-- Credit replenishment
-- ---------------------------------------------------------------------------

/*
 * Top a paying user back up to one full plan allowance for the current period.
 *
 * allowance = plan credits_per_month + sum(credit_grants for the period)
 * remaining = allowance - used
 *
 * Granting `used - granted` makes granted equal used, so remaining becomes
 * exactly the plan's credits_per_month again — no more, no less. Three
 * properties fall out of that arithmetic, and they are the reason it is written
 * this way rather than as a counter reset:
 *
 *   1. It is self-limiting. Running it twice in a row allocates nothing the
 *      second time, because `granted` already equals `used`. Even if
 *      order.completed and subscription.charge.completed both fire for one
 *      payment, the user is topped up once.
 *   2. It never exceeds one allowance, so a mid-calendar-month renewal cannot
 *      hand out double credits.
 *   3. It preserves additive bonuses. A referral grant larger than consumption
 *      leaves the user above a plain allowance, untouched.
 *
 * The allowance is looked up from `plans.limits` by the plan key the caller
 * derived from the FastSpring product path server-side. Nothing here reads a
 * price, quantity or credit count out of the webhook payload.
 */
create or replace function public.grant_fastspring_period_credits(
  p_user_id uuid,
  p_event_id text,
  p_plan_key text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_start timestamptz := date_trunc('month', now());
  v_allowance    int;
  v_used         int;
  v_granted      int;
  v_top_up       int;
  v_inserted     uuid;
begin
  if p_user_id is null or p_plan_key is null then
    return 0;
  end if;

  select (limits ->> 'credits_per_month')::int
    into v_allowance
    from public.plans
   where key::text = p_plan_key
     and is_active = true;

  -- A NULL allowance means unlimited. There is nothing to replenish.
  if v_allowance is null then
    return 0;
  end if;

  select coalesce(count, 0)::int into v_used
    from public.usage_counters
   where user_id = p_user_id
     and metric = 'credits'
     and period_start = v_period_start;

  v_granted := public.granted_credits(p_user_id, v_period_start);
  v_top_up := greatest(0, coalesce(v_used, 0) - coalesce(v_granted, 0));

  if v_top_up = 0 then
    return 0;
  end if;

  insert into public.credit_grants (user_id, amount, reason, period_start, fastspring_event_id)
  values (p_user_id, v_top_up, 'fastspring_charge', v_period_start, p_event_id)
  on conflict (fastspring_event_id) where fastspring_event_id is not null do nothing
  returning id into v_inserted;

  -- A conflict means this event already paid out. Report nothing allocated.
  if v_inserted is null then
    return 0;
  end if;

  return v_top_up;
end;
$$;

-- ---------------------------------------------------------------------------
-- Charge sync
-- ---------------------------------------------------------------------------

/*
 * Record a charge attempt and, when it succeeded, replenish credits.
 *
 * Returns {claimed, user_id, credits_allocated} so the route can log what
 * actually happened rather than guessing. `claimed = false` means the event ID
 * was already in the ledger and nothing was done.
 */
create or replace function public.sync_fastspring_charge(
  p_event_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_charge_id text,
  p_subscription_id text,
  p_account_id text,
  p_email text,
  p_status text,
  p_currency text,
  p_total numeric,
  p_decline_reason text,
  p_product_path text,
  p_plan_key text,
  p_tags jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed text;
  v_user_id uuid;
  v_credits int := 0;
  v_grants_access boolean := false;
begin
  insert into public.fastspring_webhook_events (event_id, event_type, occurred_at)
  values (p_event_id, p_event_type, p_occurred_at)
  on conflict (event_id) do nothing
  returning event_id into v_claimed;

  if v_claimed is null then
    return jsonb_build_object('claimed', false, 'user_id', null, 'credits_allocated', 0);
  end if;

  if p_account_id is not null then
    insert into public.fastspring_accounts (account_id, email, last_event_at)
    values (p_account_id, p_email, '-infinity'::timestamptz)
    on conflict (account_id) do nothing;
  end if;

  v_user_id := public.resolve_fastspring_user(p_tags, p_account_id, p_email);

  if v_user_id is not null and p_account_id is not null then
    update public.fastspring_accounts
       set user_id = coalesce(user_id, v_user_id), updated_at = now()
     where account_id = p_account_id;
    update public.fastspring_subscriptions
       set user_id = coalesce(user_id, v_user_id), updated_at = now()
     where account_id = p_account_id and user_id is null;
  end if;

  /*
   * Credits follow access, not the charge alone. A deactivated subscription
   * must never receive another allocation, which is what closes the
   * subscription.deactivated requirement: no live subscription, no top-up.
   */
  if p_status = 'completed' and p_subscription_id is not null then
    select public.fastspring_subscription_grants_access(state, active)
      into v_grants_access
      from public.fastspring_subscriptions
     where subscription_id = p_subscription_id;
  end if;

  if p_status = 'completed' and coalesce(v_grants_access, false) then
    v_credits := public.grant_fastspring_period_credits(v_user_id, p_event_id, p_plan_key);
  end if;

  insert into public.fastspring_charges (
    event_id, event_type, charge_id, subscription_id, account_id, user_id,
    status, currency, total, decline_reason, product_path, plan_key,
    credits_allocated, occurred_at
  ) values (
    p_event_id, p_event_type, p_charge_id, p_subscription_id, p_account_id, v_user_id,
    p_status, p_currency, p_total, p_decline_reason, p_product_path, p_plan_key,
    v_credits, p_occurred_at
  )
  on conflict (event_id) do nothing;

  return jsonb_build_object(
    'claimed', true,
    'user_id', v_user_id,
    'credits_allocated', v_credits
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Order sync, replaced to allocate credits on the first paid order
-- ---------------------------------------------------------------------------

/*
 * The return type changes from boolean to jsonb so the route can log the
 * resolved user and the credits allocated, so the 0068 definition is dropped.
 */
drop function if exists public.sync_fastspring_order(
  text, text, timestamptz, text, text, text, text, text, boolean, text, numeric,
  text, jsonb, timestamptz
);

create or replace function public.sync_fastspring_order(
  p_event_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_order_id text,
  p_account_id text,
  p_subscription_id text,
  p_email text,
  p_reference text,
  p_live boolean,
  p_currency text,
  p_total numeric,
  p_product_path text,
  p_plan_key text,
  p_tags jsonb,
  p_completed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed text;
  v_user_id uuid;
  v_credits int := 0;
  v_grants_access boolean := false;
begin
  insert into public.fastspring_webhook_events (event_id, event_type, occurred_at)
  values (p_event_id, p_event_type, p_occurred_at)
  on conflict (event_id) do nothing
  returning event_id into v_claimed;

  if v_claimed is null then
    return jsonb_build_object('claimed', false, 'user_id', null, 'credits_allocated', 0);
  end if;

  if p_account_id is not null then
    insert into public.fastspring_accounts (account_id, email, last_event_at)
    values (p_account_id, p_email, '-infinity'::timestamptz)
    on conflict (account_id) do nothing;
  end if;

  v_user_id := public.resolve_fastspring_user(p_tags, p_account_id, p_email);

  if v_user_id is not null and p_account_id is not null then
    update public.fastspring_accounts
       set user_id = coalesce(user_id, v_user_id), updated_at = now()
     where account_id = p_account_id;
    update public.fastspring_subscriptions
       set user_id = coalesce(user_id, v_user_id), updated_at = now()
     where account_id = p_account_id and user_id is null;
  end if;

  insert into public.fastspring_orders (
    order_id, account_id, subscription_id, user_id, reference, live,
    currency, total, product_path, tags, completed_at, last_event_at
  ) values (
    p_order_id, p_account_id, p_subscription_id, v_user_id, p_reference,
    coalesce(p_live, true), p_currency, p_total, p_product_path, p_tags,
    p_completed_at, p_occurred_at
  )
  on conflict (order_id) do update
    set account_id = excluded.account_id,
        subscription_id = excluded.subscription_id,
        user_id = coalesce(excluded.user_id, public.fastspring_orders.user_id),
        reference = excluded.reference,
        live = excluded.live,
        currency = excluded.currency,
        total = excluded.total,
        product_path = excluded.product_path,
        tags = excluded.tags,
        completed_at = excluded.completed_at,
        last_event_at = excluded.last_event_at,
        updated_at = now()
  where excluded.last_event_at >= public.fastspring_orders.last_event_at;

  if p_subscription_id is not null then
    perform public.reconcile_fastspring_entitlement(p_subscription_id);

    select public.fastspring_subscription_grants_access(state, active)
      into v_grants_access
      from public.fastspring_subscriptions
     where subscription_id = p_subscription_id;
  end if;

  /*
   * Only a paid order allocates credits. A free-trial order totals zero — the
   * trial plan's own allowance covers it, and topping up here would hand out
   * the purchased tier's credits before any money moved.
   */
  if coalesce(p_total, 0) > 0 and coalesce(v_grants_access, false) then
    v_credits := public.grant_fastspring_period_credits(v_user_id, p_event_id, p_plan_key);
  end if;

  return jsonb_build_object(
    'claimed', true,
    'user_id', v_user_id,
    'credits_allocated', v_credits
  );
end;
$$;

revoke all on function public.grant_fastspring_period_credits(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.sync_fastspring_charge(
  text, text, timestamptz, text, text, text, text, text, text, numeric, text,
  text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.sync_fastspring_order(
  text, text, timestamptz, text, text, text, text, text, boolean, text, numeric,
  text, text, jsonb, timestamptz
) from public, anon, authenticated;

grant execute on function public.sync_fastspring_charge(
  text, text, timestamptz, text, text, text, text, text, text, numeric, text,
  text, text, jsonb
) to service_role;
grant execute on function public.sync_fastspring_order(
  text, text, timestamptz, text, text, text, text, text, boolean, text, numeric,
  text, text, jsonb, timestamptz
) to service_role;
