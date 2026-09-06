-- 0056 — Paddle Billing mirror, webhook idempotency, and entitlement sync
--
-- Paddle is the billing source of truth. These tables retain the latest
-- verified snapshot for each Paddle entity while the existing subscriptions
-- table remains Outlio's provider-neutral entitlement ledger.

create table if not exists public.paddle_webhook_events (
  event_id       text primary key,
  event_type     text not null,
  occurred_at    timestamptz not null,
  processed_at   timestamptz not null default now()
);

create table if not exists public.paddle_customers (
  customer_id       text primary key,
  user_id           uuid references auth.users(id) on delete set null,
  email             text,
  name              text,
  status            text not null,
  marketing_consent boolean not null default false,
  custom_data       jsonb,
  paddle_created_at timestamptz,
  paddle_updated_at timestamptz,
  last_event_at     timestamptz not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint paddle_customers_id_check check (customer_id ~ '^ctm_[a-z0-9]+$')
);

create index if not exists paddle_customers_user_idx on public.paddle_customers (user_id);
create index if not exists paddle_customers_email_idx on public.paddle_customers (lower(email));

create table if not exists public.paddle_subscriptions (
  subscription_id        text primary key,
  customer_id            text not null references public.paddle_customers(customer_id),
  user_id                 uuid references auth.users(id) on delete set null,
  status                  text not null,
  price_id                text not null,
  product_id              text not null,
  plan_key                text,
  scheduled_change_action text,
  scheduled_change_at     timestamptz,
  current_period_start    timestamptz,
  current_period_end      timestamptz,
  canceled_at             timestamptz,
  paused_at               timestamptz,
  custom_data             jsonb,
  last_event_at           timestamptz not null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint paddle_subscriptions_id_check check (subscription_id ~ '^sub_[a-z0-9]+$'),
  constraint paddle_subscriptions_status_check check (
    status in ('active', 'trialing', 'paused', 'past_due', 'canceled')
  ),
  constraint paddle_subscriptions_plan_check check (
    plan_key is null or plan_key in ('starter', 'professional', 'custom')
  )
);

create index if not exists paddle_subscriptions_customer_idx
  on public.paddle_subscriptions (customer_id);
create index if not exists paddle_subscriptions_user_idx
  on public.paddle_subscriptions (user_id);
create index if not exists paddle_subscriptions_status_idx
  on public.paddle_subscriptions (status);

create table if not exists public.paddle_transactions (
  transaction_id       text primary key,
  customer_id          text references public.paddle_customers(customer_id),
  subscription_id      text,
  user_id              uuid references auth.users(id) on delete set null,
  status               text not null,
  price_id             text,
  product_id           text,
  currency_code        text not null,
  total                text,
  custom_data          jsonb,
  billed_at            timestamptz,
  last_event_at        timestamptz not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint paddle_transactions_id_check check (transaction_id ~ '^txn_[a-z0-9]+$')
);

create index if not exists paddle_transactions_customer_idx
  on public.paddle_transactions (customer_id);
create index if not exists paddle_transactions_subscription_idx
  on public.paddle_transactions (subscription_id);
create index if not exists paddle_transactions_user_idx
  on public.paddle_transactions (user_id);

alter table public.subscriptions
  add column if not exists paddle_customer_id text,
  add column if not exists paddle_price_id text,
  add column if not exists paddle_product_id text,
  add column if not exists scheduled_change_action text,
  add column if not exists scheduled_change_at timestamptz,
  add column if not exists paddle_event_at timestamptz;

update public.plans set name = 'Lead Engine', description = '100 credits' where key = 'starter';
update public.plans set name = 'Pro', description = '300 credits' where key = 'professional';
update public.plans set name = 'Pro + Hubble', description = '1,000 credits plus Hubble' where key = 'custom';

alter table public.paddle_webhook_events enable row level security;
alter table public.paddle_customers enable row level security;
alter table public.paddle_subscriptions enable row level security;
alter table public.paddle_transactions enable row level security;

drop policy if exists paddle_customers_select_own on public.paddle_customers;
create policy paddle_customers_select_own on public.paddle_customers
  for select to authenticated using (auth.uid() = user_id or public.is_admin());

drop policy if exists paddle_subscriptions_select_own on public.paddle_subscriptions;
create policy paddle_subscriptions_select_own on public.paddle_subscriptions
  for select to authenticated using (auth.uid() = user_id or public.is_admin());

drop policy if exists paddle_transactions_select_own on public.paddle_transactions;
create policy paddle_transactions_select_own on public.paddle_transactions
  for select to authenticated using (auth.uid() = user_id or public.is_admin());

create or replace function public.resolve_paddle_user(
  p_custom_data jsonb,
  p_customer_id text,
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
  v_candidate := p_custom_data ->> 'outlio_user_id';
  if v_candidate ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select id into v_user_id from auth.users where id = v_candidate::uuid;
  end if;

  if v_user_id is null and p_customer_id is not null then
    select user_id into v_user_id
      from public.paddle_customers
     where customer_id = p_customer_id;
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

create or replace function public.paddle_subscription_grants_access(p_status text)
returns boolean
language sql
immutable
as $$
  select p_status in ('active', 'trialing');
$$;

create or replace function public.reconcile_paddle_entitlement(p_subscription_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscription public.paddle_subscriptions%rowtype;
  v_plan_id uuid;
  v_internal_status public.subscription_status;
begin
  select * into v_subscription
    from public.paddle_subscriptions
   where subscription_id = p_subscription_id
   for update;

  if v_subscription.subscription_id is null or v_subscription.user_id is null then
    return;
  end if;

  -- Every Paddle price has a three-day trial, but every trial receives only
  -- the existing 10-credit internal trial plan. When Paddle changes the status
  -- to active, the next verified event promotes the user to the purchased tier.
  if v_subscription.status = 'trialing' then
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

  if public.paddle_subscription_grants_access(v_subscription.status) then
    if v_plan_id is null then
      raise exception 'No active Outlio plan is mapped for Paddle subscription %', p_subscription_id;
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
      paddle_customer_id, paddle_price_id, paddle_product_id,
      scheduled_change_action, scheduled_change_at, paddle_event_at
    ) values (
      v_subscription.user_id, v_plan_id, 'active', 'paddle', v_subscription.subscription_id,
      coalesce(v_subscription.current_period_start, now()),
      v_subscription.current_period_end,
      case when v_subscription.scheduled_change_action = 'cancel'
        then v_subscription.scheduled_change_at else null end,
      null,
      v_subscription.customer_id, v_subscription.price_id, v_subscription.product_id,
      v_subscription.scheduled_change_action, v_subscription.scheduled_change_at,
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
          paddle_customer_id = excluded.paddle_customer_id,
          paddle_price_id = excluded.paddle_price_id,
          paddle_product_id = excluded.paddle_product_id,
          scheduled_change_action = excluded.scheduled_change_action,
          scheduled_change_at = excluded.scheduled_change_at,
          paddle_event_at = excluded.paddle_event_at,
          updated_at = now();
  else
    v_internal_status := case
      when v_subscription.status = 'past_due' then 'past_due'::public.subscription_status
      else 'cancelled'::public.subscription_status
    end;

    update public.subscriptions
       set status = v_internal_status,
           current_period_end = v_subscription.current_period_end,
           cancel_at = v_subscription.scheduled_change_at,
           cancelled_at = case when v_subscription.status = 'canceled'
             then coalesce(v_subscription.canceled_at, now()) else cancelled_at end,
           paddle_customer_id = v_subscription.customer_id,
           paddle_price_id = v_subscription.price_id,
           paddle_product_id = v_subscription.product_id,
           scheduled_change_action = v_subscription.scheduled_change_action,
           scheduled_change_at = v_subscription.scheduled_change_at,
           paddle_event_at = v_subscription.last_event_at,
           updated_at = now()
     where provider = 'paddle'
       and provider_ref = v_subscription.subscription_id;

    if not exists (
      select 1 from public.paddle_subscriptions
       where user_id = v_subscription.user_id
         and public.paddle_subscription_grants_access(status)
    ) and not exists (
      select 1 from public.subscriptions
       where user_id = v_subscription.user_id
         and provider <> 'paddle'
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

create or replace function public.sync_paddle_customer(
  p_event_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_customer_id text,
  p_email text,
  p_name text,
  p_status text,
  p_marketing_consent boolean,
  p_custom_data jsonb,
  p_paddle_created_at timestamptz,
  p_paddle_updated_at timestamptz
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
  insert into public.paddle_webhook_events (event_id, event_type, occurred_at)
  values (p_event_id, p_event_type, p_occurred_at)
  on conflict (event_id) do nothing
  returning event_id into v_claimed;
  if v_claimed is null then return false; end if;

  v_user_id := public.resolve_paddle_user(p_custom_data, p_customer_id, p_email);

  insert into public.paddle_customers (
    customer_id, user_id, email, name, status, marketing_consent, custom_data,
    paddle_created_at, paddle_updated_at, last_event_at
  ) values (
    p_customer_id, v_user_id, p_email, p_name, p_status, p_marketing_consent,
    p_custom_data, p_paddle_created_at, p_paddle_updated_at, p_occurred_at
  )
  on conflict (customer_id) do update
    set user_id = coalesce(excluded.user_id, public.paddle_customers.user_id),
        email = excluded.email,
        name = excluded.name,
        status = excluded.status,
        marketing_consent = excluded.marketing_consent,
        custom_data = excluded.custom_data,
        paddle_created_at = excluded.paddle_created_at,
        paddle_updated_at = excluded.paddle_updated_at,
        last_event_at = excluded.last_event_at,
        updated_at = now()
  where excluded.last_event_at >= public.paddle_customers.last_event_at;

  if v_user_id is not null then
    update public.paddle_subscriptions
       set user_id = v_user_id, updated_at = now()
     where customer_id = p_customer_id and user_id is null;

    for v_subscription_id in
      select subscription_id from public.paddle_subscriptions where customer_id = p_customer_id
    loop
      perform public.reconcile_paddle_entitlement(v_subscription_id);
    end loop;
  end if;

  return true;
end;
$$;

create or replace function public.sync_paddle_subscription(
  p_event_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_subscription_id text,
  p_customer_id text,
  p_status text,
  p_price_id text,
  p_product_id text,
  p_plan_key text,
  p_scheduled_change_action text,
  p_scheduled_change_at timestamptz,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_canceled_at timestamptz,
  p_paused_at timestamptz,
  p_custom_data jsonb
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
  insert into public.paddle_webhook_events (event_id, event_type, occurred_at)
  values (p_event_id, p_event_type, p_occurred_at)
  on conflict (event_id) do nothing
  returning event_id into v_claimed;
  if v_claimed is null then return false; end if;

  insert into public.paddle_customers (
    customer_id, status, last_event_at
  ) values (
    -- A subscription may arrive before customer.created. The placeholder must
    -- never look newer than the later full customer snapshot.
    p_customer_id, 'active', '-infinity'::timestamptz
  ) on conflict (customer_id) do nothing;

  v_user_id := public.resolve_paddle_user(p_custom_data, p_customer_id, null);
  if v_user_id is not null then
    update public.paddle_customers
       set user_id = coalesce(user_id, v_user_id), updated_at = now()
     where customer_id = p_customer_id;
  end if;

  insert into public.paddle_subscriptions (
    subscription_id, customer_id, user_id, status, price_id, product_id, plan_key,
    scheduled_change_action, scheduled_change_at, current_period_start,
    current_period_end, canceled_at, paused_at, custom_data, last_event_at
  ) values (
    p_subscription_id, p_customer_id, v_user_id, p_status, p_price_id, p_product_id,
    p_plan_key, p_scheduled_change_action, p_scheduled_change_at,
    p_current_period_start, p_current_period_end, p_canceled_at, p_paused_at,
    p_custom_data, p_occurred_at
  )
  on conflict (subscription_id) do update
    set customer_id = excluded.customer_id,
        user_id = coalesce(excluded.user_id, public.paddle_subscriptions.user_id),
        status = excluded.status,
        price_id = excluded.price_id,
        product_id = excluded.product_id,
        plan_key = excluded.plan_key,
        scheduled_change_action = excluded.scheduled_change_action,
        scheduled_change_at = excluded.scheduled_change_at,
        current_period_start = excluded.current_period_start,
        current_period_end = excluded.current_period_end,
        canceled_at = excluded.canceled_at,
        paused_at = excluded.paused_at,
        custom_data = excluded.custom_data,
        last_event_at = excluded.last_event_at,
        updated_at = now()
  where excluded.last_event_at >= public.paddle_subscriptions.last_event_at;

  perform public.reconcile_paddle_entitlement(p_subscription_id);
  return true;
end;
$$;

create or replace function public.sync_paddle_transaction(
  p_event_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_transaction_id text,
  p_customer_id text,
  p_subscription_id text,
  p_status text,
  p_price_id text,
  p_product_id text,
  p_currency_code text,
  p_total text,
  p_custom_data jsonb,
  p_billed_at timestamptz
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
  insert into public.paddle_webhook_events (event_id, event_type, occurred_at)
  values (p_event_id, p_event_type, p_occurred_at)
  on conflict (event_id) do nothing
  returning event_id into v_claimed;
  if v_claimed is null then return false; end if;

  if p_customer_id is not null then
    insert into public.paddle_customers (customer_id, status, last_event_at)
    values (p_customer_id, 'active', '-infinity'::timestamptz)
    on conflict (customer_id) do nothing;
  end if;

  v_user_id := public.resolve_paddle_user(p_custom_data, p_customer_id, null);

  if v_user_id is not null and p_customer_id is not null then
    update public.paddle_customers
       set user_id = coalesce(user_id, v_user_id), updated_at = now()
     where customer_id = p_customer_id;
    update public.paddle_subscriptions
       set user_id = coalesce(user_id, v_user_id), updated_at = now()
     where customer_id = p_customer_id;
  end if;

  insert into public.paddle_transactions (
    transaction_id, customer_id, subscription_id, user_id, status,
    price_id, product_id, currency_code, total, custom_data, billed_at, last_event_at
  ) values (
    p_transaction_id, p_customer_id, p_subscription_id, v_user_id, p_status,
    p_price_id, p_product_id, p_currency_code, p_total, p_custom_data,
    p_billed_at, p_occurred_at
  )
  on conflict (transaction_id) do update
    set customer_id = excluded.customer_id,
        subscription_id = excluded.subscription_id,
        user_id = coalesce(excluded.user_id, public.paddle_transactions.user_id),
        status = excluded.status,
        price_id = excluded.price_id,
        product_id = excluded.product_id,
        currency_code = excluded.currency_code,
        total = excluded.total,
        custom_data = excluded.custom_data,
        billed_at = excluded.billed_at,
        last_event_at = excluded.last_event_at,
        updated_at = now()
  where excluded.last_event_at >= public.paddle_transactions.last_event_at;

  if p_subscription_id is not null then
    perform public.reconcile_paddle_entitlement(p_subscription_id);
  end if;
  return true;
end;
$$;

revoke all on function public.resolve_paddle_user(jsonb, text, text)
  from public, anon, authenticated;
revoke all on function public.reconcile_paddle_entitlement(text)
  from public, anon, authenticated;
revoke all on function public.sync_paddle_customer(
  text, text, timestamptz, text, text, text, text, boolean, jsonb, timestamptz, timestamptz
) from public, anon, authenticated;
revoke all on function public.sync_paddle_subscription(
  text, text, timestamptz, text, text, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, jsonb
) from public, anon, authenticated;
revoke all on function public.sync_paddle_transaction(
  text, text, timestamptz, text, text, text, text, text, text, text, text, jsonb, timestamptz
) from public, anon, authenticated;

-- The webhook route uses the server-only service-role client. Revoke browser
-- roles above, then grant only that backend role permission to invoke the
-- transactional sync boundary.
grant execute on function public.sync_paddle_customer(
  text, text, timestamptz, text, text, text, text, boolean, jsonb, timestamptz, timestamptz
) to service_role;
grant execute on function public.sync_paddle_subscription(
  text, text, timestamptz, text, text, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, jsonb
) to service_role;
grant execute on function public.sync_paddle_transaction(
  text, text, timestamptz, text, text, text, text, text, text, text, text, jsonb, timestamptz
) to service_role;
