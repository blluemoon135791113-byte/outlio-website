-- Smoke test for 0145 — Navigator identity, the copy-not-move transition, and
-- last_activity_at.
--
-- Run with:
--   scripts/check-migration.sh supabase/migrations/0145_crm_account_fields.sql \
--     supabase/migrations/smoke/0145_crm_account_fields.smoke.sql

\set ON_ERROR_STOP on

begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com');

insert into public.workspaces (id, name, owner_user_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Smoke',
        '11111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- 1–2. What pre-step-2 code does: writes a Navigator address into the
--      LinkedIn columns. The trigger copies it; the original stays.
-- ---------------------------------------------------------------------------
insert into public.crm_companies (id, workspace_id, name, normalized_name, linkedin_url, normalized_linkedin_url)
values ('c1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'Acme Health', 'acme health',
        'https://www.linkedin.com/sales/company/1234', 'linkedin.com/sales/company/1234');

insert into smoke_checks (label, ok)
select 'navigator address copied on insert',
       coalesce((select normalized_sales_navigator_url = 'linkedin.com/sales/company/1234'
                        and sales_navigator_url = 'https://www.linkedin.com/sales/company/1234'
                   from public.crm_companies where id = 'c1000000-0000-4000-8000-000000000001'), false);
insert into smoke_checks (label, ok)
select 'linkedin column left in place for old code',
       coalesce((select normalized_linkedin_url = 'linkedin.com/sales/company/1234'
                   from public.crm_companies where id = 'c1000000-0000-4000-8000-000000000001'), false);

-- 3. A public page is NOT copied.
insert into public.crm_companies (id, workspace_id, name, normalized_name, linkedin_url, normalized_linkedin_url)
values ('c1000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'Beta Care', 'beta care',
        'https://www.linkedin.com/company/beta-care', 'linkedin.com/company/beta-care');
insert into smoke_checks (label, ok)
select 'public company page not treated as navigator',
       coalesce((select normalized_sales_navigator_url is null
                   from public.crm_companies where id = 'c1000000-0000-4000-8000-000000000002'), false);

-- 4. Navigator identity is unique per workspace.
do $$
declare
  v_refused boolean := false;
begin
  begin
    insert into public.crm_companies (workspace_id, name, normalized_name,
                                      sales_navigator_url, normalized_sales_navigator_url)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Acme Copy', 'acme copy',
            'https://www.linkedin.com/sales/company/1234', 'linkedin.com/sales/company/1234');
  exception when unique_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('duplicate navigator identity refused', v_refused);
end $$;

-- 5. A Navigator-only row and a name-only row with the same name coexist.
insert into public.crm_companies (workspace_id, name, normalized_name,
                                  sales_navigator_url, normalized_sales_navigator_url)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Gamma', 'gamma',
        'https://www.linkedin.com/sales/company/999', 'linkedin.com/sales/company/999');
insert into public.crm_companies (workspace_id, name, normalized_name)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Gamma', 'gamma');
insert into smoke_checks (label, ok)
select 'navigator-identified row is not name-only',
       coalesce((select count(id) = 2 from public.crm_companies
                  where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
                    and normalized_name = 'gamma'), false);

-- 6. Two name-only rows are still refused.
do $$
declare
  v_refused boolean := false;
begin
  begin
    insert into public.crm_companies (workspace_id, name, normalized_name)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Gamma', 'gamma');
  exception when unique_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('name-only duplicate still refused', v_refused);
end $$;

-- 7. A malformed Navigator key is refused.
do $$
declare
  v_refused boolean := false;
begin
  begin
    insert into public.crm_companies (workspace_id, name, normalized_name, normalized_sales_navigator_url)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Bad', 'bad', 'example.com/sales/company/1');
  exception when check_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('malformed navigator key refused', v_refused);
end $$;

-- 8. Priority is a closed set.
do $$
declare
  v_refused boolean := false;
begin
  begin
    update public.crm_companies set priority = 'urgent'
     where id = 'c1000000-0000-4000-8000-000000000001';
  exception when check_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('unknown priority refused', v_refused);
end $$;

-- 9. A status in use cannot be deleted.
update public.crm_companies
   set status_id = (select id from public.crm_account_statuses
                     where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and slug = 'researching')
 where id = 'c1000000-0000-4000-8000-000000000001';
do $$
declare
  v_refused boolean := false;
begin
  begin
    delete from public.crm_account_statuses
     where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and slug = 'researching';
  exception when foreign_key_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('status in use cannot be deleted', v_refused);
end $$;

-- ---------------------------------------------------------------------------
-- 10–12. last_activity_at follows the account AND its people, forwards only.
-- ---------------------------------------------------------------------------
insert into public.crm_contacts (id, workspace_id, full_name, primary_company_id)
values ('d1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'Pat Example', 'c1000000-0000-4000-8000-000000000001');

insert into public.crm_activities (workspace_id, company_id, activity_type, channel, occurred_at)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-000000000001',
        'NOTE_ADDED', 'manual', '2026-09-01T10:00:00Z');
insert into smoke_checks (label, ok)
select 'company activity sets last_activity_at',
       coalesce((select last_activity_at = '2026-09-01T10:00:00Z'
                   from public.crm_companies where id = 'c1000000-0000-4000-8000-000000000001'), false);

insert into public.crm_activities (workspace_id, contact_id, activity_type, channel, occurred_at)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd1000000-0000-4000-8000-000000000001',
        'EMAIL_SENT', 'email', '2026-09-05T10:00:00Z');
insert into smoke_checks (label, ok)
select 'activity on a person at the account moves it',
       coalesce((select last_activity_at = '2026-09-05T10:00:00Z'
                   from public.crm_companies where id = 'c1000000-0000-4000-8000-000000000001'), false);

insert into public.crm_activities (workspace_id, company_id, activity_type, channel, occurred_at)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-000000000001',
        'NOTE_ADDED', 'manual', '2026-08-01T10:00:00Z');
insert into smoke_checks (label, ok)
select 'an older event never moves it backwards',
       coalesce((select last_activity_at = '2026-09-05T10:00:00Z'
                   from public.crm_companies where id = 'c1000000-0000-4000-8000-000000000001'), false);

-- 13. System events (assignment, handover) do not count as activity.
insert into public.crm_activities (workspace_id, company_id, activity_type, channel, occurred_at)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-000000000001',
        'OWNER_ASSIGNED', 'system', '2026-09-20T10:00:00Z');
insert into smoke_checks (label, ok)
select 'system activity ignored',
       coalesce((select last_activity_at = '2026-09-05T10:00:00Z'
                   from public.crm_companies where id = 'c1000000-0000-4000-8000-000000000001'), false);

-- 14–16. updated_at: untouched by a last-activity touch, still bumped by a real edit.
alter table public.crm_companies disable trigger crm_companies_set_updated_at;
update public.crm_companies set updated_at = '2020-01-01T00:00:00Z'
 where id = 'c1000000-0000-4000-8000-000000000001';
alter table public.crm_companies enable trigger crm_companies_set_updated_at;

insert into public.crm_activities (workspace_id, company_id, activity_type, channel, occurred_at)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-000000000001',
        'CALL_BOOKED', 'meeting', now() + interval '7 days');
insert into smoke_checks (label, ok)
select 'a future-dated event is capped at now',
       coalesce((select last_activity_at = now()
                   from public.crm_companies where id = 'c1000000-0000-4000-8000-000000000001'), false);
insert into smoke_checks (label, ok)
select 'activity touch does not bump updated_at',
       coalesce((select updated_at = '2020-01-01T00:00:00Z'
                   from public.crm_companies where id = 'c1000000-0000-4000-8000-000000000001'), false);

update public.crm_companies set summary = 'Edited by a person'
 where id = 'c1000000-0000-4000-8000-000000000001';
insert into smoke_checks (label, ok)
select 'a real edit still bumps updated_at',
       coalesce((select updated_at = now()
                   from public.crm_companies where id = 'c1000000-0000-4000-8000-000000000001'), false);

-- ---------------------------------------------------------------------------
-- The gate
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 16;
  v_total    integer;
  v_failed   text;
begin
  select count(n), string_agg(label, '; ' order by n) filter (where ok is not true)
    into v_total, v_failed
    from smoke_checks;

  if v_total <> v_expected then
    raise exception 'SMOKE FAILED: expected % checks, recorded %', v_expected, v_total;
  end if;

  if v_failed is not null then
    raise exception 'SMOKE FAILED: %', v_failed;
  end if;

  raise notice 'SMOKE PASSED: % of % checks', v_total, v_expected;
end $$;

rollback;
