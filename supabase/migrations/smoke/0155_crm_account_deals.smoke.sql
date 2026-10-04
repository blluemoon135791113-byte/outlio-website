-- Smoke test for 0155 — one deal per account, never a duplicate open one in
-- the same pipeline, nothing invented.
--
-- Run with:
--   scripts/check-migration.sh supabase/migrations/0155_crm_account_deals.sql \
--     supabase/migrations/smoke/0155_crm_account_deals.smoke.sql

\set ON_ERROR_STOP on

begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'owner@example.com');
insert into public.workspaces (id, name, owner_user_id, default_currency) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'W', '11111111-1111-1111-1111-111111111111', 'GBP'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Other', '11111111-1111-1111-1111-111111111111', 'USD');

insert into public.crm_pipelines (id, workspace_id, name) values
  ('e1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Sales'),
  ('e1000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Renewals'),
  ('e1000000-0000-4000-8000-000000000009', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Theirs');
insert into public.crm_pipelines (id, workspace_id, name, archived_at) values
  ('e1000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Old', now());

insert into public.crm_pipeline_stages (id, workspace_id, pipeline_id, name, kind, sort_order, default_probability) values
  ('e2000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e1000000-0000-4000-8000-000000000001', 'Qualified', 'open', 1, 20),
  ('e2000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e1000000-0000-4000-8000-000000000001', 'Won', 'won', 9, 100),
  ('e2000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e1000000-0000-4000-8000-000000000002', 'Due', 'open', 1, 50),
  ('e2000000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e1000000-0000-4000-8000-000000000003', 'Gone', 'open', 1, 0),
  ('e2000000-0000-4000-8000-000000000009', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'e1000000-0000-4000-8000-000000000009', 'Theirs', 'open', 1, 0);

insert into public.crm_companies (id, workspace_id, name, normalized_name, domain, normalized_domain, linkedin_url, normalized_linkedin_url) values
  ('c1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Acme', 'acme', null, null, null, null),
  ('c1000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Beta', 'beta', null, null, null, null),
  ('c1000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, null, 'gamma.example.com', 'gamma.example.com', null, null),
  -- Known only by a LinkedIn page: no name, no domain.
  ('c1000000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, null, null, null,
   'https://www.linkedin.com/company/fabricated-4', 'linkedin.com/company/fabricated-4'),
  ('c1000000-0000-4000-8000-000000000009', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Elsewhere', 'elsewhere', null, null, null, null);
insert into public.crm_companies (id, workspace_id, name, normalized_name, deleted_at) values
  ('c1000000-0000-4000-8000-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Deleted', 'deleted', now());

-- Beta already has an open deal in Sales; Acme has a LOST one there.
insert into public.crm_opportunities (workspace_id, title, company_id, pipeline_id, stage_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Beta existing', 'c1000000-0000-4000-8000-000000000002',
   'e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001');
insert into public.crm_opportunities (workspace_id, title, company_id, pipeline_id, stage_id, status, closed_at, lost_reason) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Acme lost', 'c1000000-0000-4000-8000-000000000001',
   'e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'lost', now(), 'price');

create or replace function pg_temp.refused(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when check_violation then
  return true;
end;
$$;

create temp table run1 as
select public.crm_create_account_deals(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e2000000-0000-4000-8000-000000000001',
  array['c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002',
        'c1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000004',
        'c1000000-0000-4000-8000-000000000005', 'c1000000-0000-4000-8000-000000000009',
        'c1000000-0000-4000-8000-000000000001']::uuid[],
  '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111') as r;

-- 1. Acme (only a LOST deal) and Gamma get one; Beta (open deal) is skipped.
insert into smoke_checks (label, ok)
select 'one deal each; an open deal in the pipeline skips; a closed one does not',
       jsonb_array_length(r -> 'created') = 2
   and r -> 'skipped_open' = jsonb_build_array('c1000000-0000-4000-8000-000000000002')
   and (select count(*) from public.crm_opportunities
         where company_id = 'c1000000-0000-4000-8000-000000000002' and deleted_at is null) = 1
  from run1;

-- 2. Named after the account, or its domain; never invented.
insert into smoke_checks (label, ok)
select 'title is the account name, else its domain; no name and no domain is skipped',
       (select title from public.crm_opportunities
         where company_id = 'c1000000-0000-4000-8000-000000000001' and status = 'open') = 'Acme'
   and (select title from public.crm_opportunities
         where company_id = 'c1000000-0000-4000-8000-000000000003') = 'gamma.example.com'
   and (select r -> 'skipped_unnamed' from run1) = jsonb_build_array('c1000000-0000-4000-8000-000000000004')
   and not exists (select 1 from public.crm_opportunities where company_id = 'c1000000-0000-4000-8000-000000000004');

-- 3. Deleted, foreign and repeated ids: counted as missing, never touched.
insert into smoke_checks (label, ok)
select 'deleted and other-workspace accounts are missing; a repeated id is one deal',
       (r ->> 'missing')::int = 2
   and not exists (select 1 from public.crm_opportunities
                    where company_id in ('c1000000-0000-4000-8000-000000000005', 'c1000000-0000-4000-8000-000000000009'))
   and (select count(*) from public.crm_opportunities
         where company_id = 'c1000000-0000-4000-8000-000000000001' and status = 'open') = 1
  from run1;

-- 4. Exactly the facts: no value, workspace currency + identity rate, stage probability, owner.
insert into smoke_checks (label, ok)
select 'no value; workspace currency at rate 1; stage probability; no contact; owner set',
       value_amount is null and currency = 'GBP' and fx_rate_to_workspace_currency = 1
   and probability = 20 and contact_id is null
   and owner_user_id = '11111111-1111-1111-1111-111111111111' and status = 'open'
  from public.crm_opportunities
 where company_id = 'c1000000-0000-4000-8000-000000000001' and status = 'open';

-- 5. Running it again creates nothing: everyone now has an open deal there.
create temp table run2 as
select public.crm_create_account_deals(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e2000000-0000-4000-8000-000000000001',
  array['c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000003']::uuid[],
  null, null) as r;
insert into smoke_checks (label, ok)
select 'a second run is a no-op', jsonb_array_length(r -> 'created') = 0 and jsonb_array_length(r -> 'skipped_open') = 2
  from run2;

-- 6. Another pipeline is a different question: Beta can be in Renewals.
create temp table run3 as
select public.crm_create_account_deals(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e2000000-0000-4000-8000-000000000003',
  array['c1000000-0000-4000-8000-000000000002']::uuid[], null, null) as r;
insert into smoke_checks (label, ok)
select 'an open deal in ANOTHER pipeline does not block',
       jsonb_array_length(r -> 'created') = 1 and r ->> 'pipeline_id' = 'e1000000-0000-4000-8000-000000000002'
  from run3;

-- 7. Refusals: a won stage, an archived pipeline, another workspace's stage, >100.
insert into smoke_checks (label, ok)
select 'won stage, archived pipeline, foreign stage and over 100 are refused',
       pg_temp.refused($q$ select public.crm_create_account_deals('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
         'e2000000-0000-4000-8000-000000000002', array['c1000000-0000-4000-8000-000000000002']::uuid[], null, null) $q$)
   and pg_temp.refused($q$ select public.crm_create_account_deals('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
         'e2000000-0000-4000-8000-000000000004', array['c1000000-0000-4000-8000-000000000002']::uuid[], null, null) $q$)
   and pg_temp.refused($q$ select public.crm_create_account_deals('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
         'e2000000-0000-4000-8000-000000000009', array['c1000000-0000-4000-8000-000000000002']::uuid[], null, null) $q$)
   and pg_temp.refused($q$ select public.crm_create_account_deals('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
         'e2000000-0000-4000-8000-000000000001',
         (select array_agg(gen_random_uuid()) from generate_series(1, 101)), null, null) $q$);

-- 8. Service role only.
insert into smoke_checks (label, ok)
select 'service role only',
       not has_function_privilege('authenticated', 'public.crm_create_account_deals(uuid,uuid,uuid[],uuid,uuid)', 'execute')
   and not has_function_privilege('anon', 'public.crm_create_account_deals(uuid,uuid,uuid[],uuid,uuid)', 'execute')
   and has_function_privilege('service_role', 'public.crm_create_account_deals(uuid,uuid,uuid[],uuid,uuid)', 'execute');

-- ---------------------------------------------------------------------------
-- The gate
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 8;
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
