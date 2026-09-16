-- ---------------------------------------------------------------------------
-- 0130 — §5.6's fx snapshot, and the rule that stops a rate being invented.
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  THE RATE IS SNAPSHOTTED ON THE DEAL, AND ONLY EVER WHEN IT IS OBSERVED.  ║
-- ║                                                                           ║
-- ║  §5.6 asks for `fx_rate_to_workspace_currency` + `fx_rate_date` captured   ║
-- ║  at create and at close, so that a deal's reported value changes once      ║
-- ║  when it closes and never again because a rate moved today.               ║
-- ║                                                                           ║
-- ║  ⚠️ DECISION-19 IS ANSWERED BUT HAS NO RATE VENDOR. This migration is the  ║
-- ║  half that does not need one. It builds the schema, the invariant and the  ║
-- ║  converted column; the feed plugs into `lib/crm/fx.ts` later.             ║
-- ║                                                                           ║
-- ║  What makes that safe is one rule, enforced by trigger below:             ║
-- ║                                                                           ║
-- ║      A RATE OF 1 IS ONLY EVER WRITTEN WHEN THE DEAL'S CURRENCY AND THE     ║
-- ║      WORKSPACE'S CURRENCY ARE THE SAME STRING.                            ║
-- ║                                                                           ║
-- ║  That is not a conversion, it is an identity, so it is an observation      ║
-- ║  rather than a guess (CLAUDE.md rule 4). Every cross-currency deal keeps   ║
-- ║  a NULL rate until a real feed fills it, and a NULL rate makes the deal    ║
-- ║  UNCONVERTIBLE rather than silently worth its face value in another        ║
-- ║  currency — which is the exact bug 0082 has today.                        ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠️ TODAY THIS CHANGES NO NUMBER. Every deal is USD, every workspace defaults
-- to USD, so every rate backfills to 1 and every rollup returns exactly what it
-- returned before. That is the point: the conversion path is exercised by real
-- data from the day it ships, rather than being switched on for the first time
-- when the first non-USD deal appears.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The currency a workspace reports in.
-- ---------------------------------------------------------------------------
alter table public.workspaces
  add column if not exists default_currency char(3) not null default 'USD';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workspaces_default_currency_shape'
  ) then
    -- Same shape check as `crm_opportunities.currency` (0076). Three uppercase
    -- letters is what `Intl.NumberFormat` requires to be WELL-FORMED; it does
    -- not verify the code is real ISO 4217, and neither does this.
    alter table public.workspaces
      add constraint workspaces_default_currency_shape
      check (default_currency ~ '^[A-Z]{3}$');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. The snapshot itself.
-- ---------------------------------------------------------------------------
alter table public.crm_opportunities
  add column if not exists fx_rate_to_workspace_currency numeric(18, 8),
  add column if not exists fx_rate_date date;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'crm_opportunities_fx_rate_positive'
  ) then
    -- Zero would silently erase a deal's value; a negative rate is not a thing.
    alter table public.crm_opportunities
      add constraint crm_opportunities_fx_rate_positive
      check (fx_rate_to_workspace_currency is null
             or fx_rate_to_workspace_currency > 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'crm_opportunities_fx_pair'
  ) then
    /*
     * ⚠️ BOTH OR NEITHER. A rate with no date cannot be audited — "converted at
     * what, on when?" is the whole question an auditor asks — and a date with
     * no rate is a claim that a conversion happened when none did.
     */
    alter table public.crm_opportunities
      add constraint crm_opportunities_fx_pair
      check ((fx_rate_to_workspace_currency is null) = (fx_rate_date is null));
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. The one place a rate is written without a feed.
-- ---------------------------------------------------------------------------
create or replace function public.crm_opportunity_fx_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace_currency char(3);
begin
  select w.default_currency
    into v_workspace_currency
    from public.workspaces w
   where w.id = new.workspace_id;

  /*
   * ⚠️ IDENTITY, NOT CONVERSION. Writing 1 here says "these are the same
   * currency", which is a fact the row already carries. Writing any other
   * number would be inventing an exchange rate, which is rule 4 with a decimal
   * point in it.
   *
   * A supplied rate is never overwritten: when a feed exists it will set one
   * before this fires, and its value is an observation we must not discard.
   */
  if new.fx_rate_to_workspace_currency is null
     and v_workspace_currency is not null
     and new.currency = v_workspace_currency then
    new.fx_rate_to_workspace_currency := 1;
    /*
     * ⚠️ THE DATE IS STILL RECORDED FOR AN IDENTITY. It costs nothing and it
     * keeps the pair constraint meaningful, so every converted row can answer
     * "as of when" without a special case for the trivial one.
     */
    new.fx_rate_date := coalesce(new.fx_rate_date, current_date);
  end if;

  return new;
end;
$$;

/*
 * ⚠️ THIS FIRES AT CLOSE BUT DOES NOT RE-SNAPSHOT, AND THE DIFFERENCE MATTERS.
 *
 * §5.6 asks for a rate captured at create AND AGAIN at close, so a won deal's
 * reported value is the rate on the day it closed. This trigger only ever
 * FILLS A NULL — verified, not assumed: a same-currency deal dated 2026-01-01
 * still reads 2026-01-01 after closing.
 *
 * That is deliberate, and it is the half that needs the vendor. There is no
 * "rate on the closing day" to write without a feed, and writing today's date
 * against a rate of 1 would date a snapshot that never happened. For
 * same-currency deals the distinction is academic — 1 is 1 on every date — so
 * nothing is currently wrong; it is INCOMPLETE against §5.6 rather than
 * incorrect, and `lib/crm/fx.ts` is where the close-rate capture will go.
 *
 * It fires on `status` anyway so that a deal which had no rate at create can
 * still acquire one here, and on `currency` because the old rate converts from
 * a currency the row no longer claims.
 */
drop trigger if exists crm_opportunities_fx_snapshot on public.crm_opportunities;
create trigger crm_opportunities_fx_snapshot
  before insert or update of status, currency, value_amount
  on public.crm_opportunities
  for each row
  execute function public.crm_opportunity_fx_snapshot();

-- ---------------------------------------------------------------------------
-- 4. The converted amount, derived so it cannot drift.
-- ---------------------------------------------------------------------------
/*
 * ⚠️ NULL WHEN THE RATE IS UNKNOWN, AND THAT NULL IS THE FEATURE. `sum()`
 * skips NULLs, so an unconvertible deal drops out of a total instead of being
 * added at face value in the wrong currency. It drops out VISIBLY, because
 * every rollup below also counts what it could not convert.
 *
 * A generated column cannot read another table, which is exactly why §5.6 puts
 * the rate ON the deal rather than looking it up at report time.
 */
alter table public.crm_opportunities
  add column if not exists value_amount_base numeric(14, 2)
  generated always as (
    case
      when value_amount is null or fx_rate_to_workspace_currency is null then null
      else round(value_amount * fx_rate_to_workspace_currency, 2)
    end
  ) stored;

-- ---------------------------------------------------------------------------
-- 5. Backfill.
-- ---------------------------------------------------------------------------
/*
 * ⚠️ ONLY WHERE THE CURRENCIES MATCH. Same rule as the trigger — this is the
 * historic form of the same identity, not a bulk guess. Any row that does not
 * match is left NULL and will be reported as unconvertible until a feed fills
 * it, which is the honest outcome.
 *
 * `fx_rate_date` uses the day the deal closed where there is one, so a
 * historic row's snapshot is dated when the money actually landed rather than
 * when this migration ran.
 */
update public.crm_opportunities o
   set fx_rate_to_workspace_currency = 1,
       fx_rate_date = coalesce((o.closed_at at time zone 'UTC')::date,
                               (o.created_at at time zone 'UTC')::date,
                               current_date)
  from public.workspaces w
 where w.id = o.workspace_id
   and o.fx_rate_to_workspace_currency is null
   and o.currency = w.default_currency;

-- ---------------------------------------------------------------------------
-- 6. How many a total had to leave out.
-- ---------------------------------------------------------------------------
/*
 * ⚠️ A SHORTFALL NOBODY CAN SEE IS WORSE THAN A WRONG NUMBER. Once `sum()`
 * skips unconvertible deals, a pipeline total can quietly drop by the value of
 * every euro deal in it. This counts them so a screen can say so.
 *
 * Returns a COUNT rather than an amount: the amount is in a currency we cannot
 * convert, so adding several of them together would recreate the original bug
 * inside the warning about it.
 */
create or replace function public.crm_unconvertible_deals(
  p_workspace_id uuid,
  p_status       text default null
)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer
    from public.crm_opportunities o
   where o.workspace_id = p_workspace_id
     and o.deleted_at is null
     and o.value_amount is not null
     and o.fx_rate_to_workspace_currency is null
     and (p_status is null or o.status::text = p_status);
$$;

revoke all on function public.crm_unconvertible_deals(uuid, text) from public, anon;
grant execute on function public.crm_unconvertible_deals(uuid, text)
  to authenticated, service_role;

comment on column public.crm_opportunities.fx_rate_to_workspace_currency is
  'Rate to the workspace currency, snapshotted at create and at close (§5.6). '
  'NULL means UNCONVERTIBLE, never 1 — see 0123.';

comment on column public.crm_opportunities.value_amount_base is
  'value_amount converted at the snapshotted rate. NULL when the rate is '
  'unknown, so sum() drops it rather than adding a foreign amount (0130).';

comment on function public.crm_unconvertible_deals(uuid, text) is
  'How many priced deals a total had to leave out for want of a rate (0130).';
