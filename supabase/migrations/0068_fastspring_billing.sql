-- 0068 — FastSpring billing mirror, webhook idempotency, and entitlement sync
--
-- FastSpring replaces Paddle as the merchant of record. These tables retain the
-- latest verified snapshot for each FastSpring entity while the existing
-- subscriptions table remains Outlio's provider-neutral entitlement ledger.
--
-- The 0059 Paddle tables are deliberately left in place as historical record.
-- Nothing writes to them any more and no entitlement decision reads them.

create table if not exists public.fastspring_webhook_events (
  event_id       text primary key,
  event_type     text not null,
  occurred_at    timestamptz not null,
  processed_at   timestamptz not null default now()
);

create table if not exists public.fastspring_accounts (
  account_id    text primary key,
  user_id       uuid references auth.users(id) on delete set null,
  email         text,
  name          text,
  company       text,
  country       text,
  language      text,
  tags          jsonb,
  last_event_at timestamptz not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- FastSpring account IDs are opaque url-safe tokens with no fixed prefix,
  -- so length is the only structural guarantee available.
  constraint fastspring_accounts_id_check check (length(account_id) between 1 and 128)
);

create index if not exists fastspring_accounts_user_idx on public.fastspring_accounts (user_id);
create index if not exists fastspring_accounts_email_idx on public.fastspring_accounts (lower(email));

create table if not exists public.fastspring_subscriptions (
  subscription_id text primary key,
  account_id      text not null references public.fastspring_accounts(account_id),
  user_id         uuid references auth.users(id) on delete set null,
  state           text not null,
  -- FastSpring keeps `active = true` on a canceled subscription until the paid
  -- period actually ends. Access follows this flag, never the state string.
  active          boolean not null,
  product_path    text not null,
  plan_key        text,
  billing_interval text,
  auto_renew      boolean,
  currency        text,
  price           numeric(12, 2),
  begin_at        timestamptz,
  next_charge_at  timestamptz,
  canceled_at     timestamptz,
  deactivated_at  timestamptz,
  tags            jsonb,
  last_event_at   timestamptz not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint fastspring_subscriptions_state_check check (
    state in ('active', 'trial', 'overdue', 'canceled', 'deactivated')
  ),
  constraint fastspring_subscriptions_plan_check check (
    plan_key is null or plan_key in ('starter', 'professional', 'custom')
  ),
  constraint fastspring_subscriptions_interval_check check (
    billing_interval is null or billing_interval in ('month', 'year')
  )
);

create index if not exists fastspring_subscriptions_account_idx
  on public.fastspring_subscriptions (account_id);
create index if not exists fastspring_subscriptions_user_idx
  on public.fastspring_subscriptions (user_id);
create index if not exists fastspring_subscriptions_state_idx
  on public.fastspring_subscriptions (state);

create table if not exists public.fastspring_orders (
  order_id        text primary key,
  account_id      text references public.fastspring_accounts(account_id),
  subscription_id text,
  user_id         uuid references auth.users(id) on delete set null,
  reference       text,
  live            boolean not null default true,
  currency        text not null,
  total           numeric(12, 2),
  product_path    text,
  tags            jsonb,
  completed_at    timestamptz,
  last_event_at   timestamptz not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists fastspring_orders_account_idx
  on public.fastspring_orders (account_id);
create index if not exists fastspring_orders_subscription_idx
  on public.fastspring_orders (subscription_id);
create index if not exists fastspring_orders_user_idx
  on public.fastspring_orders (user_id);

alter table public.subscriptions
  add column if not exists fastspring_account_id text,
  add column if not exists fastspring_product_path text,
  add column if not exists fastspring_event_at timestamptz;

alter table public.fastspring_webhook_events enable row level security;
alter table public.fastspring_accounts enable row level security;
alter table public.fastspring_subscriptions enable row level security;
alter table public.fastspring_orders enable row level security;

drop policy if exists fastspring_accounts_select_own on public.fastspring_accounts;
create policy fastspring_accounts_select_own on public.fastspring_accounts
  for select to authenticated using (auth.uid() = user_id or public.is_admin());

drop policy if exists fastspring_subscriptions_select_own on public.fastspring_subscriptions;
create policy fastspring_subscriptions_select_own on public.fastspring_subscriptions
  for select to authenticated using (auth.uid() = user_id or public.is_admin());

drop policy if exists fastspring_orders_select_own on public.fastspring_orders;
create policy fastspring_orders_select_own on public.fastspring_orders
  for select to authenticated using (auth.uid() = user_id or public.is_admin());

-- ---------------------------------------------------------------------------
-- User resolution
-- ---------------------------------------------------------------------------

/*
 * Checkout attaches `outlio_user_id` as a FastSpring tag, which survives into
 * every webhook for the resulting order and subscription. Tags are the only
 * authoritative link; the account lookup and the email fallback exist for
 * orders placed outside our own checkout (support-created, recovered carts).
 */
create or replace function public.resolve_fastspring_user(
  p_tags jsonb,
  p_account_id text,
  p_email text default null
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_candidate text;
  v_user_id uuid;
begin
  v_candidate := p_tags ->> 'outlio_user_id';
  if v_candidate ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select id into v_user_id from auth.users where id = v_candidate::uuid;
  end if;

  if v_user_id is null and p_account_id is not null then
    select user_id into v_user_id
      from public.fastspring_accounts
     where account_id = p_account_id;
  end if;

  if v_user_id is null and p_email is not null then
    select id into v_user_id
      from public.profiles
     where lower(email) = lower(p_email)
       and deleted_at is null
     order by created_at asc
     limit 1;
  end if;

  return v_user_id;
end;
$$;

/*
 * A canceled FastSpring subscription is still paid through the end of its
 * current period: `state = 'canceled'` with `active = true`. Deactivation is
 * the event that ends access. Overdue is denied, matching the previous
 * past_due behaviour.
 */
create or replace function public.fastspring_subscription_grants_access(
  p_state text,
  p_active boolean
)
returns boolean
language sql
immutable
as $$
  select coalesce(p_active, false) and p_state in ('active', 'trial', 'canceled');
$$;

-- ---------------------------------------------------------------------------
-- Entitlement reconciliation
-- ---------------------------------------------------------------------------

create or replace function public.reconcile_fastspring_entitlement(p_subscription_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscription public.fastspring_subscriptions%rowtype;
  v_plan_id uuid;
  v_internal_status public.subscription_status;
begin
  select * into v_subscription
    from public.fastspring_subscriptions
   where subscription_id = p_subscription_id
   for update;

  if v_subscription.subscription_id is null or v_subscription.user_id is null then
    return;
  end if;

  -- Every FastSpring subscription opens with a three-day trial, and every trial
  -- receives only the existing 10-credit internal trial plan. The purchased
  -- tier is applied when FastSpring moves the state to active.
  if v_subscription.state = 'trial' then
    select id into v_plan_id
      from public.plans
     where key = 'trial'
       and is_active = true;
  elsif v_subscription.plan_key is not null then
    select id into v_plan_id
      from public.plans
     where key::text = v_subscription.plan_key
       and is_active = true;
  end if;

  if public.fastspring_subscription_grants_access(v_subscription.state, v_subscription.active) then
    if v_plan_id is null then
      raise exception 'No active Outlio plan is mapped for FastSpring subscription %', p_subscription_id;
    end if;

    update public.profiles
       set role = 'subscriber',
           plan_id = v_plan_id,
           access_expires_at = null,
           suspended_at = null,
           suspended_reason = null
     where id = v_subscription.user_id;

    insert into public.subscriptions (
      user_id, plan_id, status, provider, provider_ref,
      current_period_start, current_period_end, cancel_at, cancelled_at,
      fastspring_account_id, fastspring_product_path,
      scheduled_change_action, scheduled_change_at, fastspring_event_at
    ) values (
      v_subscription.user_id, v_plan_id, 'active', 'fastspring', v_subscription.subscription_id,
      coalesce(v_subscription.begin_at, now()),
      v_subscription.next_charge_at,
      -- A canceled-but-active subscription ends at its next charge date.
      case when v_subscription.state = 'canceled'
        then coalesce(v_subscription.deactivated_at, v_subscription.next_charge_at) else null end,
      null,
      v_subscription.account_id, v_subscription.product_path,
      case when v_subscription.state = 'canceled' then 'cancel' else null end,
      case when v_subscription.state = 'canceled'
        then coalesce(v_subscription.deactivated_at, v_subscription.next_charge_at) else null end,
      v_subscription.last_event_at
    )
    on conflict (provider, provider_ref) where provider_ref is not null do update
      set user_id = excluded.user_id,
          plan_id = excluded.plan_id,
          status = 'active',
          current_period_start = excluded.current_period_start,
          current_period_end = excluded.current_period_end,
          cancel_at = excluded.cancel_at,
          cancelled_at = null,
          fastspring_account_id = excluded.fastspring_account_id,
          fastspring_product_path = excluded.fastspring_product_path,
          scheduled_change_action = excluded.scheduled_change_action,
          scheduled_change_at = excluded.scheduled_change_at,
          fastspring_event_at = excluded.fastspring_event_at,
          updated_at = now();
  else
    v_internal_status := case
      when v_subscription.state = 'overdue' then 'past_due'::public.subscription_status
      else 'cancelled'::public.subscription_status
    end;

    update public.subscriptions
       set status = v_internal_status,
           current_period_end = v_subscription.next_charge_at,
           cancel_at = v_subscription.deactivated_at,
           cancelled_at = case when v_subscription.state in ('canceled', 'deactivated')
             then coalesce(v_subscription.canceled_at, now()) else cancelled_at end,
           fastspring_account_id = v_subscription.account_id,
           fastspring_product_path = v_subscription.product_path,
           fastspring_event_at = v_subscription.last_event_at,
           updated_at = now()
     where provider = 'fastspring'
       and provider_ref = v_subscription.subscription_id;

    if not exists (
      select 1 from public.fastspring_subscriptions
       where user_id = v_subscription.user_id
         and public.fastspring_subscription_grants_access(state, active)
    ) and not exists (
      select 1 from public.subscriptions
       where user_id = v_subscription.user_id
         and provider <> 'fastspring'
         and status = 'active'
         and (current_period_end is null or current_period_end > now())
    ) then
      update public.profiles
         set role = 'registered_user', access_expires_at = now()
       where id = v_subscription.user_id
         and role <> 'admin';
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Verified event sync
-- ---------------------------------------------------------------------------

create or replace function public.sync_fastspring_account(
  p_event_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_account_id text,
  p_email text,
  p_name text,
  p_company text,
  p_country text,
  p_language text,
  p_tags jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed text;
  v_user_id uuid;
  v_subscription_id text;
begin
  insert into public.fastspring_webhook_events (event_id, event_type, occurred_at)
  values (p_event_id, p_event_type, p_occurred_at)
  on conflict (event_id) do nothing
  returning event_id into v_claimed;
  if v_claimed is null then return false; end if;

  v_user_id := public.resolve_fastspring_user(p_tags, p_account_id, p_email);

  insert into public.fastspring_accounts (
    account_id, user_id, email, name, company, country, language, tags, last_event_at
  ) values (
    p_account_id, v_user_id, p_email, p_name, p_company, p_country, p_language,
    p_tags, p_occurred_at
  )
  on conflict (account_id) do update
    set user_id = coalesce(excluded.user_id, public.fastspring_accounts.user_id),
        email = excluded.email,
        name = excluded.name,
        company = excluded.company,
        country = excluded.country,
        language = excluded.language,
        tags = excluded.tags,
        last_event_at = excluded.last_event_at,
        updated_at = now()
  where excluded.last_event_at >= public.fastspring_accounts.last_event_at;

  if v_user_id is not null then
    update public.fastspring_subscriptions
       set user_id = v_user_id, updated_at = now()
     where account_id = p_account_id and user_id is null;

    for v_subscription_id in
      select subscription_id from public.fastspring_subscriptions where account_id = p_account_id
    loop
      perform public.reconcile_fastspring_entitlement(v_subscription_id);
    end loop;
  end if;

  return true;
end;
$$;

create or replace function public.sync_fastspring_subscription(
  p_event_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_subscription_id text,
  p_account_id text,
  p_email text,
  p_state text,
  p_active boolean,
  p_product_path text,
  p_plan_key text,
  p_billing_interval text,
  p_auto_renew boolean,
  p_currency text,
  p_price numeric,
  p_begin_at timestamptz,
  p_next_charge_at timestamptz,
  p_canceled_at timestamptz,
  p_deactivated_at timestamptz,
  p_tags jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed text;
  v_user_id uuid;
begin
  insert into public.fastspring_webhook_events (event_id, event_type, occurred_at)
  values (p_event_id, p_event_type, p_occurred_at)
  on conflict (event_id) do nothing
  returning event_id into v_claimed;
  if v_claimed is null then return false; end if;

  -- A subscription event may be the first sighting of its account. The
  -- placeholder must never look newer than a later full account snapshot.
  insert into public.fastspring_accounts (account_id, email, last_event_at)
  values (p_account_id, p_email, '-infinity'::timestamptz)
  on conflict (account_id) do nothing;

  v_user_id := public.resolve_fastspring_user(p_tags, p_account_id, p_email);
  if v_user_id is not null then
    update public.fastspring_accounts
       set user_id = coalesce(user_id, v_user_id), updated_at = now()
     where account_id = p_account_id;
  end if;

  insert into public.fastspring_subscriptions (
    subscription_id, account_id, user_id, state, active, product_path, plan_key,
    billing_interval, auto_renew, currency, price, begin_at, next_charge_at,
    canceled_at, deactivated_at, tags, last_event_at
  ) values (
    p_subscription_id, p_account_id, v_user_id, p_state, p_active, p_product_path,
    p_plan_key, p_billing_interval, p_auto_renew, p_currency, p_price, p_begin_at,
    p_next_charge_at, p_canceled_at, p_deactivated_at, p_tags, p_occurred_at
  )
  on conflict (subscription_id) do update
    set account_id = excluded.account_id,
        user_id = coalesce(excluded.user_id, public.fastspring_subscriptions.user_id),
        state = excluded.state,
        active = excluded.active,
        product_path = excluded.product_path,
        plan_key = excluded.plan_key,
        billing_interval = excluded.billing_interval,
        auto_renew = excluded.auto_renew,
        currency = excluded.currency,
        price = excluded.price,
        begin_at = excluded.begin_at,
        next_charge_at = excluded.next_charge_at,
        canceled_at = excluded.canceled_at,
        deactivated_at = excluded.deactivated_at,
        tags = excluded.tags,
        last_event_at = excluded.last_event_at,
        updated_at = now()
  where excluded.last_event_at >= public.fastspring_subscriptions.last_event_at;

  perform public.reconcile_fastspring_entitlement(p_subscription_id);
  return true;
end;
$$;

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
  p_tags jsonb,
  p_completed_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed text;
  v_user_id uuid;
begin
  insert into public.fastspring_webhook_events (event_id, event_type, occurred_at)
  values (p_event_id, p_event_type, p_occurred_at)
  on conflict (event_id) do nothing
  returning event_id into v_claimed;
  if v_claimed is null then return false; end if;

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
     where account_id = p_account_id;
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
  end if;
  return true;
end;
$$;

revoke all on function public.resolve_fastspring_user(jsonb, text, text)
  from public, anon, authenticated;
revoke all on function public.reconcile_fastspring_entitlement(text)
  from public, anon, authenticated;
revoke all on function public.sync_fastspring_account(
  text, text, timestamptz, text, text, text, text, text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.sync_fastspring_subscription(
  text, text, timestamptz, text, text, text, text, boolean, text, text, text,
  boolean, text, numeric, timestamptz, timestamptz, timestamptz, timestamptz, jsonb
) from public, anon, authenticated;
revoke all on function public.sync_fastspring_order(
  text, text, timestamptz, text, text, text, text, text, boolean, text, numeric,
  text, jsonb, timestamptz
) from public, anon, authenticated;

-- The webhook route uses the server-only service-role client. Revoke browser
-- roles above, then grant only that backend role permission to invoke the
-- transactional sync boundary.
grant execute on function public.sync_fastspring_account(
  text, text, timestamptz, text, text, text, text, text, text, jsonb
) to service_role;
grant execute on function public.sync_fastspring_subscription(
  text, text, timestamptz, text, text, text, text, boolean, text, text, text,
  boolean, text, numeric, timestamptz, timestamptz, timestamptz, timestamptz, jsonb
) to service_role;
grant execute on function public.sync_fastspring_order(
  text, text, timestamptz, text, text, text, text, text, boolean, text, numeric,
  text, jsonb, timestamptz
) to service_role;
