-- Smoke test for 0150 — does the list select exactly the right accounts, do the
-- chip counts agree with it, and can a non-view_all member see only their own?
--
-- Fixture (workspace W):
--   Acme   ICP Hospital (primary) + Provider Group   products RCM, FHIR   assigned Sam    priority high
--   Beta   ICP TPA (primary) + Hospital               product  PBM        assigned Owner  priority low
--   Gamma  ICP TPA (primary)                          product  PBM        unassigned
--   Other  in a different workspace, tagged Hospital — must never appear.
--
-- Run with:
--   scripts/check-migration.sh supabase/migrations/0150_crm_account_queries.sql \
--     supabase/migrations/smoke/0150_crm_account_queries.smoke.sql

\set ON_ERROR_STOP on

begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'sam@example.com');

insert into public.workspaces (id, name, owner_user_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'W', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Other', '11111111-1111-1111-1111-111111111111');
insert into public.workspace_memberships (workspace_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'setter'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'owner');

insert into public.crm_companies (id, workspace_id, name, normalized_name, owner_user_id, priority, headquarters) values
  ('c1000000-0000-4000-8000-00000000000a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Acme Health', 'acme health',
   '22222222-2222-2222-2222-222222222222', 'high', 'Columbus, OH'),
  ('c1000000-0000-4000-8000-00000000000b', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Beta Benefits', 'beta benefits',
   '11111111-1111-1111-1111-111111111111', 'low', null),
  ('c1000000-0000-4000-8000-00000000000c', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Gamma Admin', 'gamma admin',
   null, null, null),
  ('c1000000-0000-4000-8000-00000000000d', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Other Hospital', 'other hospital',
   null, null, null);

create temp table v as
select
  (select id from public.crm_icp_types where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and slug = 'hospital-health-system') as hospital,
  (select id from public.crm_icp_types where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and slug = 'provider-group') as provider,
  (select id from public.crm_icp_types where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and slug = 'tpa') as tpa,
  (select id from public.crm_icp_types where workspace_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and slug = 'hospital-health-system') as other_hospital,
  (select id from public.crm_products where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and slug = 'rcm') as rcm,
  (select id from public.crm_products where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and slug = 'fhir-gateway') as fhir,
  (select id from public.crm_products where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and slug = 'pbm') as pbm;

insert into public.crm_company_icps (workspace_id, company_id, icp_type_id, is_primary)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, c, i, p from v,
  lateral (values
    ('c1000000-0000-4000-8000-00000000000a'::uuid, v.hospital, true),
    ('c1000000-0000-4000-8000-00000000000a'::uuid, v.provider, false),
    ('c1000000-0000-4000-8000-00000000000b'::uuid, v.tpa,      true),
    ('c1000000-0000-4000-8000-00000000000b'::uuid, v.hospital, false),
    ('c1000000-0000-4000-8000-00000000000c'::uuid, v.tpa,      true)
  ) as x(c, i, p);
insert into public.crm_company_icps (workspace_id, company_id, icp_type_id, is_primary)
select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, 'c1000000-0000-4000-8000-00000000000d'::uuid, other_hospital, true from v;

insert into public.crm_company_products (workspace_id, company_id, product_id)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, c, p from v,
  lateral (values
    ('c1000000-0000-4000-8000-00000000000a'::uuid, v.rcm),
    ('c1000000-0000-4000-8000-00000000000a'::uuid, v.fhir),
    ('c1000000-0000-4000-8000-00000000000b'::uuid, v.pbm),
    ('c1000000-0000-4000-8000-00000000000c'::uuid, v.pbm)
  ) as x(c, p);

insert into public.crm_contacts (workspace_id, full_name, primary_company_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Lead One', 'c1000000-0000-4000-8000-00000000000a'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Lead Two', 'c1000000-0000-4000-8000-00000000000a');

-- Helper: the names a filter selects, sorted, as one string.
create or replace function pg_temp.names(p_viewer uuid, p_view_all boolean, p_filters jsonb)
returns text language sql as $$
  select coalesce(string_agg(name, ',' order by name), '')
    from public.crm_list_accounts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', p_viewer, p_view_all, p_filters, 'name', false, 100, 0)
$$;

-- 1. The owner with view_all sees the three, not the other workspace's.
insert into smoke_checks (label, ok)
select 'view_all lists exactly this workspace',
       pg_temp.names('11111111-1111-1111-1111-111111111111', true, '{}') = 'Acme Health,Beta Benefits,Gamma Admin';

-- 2. Without view_all, Sam sees only what is assigned to Sam — even asking for scope=all.
insert into smoke_checks (label, ok)
select 'no view_all → only assigned, whatever scope says',
       pg_temp.names('22222222-2222-2222-2222-222222222222', false, '{"scope":"all"}') = 'Acme Health';

-- 3. My Accounts for a view_all member.
insert into smoke_checks (label, ok)
select 'scope=mine narrows a view_all member to their own',
       pg_temp.names('11111111-1111-1111-1111-111111111111', true, '{"scope":"mine"}') = 'Beta Benefits';

-- 4. ICP matches primary OR secondary.
insert into smoke_checks (label, ok)
select 'ICP Hospital matches primary and secondary',
       pg_temp.names('11111111-1111-1111-1111-111111111111', true,
                     jsonb_build_object('icp', (select hospital from v))) = 'Acme Health,Beta Benefits';

-- 5. AND between groups.
insert into smoke_checks (label, ok)
select 'Hospital AND RCM selects only accounts with both',
       pg_temp.names('11111111-1111-1111-1111-111111111111', true,
                     jsonb_build_object('icp', (select hospital from v), 'product', (select rcm from v))) = 'Acme Health';

-- 6–7. Assignee and unassigned.
insert into smoke_checks (label, ok)
select 'assignee filter', pg_temp.names('11111111-1111-1111-1111-111111111111', true,
                                       '{"assignee":"22222222-2222-2222-2222-222222222222"}') = 'Acme Health';
insert into smoke_checks (label, ok)
select 'unassigned filter', pg_temp.names('11111111-1111-1111-1111-111111111111', true,
                                         '{"assignee":"unassigned"}') = 'Gamma Admin';

-- 8. Status: Gamma (no owner) is New; Acme and Beta were Assigned on insert.
insert into smoke_checks (label, ok)
select 'status filter',
       pg_temp.names('11111111-1111-1111-1111-111111111111', true,
                     jsonb_build_object('status', (select id from public.crm_account_statuses
                                                    where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
                                                      and system_key = 'new'))) = 'Gamma Admin';

-- 9–10. Priority, and search over location.
insert into smoke_checks (label, ok)
select 'priority filter', pg_temp.names('11111111-1111-1111-1111-111111111111', true, '{"priority":"low"}') = 'Beta Benefits';
insert into smoke_checks (label, ok)
select 'search reaches location', pg_temp.names('11111111-1111-1111-1111-111111111111', true, '{"q":"columbus"}') = 'Acme Health';

-- 11. A malformed id from a bookmarked URL matches nothing and does not raise.
insert into smoke_checks (label, ok)
select 'malformed id matches nothing, no error',
       pg_temp.names('11111111-1111-1111-1111-111111111111', true, '{"icp":"not-a-uuid"}') = '';

-- 12. Each row carries what it renders: primary ICP first, products, assignees, leads.
insert into smoke_checks (label, ok)
select 'row carries tags, assignees and lead count',
       coalesce((select (icps -> 0 ->> 'primary')::boolean
                        and (icps -> 0 ->> 'id')::uuid = (select hospital from v)
                        and cardinality(product_ids) = 2
                        and assignee_ids = array['22222222-2222-2222-2222-222222222222'::uuid]
                        and lead_count = 2
                        and total_count = 3
                   from public.crm_list_accounts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                          '11111111-1111-1111-1111-111111111111', true, '{}', 'name', false, 1, 0)), false);

-- 13. Sorting and paging: priority desc puts High first; page 2 of size 1 is the next one.
insert into smoke_checks (label, ok)
select 'priority sort and paging',
       coalesce((select name = 'Acme Health' from public.crm_list_accounts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                   '11111111-1111-1111-1111-111111111111', true, '{}', 'priority', true, 1, 0)), false)
       and coalesce((select name = 'Beta Benefits' from public.crm_list_accounts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                   '11111111-1111-1111-1111-111111111111', true, '{}', 'priority', true, 1, 1)), false);

-- 14–16. Chip counts ignore their own group but honour the others.
create temp table f as
select * from public.crm_account_facets('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
         '11111111-1111-1111-1111-111111111111', true,
         jsonb_build_object('icp', (select hospital from v), 'product', (select rcm from v)));

insert into smoke_checks (label, ok)
select 'ICP chips count under the product filter only',
       coalesce((select account_count = 1 from f where facet = 'icp' and value_id = (select hospital from v)), false)
       and coalesce((select account_count = 1 from f where facet = 'icp' and value_id = (select provider from v)), false)
       and not exists (select 1 from f where facet = 'icp' and value_id = (select tpa from v))
       and coalesce((select account_count = 1 from f where facet = 'icp_total'), false);
insert into smoke_checks (label, ok)
select 'product chips count under the ICP filter only',
       coalesce((select account_count = 1 from f where facet = 'product' and value_id = (select rcm from v)), false)
       and coalesce((select account_count = 1 from f where facet = 'product' and value_id = (select pbm from v)), false)
       and coalesce((select account_count = 2 from f where facet = 'product_total'), false);
insert into smoke_checks (label, ok)
select 'chip counts respect visibility',
       coalesce((select sum(account_count) = 1
                   from public.crm_account_facets('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                          '22222222-2222-2222-2222-222222222222', false, '{}')
                  where facet = 'icp_total'), false);

-- ---------------------------------------------------------------------------
-- 17–24. Tag writes (Gamma: TPA primary, product PBM).
-- ---------------------------------------------------------------------------

-- 17. Replace: primary Hospital, secondary Provider; TPA removed. Checked immediately.
select public.crm_set_company_icps('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-00000000000c',
         (select hospital from v), array[(select provider from v)], '11111111-1111-1111-1111-111111111111');
set constraints public.crm_company_icps_require_primary immediate;
set constraints public.crm_company_icps_require_primary deferred;
insert into smoke_checks (label, ok)
select 'replace sets primary + secondary and removes the rest',
       coalesce((select bool_and(case icp_type_id when (select hospital from v) then is_primary
                                                 when (select provider from v) then not is_primary
                                                 else false end) and count(*) = 2
                   from public.crm_company_icps where company_id = 'c1000000-0000-4000-8000-00000000000c'), false);

-- 18. Swapping the primary in the same set works and is one activity.
select public.crm_set_company_icps('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-00000000000c',
         (select provider from v), array[(select hospital from v)], '11111111-1111-1111-1111-111111111111');
set constraints public.crm_company_icps_require_primary immediate;
set constraints public.crm_company_icps_require_primary deferred;
insert into smoke_checks (label, ok)
select 'primary swap',
       coalesce((select is_primary from public.crm_company_icps
                  where company_id = 'c1000000-0000-4000-8000-00000000000c' and icp_type_id = (select provider from v)), false)
       and coalesce((select count(*) = 2 from public.crm_activities
                      where company_id = 'c1000000-0000-4000-8000-00000000000c'
                        and activity_type = 'ACCOUNT_TAGS_CHANGED'
                        and actor_user_id = '11111111-1111-1111-1111-111111111111'), false);

-- 19. Saving the same set again writes nothing.
insert into smoke_checks (label, ok)
select 'no-op edit writes no activity',
       coalesce((public.crm_set_company_icps('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-00000000000c',
                   (select provider from v), array[(select hospital from v)], null) ->> 'changed')::boolean = false, false)
       and coalesce((select count(*) = 2 from public.crm_activities
                      where company_id = 'c1000000-0000-4000-8000-00000000000c'
                        and activity_type = 'ACCOUNT_TAGS_CHANGED'), false);

-- 20. Merge (import): adds TPA, removes nothing, keeps the existing primary.
select public.crm_set_company_icps('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-00000000000c',
         (select tpa from v), '{}', null, true);
set constraints public.crm_company_icps_require_primary immediate;
set constraints public.crm_company_icps_require_primary deferred;
insert into smoke_checks (label, ok)
select 'merge adds, never removes, keeps the primary',
       coalesce((select count(*) = 3 from public.crm_company_icps where company_id = 'c1000000-0000-4000-8000-00000000000c'), false)
       and coalesce((select icp_type_id = (select provider from v) from public.crm_company_icps
                      where company_id = 'c1000000-0000-4000-8000-00000000000c' and is_primary), false);

-- 21. A disabled value cannot be newly added — but stays where it already is.
update public.crm_products set is_active = false where id = (select rcm from v);
do $$
declare
  v_refused boolean := false;
begin
  begin
    perform public.crm_set_company_products('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-00000000000c',
              array[(select pbm from v), (select rcm from v)], null);
  exception when check_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok)
  values ('disabled product cannot be added',
          v_refused and exists (select 1 from public.crm_company_products
                                 where company_id = 'c1000000-0000-4000-8000-00000000000a'
                                   and product_id = (select rcm from v)));
end $$;

-- 22. Another workspace's value is refused.
do $$
declare
  v_refused boolean := false;
begin
  begin
    perform public.crm_set_company_icps('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-00000000000c',
              (select other_hospital from v), '{}', null);
  exception when check_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('cross-workspace ICP refused', v_refused);
end $$;

-- 23. Products replace, including to nothing.
select public.crm_set_company_products('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-00000000000c',
         array[(select fhir from v)], null);
select public.crm_set_company_products('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-00000000000b',
         '{}', null);
insert into smoke_checks (label, ok)
select 'products replace and clear',
       coalesce((select array_agg(product_id) = array[(select fhir from v)] from public.crm_company_products
                  where company_id = 'c1000000-0000-4000-8000-00000000000c'), false)
       and not exists (select 1 from public.crm_company_products where company_id = 'c1000000-0000-4000-8000-00000000000b');

-- 24. An account in another workspace cannot be written through this one.
do $$
declare
  v_refused boolean := false;
begin
  begin
    perform public.crm_set_company_products('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-00000000000d',
              array[(select fhir from v)], null);
  exception when no_data_found then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('other workspace''s account refused', v_refused);
end $$;

-- 25. Status: changes with one activity; a no-op writes nothing; a disabled one is refused.
update public.crm_account_statuses set is_active = false
 where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and slug = 'not-relevant';
select public.crm_set_company_status('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-00000000000c',
         (select id from public.crm_account_statuses where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and slug = 'meeting'),
         '11111111-1111-1111-1111-111111111111');
select public.crm_set_company_status('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-00000000000c',
         (select id from public.crm_account_statuses where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and slug = 'meeting'),
         '11111111-1111-1111-1111-111111111111');
do $$
declare
  v_refused boolean := false;
begin
  begin
    perform public.crm_set_company_status('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-00000000000c',
              (select id from public.crm_account_statuses where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and slug = 'not-relevant'),
              null);
  exception when check_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok)
  select 'status change writes one activity; no-op and disabled write none',
         v_refused
         and coalesce((select count(*) = 1 from public.crm_activities
                        where company_id = 'c1000000-0000-4000-8000-00000000000c'
                          and activity_type = 'ACCOUNT_STATUS_CHANGED'), false)
         and coalesce((select s.slug = 'meeting' from public.crm_companies co
                         join public.crm_account_statuses s on s.id = co.status_id
                        where co.id = 'c1000000-0000-4000-8000-00000000000c'), false);
end $$;

-- 26. Clients cannot call them.
insert into smoke_checks (label, ok)
select 'service-role only',
       not has_function_privilege('authenticated', 'public.crm_list_accounts(uuid,uuid,boolean,jsonb,text,boolean,integer,integer)', 'execute')
       and not has_function_privilege('authenticated', 'public.crm_account_facets(uuid,uuid,boolean,jsonb)', 'execute')
       and not has_function_privilege('anon', 'public.crm_account_matches(uuid,uuid,boolean,jsonb,text)', 'execute')
       and not has_function_privilege('authenticated', 'public.crm_set_company_icps(uuid,uuid,uuid,uuid[],uuid,boolean)', 'execute')
       and not has_function_privilege('authenticated', 'public.crm_set_company_products(uuid,uuid,uuid[],uuid,boolean)', 'execute')
       and not has_function_privilege('authenticated', 'public.crm_set_company_status(uuid,uuid,uuid,uuid)', 'execute');

-- ---------------------------------------------------------------------------
-- The gate
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 26;
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
