-- Smoke test for 0146 — one primary ICP, vocabulary deletion rules, tenant
-- isolation, and append-only sources that still let jobs, users and
-- workspaces be deleted.
--
-- ⚠️ THE PRIMARY-ICP CHECK IS DEFERRED, and this file runs inside one
-- transaction that is rolled back — so a deferred trigger would never fire
-- here and every check of it would pass vacuously. Each one therefore forces
-- it with `set constraints ... immediate` inside a savepoint.
--
-- Run with:
--   scripts/check-migration.sh supabase/migrations/0146_crm_account_tags.sql \
--     supabase/migrations/smoke/0146_crm_account_tags.smoke.sql

\set ON_ERROR_STOP on

begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'importer@example.com');

insert into public.workspaces (id, name, owner_user_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Smoke', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Other', '11111111-1111-1111-1111-111111111111');

insert into public.crm_companies (id, workspace_id, name, normalized_name) values
  ('c1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Acme', 'acme'),
  ('c1000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Beta', 'beta');

create temp table ids as
select
  (select id from public.crm_icp_types where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and slug = 'hospital-health-system') as hospital,
  (select id from public.crm_icp_types where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and slug = 'provider-group') as provider,
  (select id from public.crm_icp_types where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and slug = 'tpa') as tpa,
  (select id from public.crm_icp_types where workspace_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and slug = 'tpa') as other_tpa,
  (select id from public.crm_products where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and slug = 'rcm') as rcm,
  (select id from public.crm_products where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and slug = 'fhir-gateway') as fhir,
  (select id from public.crm_products where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and slug = 'pbm') as pbm;

-- 1. 1 primary + 1 secondary ICP and 3 products, checked immediately.
insert into public.crm_company_icps (workspace_id, company_id, icp_type_id, is_primary)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'c1000000-0000-4000-8000-000000000001'::uuid, hospital, true from ids
union all
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'c1000000-0000-4000-8000-000000000001'::uuid, provider, false from ids;
insert into public.crm_company_products (workspace_id, company_id, product_id)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'c1000000-0000-4000-8000-000000000001'::uuid, p
  from ids, lateral (values (rcm), (fhir), (pbm)) as v(p);
set constraints public.crm_company_icps_require_primary immediate;
set constraints public.crm_company_icps_require_primary deferred;
insert into smoke_checks (label, ok)
select 'primary + secondary ICP and 3 products accepted',
       coalesce((select count(*) = 2 from public.crm_company_icps where company_id = 'c1000000-0000-4000-8000-000000000001')
                and (select count(*) = 3 from public.crm_company_products where company_id = 'c1000000-0000-4000-8000-000000000001'), false);

-- 2. A second primary is refused.
do $$
declare
  v_refused boolean := false;
begin
  begin
    update public.crm_company_icps set is_primary = true
     where company_id = 'c1000000-0000-4000-8000-000000000001'
       and icp_type_id = (select provider from ids);
  exception when unique_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('second primary ICP refused', v_refused);
end $$;

-- 3. ICPs with no primary are refused once checked.
do $$
declare
  v_refused boolean := false;
begin
  begin
    insert into public.crm_company_icps (workspace_id, company_id, icp_type_id, is_primary)
    select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'c1000000-0000-4000-8000-000000000002'::uuid, tpa, false from ids;
    set constraints public.crm_company_icps_require_primary immediate;
  exception when check_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('ICPs without a primary refused', v_refused);
end $$;
set constraints public.crm_company_icps_require_primary deferred;

-- 4. Swapping the primary inside one transaction is allowed.
do $$
declare
  v_ok boolean := true;
begin
  begin
    update public.crm_company_icps set is_primary = false
     where company_id = 'c1000000-0000-4000-8000-000000000001' and is_primary;
    update public.crm_company_icps set is_primary = true
     where company_id = 'c1000000-0000-4000-8000-000000000001'
       and icp_type_id = (select provider from ids);
    set constraints public.crm_company_icps_require_primary immediate;
  exception when others then
    v_ok := false;
  end;
  insert into smoke_checks (label, ok) values ('primary swap in one transaction allowed', v_ok);
end $$;
set constraints public.crm_company_icps_require_primary deferred;

-- 5. A vocabulary value in use cannot be deleted.
do $$
declare
  v_refused boolean := false;
begin
  begin
    delete from public.crm_products where id = (select rcm from ids);
  exception when foreign_key_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('product in use cannot be deleted', v_refused);
end $$;

-- 6. Disabling it keeps the tag; renaming relabels through the id.
update public.crm_products set is_active = false, short_name = 'Revenue Cycle'
 where id = (select rcm from ids);
insert into smoke_checks (label, ok)
select 'disabled + renamed product keeps its tag',
       coalesce((select p.short_name = 'Revenue Cycle'
                   from public.crm_company_products cp
                   join public.crm_products p on p.id = cp.product_id
                  where cp.company_id = 'c1000000-0000-4000-8000-000000000001'
                    and cp.product_id = (select rcm from ids)), false);

-- 7. An unused value can be deleted.
delete from public.crm_icp_types where id = (select tpa from ids);
insert into smoke_checks (label, ok)
select 'unused ICP type deletable',
       not exists (select 1 from public.crm_icp_types where id = (select tpa from ids));

-- 8. Another workspace's vocabulary cannot be attached.
do $$
declare
  v_refused boolean := false;
begin
  begin
    insert into public.crm_company_icps (workspace_id, company_id, icp_type_id, is_primary)
    select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'c1000000-0000-4000-8000-000000000002'::uuid, other_tpa, true from ids;
  exception when foreign_key_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('cross-workspace ICP refused', v_refused);
end $$;

-- ---------------------------------------------------------------------------
-- Sources
-- ---------------------------------------------------------------------------
insert into public.extraction_jobs (id) values ('e1000000-0000-4000-8000-000000000001');
insert into public.crm_company_sources (id, workspace_id, company_id, source_type, extraction_job_id,
                                        url, raw_payload, imported_by)
values ('51000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'c1000000-0000-4000-8000-000000000001', 'html_upload', 'e1000000-0000-4000-8000-000000000001',
        'https://www.linkedin.com/sales/company/1234', '{"company_name":"Acme"}',
        '22222222-2222-2222-2222-222222222222');

-- 9. Editing a source is refused.
do $$
declare
  v_refused boolean := false;
begin
  begin
    update public.crm_company_sources set raw_payload = '{"company_name":"Edited"}'
     where id = '51000000-0000-4000-8000-000000000001';
  exception when restrict_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('source edit refused', v_refused);
end $$;

-- 10. Deleting a source is refused.
do $$
declare
  v_refused boolean := false;
begin
  begin
    delete from public.crm_company_sources where id = '51000000-0000-4000-8000-000000000001';
  exception when restrict_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('source delete refused', v_refused);
end $$;

-- 11. Deleting the extraction job nulls the reference instead of failing.
delete from public.extraction_jobs where id = 'e1000000-0000-4000-8000-000000000001';
insert into smoke_checks (label, ok)
select 'job deletion nulls the source reference',
       coalesce((select extraction_job_id is null and raw_payload ->> 'company_name' = 'Acme'
                   from public.crm_company_sources where id = '51000000-0000-4000-8000-000000000001'), false);

-- 12. Deleting the importing user nulls imported_by instead of failing.
delete from auth.users where id = '22222222-2222-2222-2222-222222222222';
insert into smoke_checks (label, ok)
select 'user deletion nulls imported_by',
       coalesce((select imported_by is null
                   from public.crm_company_sources where id = '51000000-0000-4000-8000-000000000001'), false);

-- 13. A non-object payload is refused.
do $$
declare
  v_refused boolean := false;
begin
  begin
    insert into public.crm_company_sources (workspace_id, company_id, source_type, raw_payload)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-000000000001',
            'spreadsheet_row', '["not", "an", "object"]');
  exception when check_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('non-object payload refused', v_refused);
end $$;

-- 14. Deleting the workspace removes everything, sources included.
delete from public.workspaces where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into smoke_checks (label, ok)
select 'workspace deletion cascades through tags and sources',
       not exists (select 1 from public.crm_company_sources where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
       and not exists (select 1 from public.crm_company_icps where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

-- ---------------------------------------------------------------------------
-- The gate
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 14;
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
