-- Smoke test for 0153 — tag groups behave as chip rows should, the old lead
-- tags keep their rules, and nothing crosses entities or tenants.
--
-- Run with:
--   scripts/check-migration.sh supabase/migrations/0153_crm_tag_groups.sql \
--     supabase/migrations/smoke/0153_crm_tag_groups.smoke.sql

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
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'setter');

-- Groups: Industry (with a primary), Region, and a LEAD group.
insert into public.crm_tag_groups (id, workspace_id, entity, name, slug, has_primary, sort_order) values
  ('91000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'company', 'Industry', 'industry', true, 10),
  ('91000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'company', 'Region', 'region', false, 20),
  ('91000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'contact', 'Seniority', 'seniority', false, 10),
  ('91000000-0000-4000-8000-000000000009', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'company', 'Industry', 'industry', false, 10);

insert into public.crm_tags (id, workspace_id, entity, group_id, name, normalized_name, slug) values
  ('92000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'company', '91000000-0000-4000-8000-000000000001', 'SaaS', 'saas', 'saas'),
  ('92000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'company', '91000000-0000-4000-8000-000000000001', 'Fintech', 'fintech', 'fintech'),
  ('92000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'company', '91000000-0000-4000-8000-000000000002', 'EMEA', 'emea', 'emea'),
  ('92000000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'company', '91000000-0000-4000-8000-000000000002', 'NA', 'na', 'na'),
  ('92000000-0000-4000-8000-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'contact', '91000000-0000-4000-8000-000000000003', 'C-level', 'c-level', 'c-level'),
  ('92000000-0000-4000-8000-000000000009', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'company', '91000000-0000-4000-8000-000000000009', 'SaaS', 'saas', 'saas');

insert into public.crm_companies (id, workspace_id, name, normalized_name, owner_user_id) values
  ('c1000000-0000-4000-8000-00000000000a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Acme', 'acme', '22222222-2222-2222-2222-222222222222'),
  ('c1000000-0000-4000-8000-00000000000b', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Beta', 'beta', null),
  ('c1000000-0000-4000-8000-00000000000c', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Gamma', 'gamma', null);
insert into public.crm_contacts (id, workspace_id, full_name)
values ('d1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Pat');

-- ---------------------------------------------------------------------------
-- Values and entities
-- ---------------------------------------------------------------------------

-- 1. The same name may live in two groups; never twice in one.
insert into public.crm_tags (workspace_id, entity, group_id, name, normalized_name, slug)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'company', '91000000-0000-4000-8000-000000000002', 'SaaS', 'saas', 'saas');
do $$
declare
  v_refused boolean := false;
begin
  begin
    insert into public.crm_tags (workspace_id, entity, group_id, name, normalized_name, slug)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'company', '91000000-0000-4000-8000-000000000001', 'saas', 'saas', 'saas-2');
  exception when unique_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('same name in two groups ok; twice in one refused', v_refused);
end $$;

-- 2. The OLD lead-tag rule still holds: one free lead tag per name per workspace.
insert into public.crm_tags (workspace_id, name, normalized_name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Hot Lead', 'hot lead');
do $$
declare
  v_refused boolean := false;
begin
  begin
    insert into public.crm_tags (workspace_id, name, normalized_name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'hot lead', 'hot lead');
  exception when unique_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('free lead tags still unique by name', v_refused);
end $$;

-- 3. An account tag must have a group; a free lead tag needs none.
do $$
declare
  v_refused boolean := false;
begin
  begin
    insert into public.crm_tags (workspace_id, entity, name, normalized_name)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'company', 'Loose', 'loose');
  exception when check_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('ungrouped account tag refused', v_refused);
end $$;

-- 4. A lead group cannot hold an account tag (entity travels in the FK).
do $$
declare
  v_refused boolean := false;
begin
  begin
    insert into public.crm_tags (workspace_id, entity, group_id, name, normalized_name, slug)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'company', '91000000-0000-4000-8000-000000000003', 'X', 'x', 'x');
  exception when foreign_key_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('account tag in a lead group refused', v_refused);
end $$;

-- 5. An account tag cannot be put on a lead.
do $$
declare
  v_refused boolean := false;
begin
  begin
    insert into public.crm_contact_tags (workspace_id, contact_id, tag_id)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd1000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001');
  exception when check_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('account tag on a lead refused', v_refused);
end $$;

-- 6. A lead tag cannot be put on an account.
do $$
declare
  v_refused boolean := false;
begin
  begin
    insert into public.crm_company_tags (workspace_id, company_id, tag_id, group_id)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-00000000000a',
            '92000000-0000-4000-8000-000000000005', '91000000-0000-4000-8000-000000000003');
  exception when foreign_key_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('lead tag on an account refused', v_refused);
end $$;

-- ---------------------------------------------------------------------------
-- The writer
-- ---------------------------------------------------------------------------

-- 7. Replace: SaaS primary + Fintech; Acme also EMEA.
select public.crm_set_company_tags('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-00000000000a',
         '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001',
         array['92000000-0000-4000-8000-000000000002']::uuid[], '11111111-1111-1111-1111-111111111111');
select public.crm_set_company_tags('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-00000000000a',
         '91000000-0000-4000-8000-000000000002', null,
         array['92000000-0000-4000-8000-000000000003']::uuid[], '11111111-1111-1111-1111-111111111111');
select public.crm_set_company_tags('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-00000000000b',
         '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '{}', null);
set constraints public.crm_company_tags_require_primary immediate;
set constraints public.crm_company_tags_require_primary deferred;
insert into smoke_checks (label, ok)
select 'values written per group, primary only where the group has one',
       coalesce((select string_agg(t.slug || ':' || ct.is_primary::text, ',' order by t.slug)
                   from public.crm_company_tags ct join public.crm_tags t on t.id = ct.tag_id
                  where ct.company_id = 'c1000000-0000-4000-8000-00000000000a')
                = 'emea:false,fintech:false,saas:true', false)
       and coalesce((select count(*) = 3 from public.crm_activities
                      where company_id in ('c1000000-0000-4000-8000-00000000000a', 'c1000000-0000-4000-8000-00000000000b')
                        and activity_type = 'ACCOUNT_TAGS_CHANGED'), false);

-- 8. A value from another group (or workspace) is refused.
do $$
declare
  v_refused integer := 0;
begin
  begin
    perform public.crm_set_company_tags('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-00000000000c',
              '91000000-0000-4000-8000-000000000001', null, array['92000000-0000-4000-8000-000000000003']::uuid[], null);
  exception when check_violation then v_refused := v_refused + 1;
  end;
  begin
    perform public.crm_set_company_tags('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-00000000000c',
              '91000000-0000-4000-8000-000000000009', null, array['92000000-0000-4000-8000-000000000009']::uuid[], null);
  exception when check_violation then v_refused := v_refused + 1;
  end;
  insert into smoke_checks (label, ok) values ('another group''s or workspace''s value refused', v_refused = 2);
end $$;

-- 9. Merge adds and keeps the primary; a disabled value cannot be newly added.
update public.crm_tags set is_active = false where id = '92000000-0000-4000-8000-000000000004';
select public.crm_set_company_tags('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-00000000000a',
         '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000002', '{}', null, true, 'import');
do $$
declare
  v_refused boolean := false;
begin
  begin
    perform public.crm_set_company_tags('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-00000000000a',
              '91000000-0000-4000-8000-000000000002', null, array['92000000-0000-4000-8000-000000000004']::uuid[], null, true);
  exception when check_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok)
  values ('merge keeps the primary; disabled value refused',
          v_refused and coalesce((select t.slug = 'saas' from public.crm_company_tags ct join public.crm_tags t on t.id = ct.tag_id
                                   where ct.company_id = 'c1000000-0000-4000-8000-00000000000a' and ct.is_primary), false));
end $$;

-- 10. A value an account holds cannot be deleted; a group with values cannot either.
do $$
declare
  v_refused integer := 0;
begin
  begin
    delete from public.crm_tags where id = '92000000-0000-4000-8000-000000000001';
  exception when foreign_key_violation then v_refused := v_refused + 1;
  end;
  begin
    delete from public.crm_tag_groups where id = '91000000-0000-4000-8000-000000000002';
  exception when foreign_key_violation then v_refused := v_refused + 1;
  end;
  insert into smoke_checks (label, ok) values ('in-use value and non-empty group cannot be deleted', v_refused = 2);
end $$;

-- ---------------------------------------------------------------------------
-- List and chip counts (Acme: SaaS*, Fintech, EMEA · Beta: SaaS* · Gamma: none)
-- ---------------------------------------------------------------------------

create or replace function pg_temp.names(p_viewer uuid, p_view_all boolean, p_filters jsonb)
returns text language sql as $$
  select coalesce(string_agg(name, ',' order by name), '')
    from public.crm_list_accounts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', p_viewer, p_view_all, p_filters, 'name', false, 100, 0)
$$;

-- 11. AND between groups.
insert into smoke_checks (label, ok)
select 'tags filter ANDs across groups',
       pg_temp.names('11111111-1111-1111-1111-111111111111', true, '{"tags":["92000000-0000-4000-8000-000000000001"]}') = 'Acme,Beta'
       and pg_temp.names('11111111-1111-1111-1111-111111111111', true,
             '{"tags":["92000000-0000-4000-8000-000000000001","92000000-0000-4000-8000-000000000003"]}') = 'Acme';

-- 12. An unknown or other-workspace id filters to nothing — never widens.
insert into smoke_checks (label, ok)
select 'unknown or foreign tag id matches nothing',
       pg_temp.names('11111111-1111-1111-1111-111111111111', true, '{"tags":["no-match"]}') = ''
       and pg_temp.names('11111111-1111-1111-1111-111111111111', true, '{"tags":["92000000-0000-4000-8000-000000000009"]}') = '';

-- 13. Visibility still applies.
insert into smoke_checks (label, ok)
select 'no view_all → only assigned',
       pg_temp.names('22222222-2222-2222-2222-222222222222', false, '{}') = 'Acme';

-- 14. Each row carries its tags with group and primary.
insert into smoke_checks (label, ok)
select 'row carries tags with group and primary',
       coalesce((select jsonb_array_length(tags) = 3 and (tags -> 0 ->> 'primary')::boolean
                   from public.crm_list_accounts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                          '11111111-1111-1111-1111-111111111111', true, '{}', 'name', false, 1, 0)), false);

-- 15–16. Chip counts: each group ignores its own filter; totals are separate rows.
create temp table f as
select * from public.crm_account_facets('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
         '11111111-1111-1111-1111-111111111111', true,
         '{"tags":["92000000-0000-4000-8000-000000000003"]}');
insert into smoke_checks (label, ok)
select 'Industry chips counted under the Region filter only',
       coalesce((select account_count = 1 from f where tag_id = '92000000-0000-4000-8000-000000000001'), false)
       and coalesce((select account_count = 1 from f
                      where group_id = '91000000-0000-4000-8000-000000000001' and tag_id is null), false);
insert into smoke_checks (label, ok)
select 'Region chips ignore their own filter; an untagged account is not a value',
       coalesce((select account_count = 1 from f where tag_id = '92000000-0000-4000-8000-000000000003'), false)
       and coalesce((select account_count = 3 from f
                      where group_id = '91000000-0000-4000-8000-000000000002' and tag_id is null), false)
       and not exists (select 1 from f where group_id = '91000000-0000-4000-8000-000000000003');

-- 17. Clients cannot call any of it.
insert into smoke_checks (label, ok)
select 'service-role only',
       not has_function_privilege('authenticated', 'public.crm_set_company_tags(uuid,uuid,uuid,uuid,uuid[],uuid,boolean,text)', 'execute')
       and not has_function_privilege('authenticated', 'public.crm_list_accounts(uuid,uuid,boolean,jsonb,text,boolean,integer,integer)', 'execute')
       and not has_function_privilege('authenticated', 'public.crm_account_facets(uuid,uuid,boolean,jsonb)', 'execute');

-- ---------------------------------------------------------------------------
-- The gate
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 17;
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
