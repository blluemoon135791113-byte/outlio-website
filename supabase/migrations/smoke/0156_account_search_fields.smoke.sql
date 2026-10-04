-- Smoke test for 0156 — the new account-row columns hold exactly what a page
-- can show, and an upload cites an account once.
--
-- Run with:
--   scripts/check-migration.sh supabase/migrations/0156_account_search_fields.sql \
--     supabase/migrations/smoke/0156_account_search_fields.smoke.sql

\set ON_ERROR_STOP on

begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'owner@example.com');
insert into public.workspaces (id, name, owner_user_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'W', '11111111-1111-1111-1111-111111111111');
-- The harness scaffolds these two by id only (their real columns are not under test).
insert into public.extraction_jobs (id) values ('f1000000-0000-4000-8000-000000000001');
insert into public.companies (id) values ('f2000000-0000-4000-8000-000000000001');
insert into public.crm_companies (id, workspace_id, name, normalized_name) values
  ('c1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Acme', 'acme');

create or replace function pg_temp.refused(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when check_violation or unique_violation then
  return true;
end;
$$;

-- 1. An Account Hub row written the old way still works, with the defaults.
insert into public.account_list_entries (user_id, extraction_job_id, company_id, source_row_index,
  company_name_snapshot, company_sales_navigator_url)
values ('11111111-1111-1111-1111-111111111111', 'f1000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001', 0, 'Acme', 'https://www.linkedin.com/sales/company/1');
insert into smoke_checks (label, ok)
select 'old writers unaffected: account_hub, no signals',
       page_kind = 'account_hub' and signals = '{}' and summary_snapshot is null
  from public.account_list_entries where company_id = 'f2000000-0000-4000-8000-000000000001';

-- 2. A search row with everything the page can show.
update public.account_list_entries
   set page_kind = 'account_search', employee_count_snapshot = 253, summary_snapshot = 'We make widgets.',
       signals = array['hiring_on_linkedin', 'aiq_strategic_priorities']
 where company_id = 'f2000000-0000-4000-8000-000000000001';
insert into smoke_checks (label, ok)
select 'a search row stores count, About and signals',
       employee_count_snapshot = 253 and summary_snapshot = 'We make widgets.' and cardinality(signals) = 2
  from public.account_list_entries where company_id = 'f2000000-0000-4000-8000-000000000001';

-- 3. Bounds: kind, negative count, blank range, oversized About, prose signals.
insert into smoke_checks (label, ok)
select 'bad kind, negative count, blank range, long About, prose signal refused',
       pg_temp.refused($q$ update public.account_list_entries set page_kind = 'people' $q$)
   and pg_temp.refused($q$ update public.account_list_entries set employee_count_snapshot = -1 $q$)
   and pg_temp.refused($q$ update public.account_list_entries set employee_count_range_snapshot = '  ' $q$)
   and pg_temp.refused($q$ update public.account_list_entries set summary_snapshot = repeat('x', 5001) $q$)
   and pg_temp.refused($q$ update public.account_list_entries set signals = array['Hiring on LinkedIn!'] $q$)
   and pg_temp.refused($q$ update public.account_list_entries
                           set signals = (select array_agg('s' || g) from generate_series(1, 11) g) $q$);

-- 4. One provenance row per (account, upload); manual sources unaffected.
insert into public.crm_company_sources (workspace_id, company_id, source_type, extraction_job_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-000000000001', 'html_upload',
        'f1000000-0000-4000-8000-000000000001');
insert into public.crm_company_sources (workspace_id, company_id, source_type) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-000000000001', 'manual'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-000000000001', 'manual');
insert into smoke_checks (label, ok)
select 'an upload cites an account once; manual sources repeat freely',
       pg_temp.refused($q$ insert into public.crm_company_sources (workspace_id, company_id, source_type, extraction_job_id)
         values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-000000000001', 'html_upload',
                 'f1000000-0000-4000-8000-000000000001') $q$)
   and (select count(*) from public.crm_company_sources where source_type = 'manual') = 2;

-- ---------------------------------------------------------------------------
-- The gate
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 4;
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
