-- ---------------------------------------------------------------------------
-- 0145 — Account workspace, step 2 of 6: the fields an account is worked by
--
-- `crm_companies` IS the account. This adds what the Accounts page needs and
-- nothing that duplicates a column it already has:
--
--   location         → the existing `headquarters` column. Not added again.
--   employee_count   → stays an integer (an exact headcount off a company
--                      page). A RANGE such as "51-200" goes in the new
--                      `employee_count_range`, because turning a range into a
--                      number means choosing one — inference, which rule 4
--                      forbids. lib/crm/ingest.ts already refuses to do it.
--   owner_user_id    → stays the CURRENT PRIMARY ASSIGNEE, which is what
--                      dataScope, member handover and the company_owner routing
--                      rule (0127) already read it as. 0147 keeps it in step
--                      with the assignment history. "Who added it" is the
--                      existing `created_by`.
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  A COMPANY HAS TWO LINKEDIN ADDRESSES, AND OUTLIO KEPT ONE.              ║
-- ║                                                                           ║
-- ║  The same defect 0138 fixed for contacts. `normalized_linkedin_url`       ║
-- ║  holds EITHER `linkedin.com/company/{slug}` OR                            ║
-- ║  `linkedin.com/sales/company/{id}`, whichever the capture carried, and    ║
-- ║  the two cannot be converted into each other without a request to         ║
-- ║  linkedin.com (rule 1). So an account had one or the other, never both,   ║
-- ║  and a Sales Navigator address sat in a column named "LinkedIn".          ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠️ THIS MIGRATION COPIES, IT DOES NOT MOVE. Sales Navigator values are
-- copied into the new columns and LEFT in the LinkedIn columns, because the
-- code running when this is applied still finds companies by
-- `normalized_linkedin_url`. Clearing them now would make that code miss
-- every Navigator-identified account and try to create it again. The
-- clearing ships with the code that reads the new column (build step 2), and
-- the trigger below keeps the copy current until then.
--
-- ⚠️ VALIDATE BEFORE APPLYING:
--   scripts/check-migration.sh supabase/migrations/0145_crm_account_fields.sql \
--     supabase/migrations/smoke/0145_crm_account_fields.smoke.sql
--
-- ROLLBACK — roll back 0149 → 0144 strictly in reverse order. No data is lost
-- WHILE THE LINKEDIN COLUMNS STILL HOLD THE NAVIGATOR VALUES; once build step 2
-- clears them, copy them back before restoring the old identity check and name
-- index, or both will fail on Navigator-only accounts.
--   drop trigger if exists crm_activities_touch_company on public.crm_activities;
--   drop function if exists public.crm_touch_company_last_activity();
--   drop trigger if exists crm_companies_mirror_navigator_url on public.crm_companies;
--   drop function if exists public.crm_companies_mirror_navigator_url();
--   drop trigger if exists crm_companies_set_updated_at on public.crm_companies;
--   create trigger crm_companies_set_updated_at before update on public.crm_companies
--     for each row execute function public.set_updated_at();
--   drop index if exists public.crm_companies_navigator_uniq;
--   drop index if exists public.crm_companies_status_idx;
--   drop index if exists public.crm_companies_last_activity_idx;
--   drop index if exists public.crm_companies_name_uniq;
--   create unique index crm_companies_name_uniq on public.crm_companies
--     (workspace_id, normalized_name) where normalized_name is not null
--     and normalized_domain is null and normalized_linkedin_url is null
--     and deleted_at is null;
--   alter table public.crm_companies drop constraint crm_companies_has_identity;
--   alter table public.crm_companies add constraint crm_companies_has_identity
--     check (normalized_domain is not null or normalized_linkedin_url is not null
--            or normalized_name is not null);
--   alter table public.crm_companies drop column sales_navigator_url,
--     drop column normalized_sales_navigator_url, drop column summary,
--     drop column status_id, drop column priority, drop column last_activity_at,
--     drop column employee_count_range;
--   ⚠️ `alter type crm_record_source add value 'extension'` cannot be undone;
--   an unused enum value is harmless.
-- ---------------------------------------------------------------------------

-- Used only inside function bodies and by later migrations, so safe even where
-- the whole script runs as one transaction.
alter type public.crm_record_source add value if not exists 'extension';

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.crm_companies
  add column if not exists sales_navigator_url            text,
  add column if not exists normalized_sales_navigator_url text,
  add column if not exists summary                        text,
  add column if not exists status_id                      uuid,
  add column if not exists priority                       text,
  add column if not exists last_activity_at               timestamptz,
  add column if not exists employee_count_range           text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_companies_navigator_normalized') then
    alter table public.crm_companies
      add constraint crm_companies_navigator_normalized check (
        normalized_sales_navigator_url is null
        or normalized_sales_navigator_url ~ '^linkedin\.com/sales/company/[0-9]+$'
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'crm_companies_priority_valid') then
    alter table public.crm_companies
      add constraint crm_companies_priority_valid
        check (priority is null or priority in ('high', 'medium', 'low'));
  end if;

  -- Never auto-generated (rule 4); bounded so a pasted document cannot bloat
  -- every list query that selects it.
  if not exists (select 1 from pg_constraint where conname = 'crm_companies_summary_bounded') then
    alter table public.crm_companies
      add constraint crm_companies_summary_bounded
        check (summary is null or length(summary) <= 5000);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'crm_companies_employee_range_bounded') then
    alter table public.crm_companies
      add constraint crm_companies_employee_range_bounded
        check (employee_count_range is null or length(trim(employee_count_range)) between 1 and 40);
  end if;

  -- RESTRICT: a status an account still holds cannot be deleted; disable it.
  if not exists (select 1 from pg_constraint where conname = 'crm_companies_status_fk') then
    alter table public.crm_companies
      add constraint crm_companies_status_fk
        foreign key (status_id, workspace_id)
        references public.crm_account_statuses (id, workspace_id)
        on delete restrict;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Identity
--
-- A Navigator address is now an identity in its own right, so:
--   1. it is unique per workspace, like the other two strong identifiers;
--   2. it satisfies the "identifies something" check on its own;
--   3. a row carrying one is no longer "name only", so the name index must
--      stop treating it as such — otherwise "Acme" known only by Navigator id
--      and a different "Acme" known only by name could not coexist.
-- The index is REPLACED with a strictly less restrictive one, so rebuilding it
-- cannot fail on existing data.
-- ---------------------------------------------------------------------------

create unique index if not exists crm_companies_navigator_uniq
  on public.crm_companies (workspace_id, normalized_sales_navigator_url)
  where normalized_sales_navigator_url is not null and deleted_at is null;

alter table public.crm_companies drop constraint if exists crm_companies_has_identity;
alter table public.crm_companies
  add constraint crm_companies_has_identity check (
    normalized_domain is not null
    or normalized_linkedin_url is not null
    or normalized_sales_navigator_url is not null
    or normalized_name is not null
  );

drop index if exists public.crm_companies_name_uniq;
create unique index crm_companies_name_uniq
  on public.crm_companies (workspace_id, normalized_name)
  where normalized_name is not null
    and normalized_domain is null
    and normalized_linkedin_url is null
    and normalized_sales_navigator_url is null
    and deleted_at is null;

create index if not exists crm_companies_status_idx
  on public.crm_companies (workspace_id, status_id) where deleted_at is null;
create index if not exists crm_companies_last_activity_idx
  on public.crm_companies (workspace_id, last_activity_at desc nulls last) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Copy existing Navigator identities into their own column
--
-- Unique already: these values were unique in normalized_linkedin_url within
-- the same workspace and the same live/deleted partition.
-- ---------------------------------------------------------------------------

-- ⚠️ updated_at IS LEFT ALONE. GET /api/v1/companies returns it to customers,
-- whose sync jobs may page on it; a backfill that stamped every row "now"
-- would tell every integration that every account just changed.
alter table public.crm_companies disable trigger crm_companies_set_updated_at;

update public.crm_companies
   set sales_navigator_url            = linkedin_url,
       normalized_sales_navigator_url = normalized_linkedin_url
 where normalized_linkedin_url ~ '^linkedin\.com/sales/company/[0-9]+$'
   and normalized_sales_navigator_url is null;

alter table public.crm_companies enable trigger crm_companies_set_updated_at;

/*
 * ⚠️ TRANSITIONAL. Code deployed before build step 2 writes Navigator
 * addresses into the LinkedIn columns; this copies them across on the way in
 * so the new column is complete from the moment this migration lands.
 * It only ever FILLS an empty Navigator column — it never overwrites one.
 */
create or replace function public.crm_companies_mirror_navigator_url()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.normalized_sales_navigator_url is null
     and new.normalized_linkedin_url ~ '^linkedin\.com/sales/company/[0-9]+$' then
    new.sales_navigator_url            := new.linkedin_url;
    new.normalized_sales_navigator_url := new.normalized_linkedin_url;
  end if;
  return new;
end;
$$;

drop trigger if exists crm_companies_mirror_navigator_url on public.crm_companies;
create trigger crm_companies_mirror_navigator_url
  before insert or update of linkedin_url, normalized_linkedin_url on public.crm_companies
  for each row execute function public.crm_companies_mirror_navigator_url();

-- ---------------------------------------------------------------------------
-- last_activity_at
--
-- STORED, NOT COMPUTED, because the Accounts list sorts by it server-side and
-- a sort over an aggregate of crm_activities would scan the workspace's whole
-- history on every page.
--
-- An account's last activity is the newest HUMAN or CUSTOMER event about the
-- account or anyone who currently works there. `system` events (assignment,
-- handover, merge) are excluded: reassigning a dormant account must not make
-- it look worked.
--
-- crm_activities is append-only (0075), so INSERT is the only event to follow,
-- and the `<` guard makes an out-of-order backfill a no-op rather than moving
-- the date backwards.
-- ---------------------------------------------------------------------------

create or replace function public.crm_touch_company_last_activity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid := new.company_id;
  -- A booked call can be dated next week; "last activity" never is.
  v_at         timestamptz := least(new.occurred_at, now());
begin
  if new.channel = 'system' then
    return new;
  end if;

  if v_company_id is null and new.contact_id is not null then
    select c.primary_company_id into v_company_id
      from public.crm_contacts c
     where c.id = new.contact_id
       and c.workspace_id = new.workspace_id;
  end if;

  if v_company_id is not null then
    /*
     * ⚠️ SKIP LOCKED, BECAUSE THIS RIDES ON THE ACTIVITY INSERT. Ingestion,
     * handover and the email workers insert activities across many accounts;
     * waiting on a company row here would let a busy account stall — or
     * deadlock — the append-only write it is merely annotating. Losing one
     * touch to contention leaves the date stale until the next activity,
     * which is the right trade.
     */
    update public.crm_companies
       set last_activity_at = v_at
     where id = (
       select co.id
         from public.crm_companies co
        where co.id = v_company_id
          and co.workspace_id = new.workspace_id
          and (co.last_activity_at is null or co.last_activity_at < v_at)
          for update skip locked
     );
  end if;

  return new;
end;
$$;

revoke all on function public.crm_touch_company_last_activity() from public, anon, authenticated;

drop trigger if exists crm_activities_touch_company on public.crm_activities;
create trigger crm_activities_touch_company
  after insert on public.crm_activities
  for each row execute function public.crm_touch_company_last_activity();

/*
 * ⚠️ AND THE TRIGGER ITSELF MUST NOT BUMP updated_at, for the same API reason:
 * every logged email would otherwise mark its account "changed". The stock
 * trigger is recreated to skip an update whose ONLY change is
 * last_activity_at. Every other update behaves exactly as before.
 */
drop trigger if exists crm_companies_set_updated_at on public.crm_companies;
create trigger crm_companies_set_updated_at
  before update on public.crm_companies
  for each row
  when (
    old.last_activity_at is not distinct from new.last_activity_at
    or (to_jsonb(old) - 'last_activity_at' - 'updated_at')
         is distinct from (to_jsonb(new) - 'last_activity_at' - 'updated_at')
  )
  execute function public.set_updated_at();

-- Backfill from history, once. Two grouped scans unioned, rather than a
-- correlated subquery per company.
with per_source as (
  select a.workspace_id, a.company_id, max(least(a.occurred_at, now())) as at
    from public.crm_activities a
   where a.company_id is not null
     and a.channel <> 'system'
   group by a.workspace_id, a.company_id
  union all
  select c.workspace_id, c.primary_company_id, max(least(a.occurred_at, now()))
    from public.crm_activities a
    join public.crm_contacts c
      on c.id = a.contact_id
     and c.workspace_id = a.workspace_id
   where c.primary_company_id is not null
     and a.channel <> 'system'
   group by c.workspace_id, c.primary_company_id
),
latest as (
  select workspace_id, company_id, max(at) as at
    from per_source
   group by workspace_id, company_id
)
update public.crm_companies co
   set last_activity_at = latest.at
  from latest
 where co.id = latest.company_id
   and co.workspace_id = latest.workspace_id
   and (co.last_activity_at is null or co.last_activity_at < latest.at);

-- ---------------------------------------------------------------------------
-- Documentation
-- ---------------------------------------------------------------------------

comment on column public.crm_companies.sales_navigator_url is
  'The Sales Navigator company address (/sales/company/{id}), shown as a plain link. Not interconvertible with linkedin_url.';
comment on column public.crm_companies.normalized_sales_navigator_url is
  'linkedin.com/sales/company/{id}. Unique per workspace; an identity on its own.';
comment on column public.crm_companies.summary is
  'Human-written. Never generated (CLAUDE.md rule 4).';
comment on column public.crm_companies.employee_count_range is
  'A headcount RANGE exactly as observed ("51-200"). Never converted to employee_count.';
comment on column public.crm_companies.last_activity_at is
  'Newest non-system crm_activities event about the account or anyone currently at it, never in the future. Maintained by trigger, best-effort under contention; does not bump updated_at.';
comment on column public.crm_companies.owner_user_id is
  'The current primary assignee. Kept in step with crm_company_assignments (0147).';
