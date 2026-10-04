-- Smoke test for 0154 — a lead's other links, "add one role", the atomic tag
-- delete, and the disabled-group refusal.
--
-- Run with:
--   scripts/check-migration.sh supabase/migrations/0154_crm_decision_makers.sql \
--     supabase/migrations/smoke/0154_crm_decision_makers.smoke.sql

\set ON_ERROR_STOP on

begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'owner@example.com');
insert into public.workspaces (id, name, owner_user_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'W', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Other', '11111111-1111-1111-1111-111111111111');

insert into public.crm_contacts (id, workspace_id, full_name, job_title) values
  ('d1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Pat', 'CIO'),
  ('d1000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Sam', 'Intern'),
  ('d1000000-0000-4000-8000-000000000009', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Elsewhere', 'CFO');

insert into public.crm_companies (id, workspace_id, name, normalized_name) values
  ('c1000000-0000-4000-8000-00000000000a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Acme', 'acme');

insert into public.crm_tag_groups (id, workspace_id, entity, name, slug, has_primary, sort_order, is_active) values
  ('91000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'company', 'Industry', 'industry', false, 10, true),
  ('91000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'company', 'Legacy', 'legacy', false, 20, true),
  ('91000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'contact', 'Seniority', 'seniority', false, 10, true);

insert into public.crm_tags (id, workspace_id, entity, group_id, name, normalized_name, slug) values
  ('92000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'company', '91000000-0000-4000-8000-000000000001', 'SaaS', 'saas', 'saas'),
  ('92000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'company', '91000000-0000-4000-8000-000000000001', 'Unused', 'unused', 'unused'),
  ('92000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'company', '91000000-0000-4000-8000-000000000002', 'Old', 'old', 'old'),
  ('92000000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'company', '91000000-0000-4000-8000-000000000002', 'Older', 'older', 'older'),
  ('92000000-0000-4000-8000-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'contact', '91000000-0000-4000-8000-000000000003', 'C-level', 'c-level', 'c-level');

create or replace function pg_temp.refused(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when check_violation or no_data_found or foreign_key_violation then
  return true;
end;
$$;

create or replace function pg_temp.link(p_kind text, p_label text, p_url text, p_key text) returns jsonb language sql as $$
  select jsonb_build_object('kind', p_kind, 'label', p_label, 'url', p_url, 'url_key', p_key)
$$;

-- ---------------------------------------------------------------------------
-- 1. Links
-- ---------------------------------------------------------------------------

-- 1. Two links land; the same address again is skipped, not an error.
-- (Separate statements: a read in the same SELECT sees the statement-start snapshot.)
create temp table t1 as
select public.crm_add_contact_links('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd1000000-0000-4000-8000-000000000001',
         jsonb_build_array(pg_temp.link('github', null, 'https://github.com/pat', 'github.com/pat'),
                           pg_temp.link('github', null, 'https://www.github.com/pat/', 'github.com/pat'),
                           pg_temp.link('other', 'Blog', 'https://pat.example.com/', 'pat.example.com')),
         '11111111-1111-1111-1111-111111111111') as first_add;
create temp table t2 as
select public.crm_add_contact_links('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd1000000-0000-4000-8000-000000000001',
         jsonb_build_array(pg_temp.link('github', null, 'https://github.com/pat', 'github.com/pat')),
         '11111111-1111-1111-1111-111111111111') as repeat_add;
insert into smoke_checks (label, ok)
select 'links added, a repeat skipped',
       (select first_add from t1) = 2
   and (select repeat_add from t2) = 0
   and (select count(*) from public.crm_contact_links where contact_id = 'd1000000-0000-4000-8000-000000000001') = 2;

-- 2. A `javascript:` address never becomes a stored href.
insert into smoke_checks (label, ok)
select 'a non-http scheme is refused by the table',
       pg_temp.refused($q$ select public.crm_add_contact_links('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
         'd1000000-0000-4000-8000-000000000002',
         jsonb_build_array(pg_temp.link('website', null, 'javascript:alert(1)', 'javascript:alert(1)')), null) $q$);

-- 3. LinkedIn has its own columns; it is refused here.
insert into smoke_checks (label, ok)
select 'a LinkedIn address is refused as an "other" link',
       pg_temp.refused($q$ select public.crm_add_contact_links('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
         'd1000000-0000-4000-8000-000000000002',
         jsonb_build_array(pg_temp.link('website', null, 'https://www.linkedin.com/in/pat', 'linkedin.com/in/pat')), null) $q$);

-- 4. "Other" needs a label.
insert into smoke_checks (label, ok)
select 'an unlabelled "other" link is refused',
       pg_temp.refused($q$ select public.crm_add_contact_links('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
         'd1000000-0000-4000-8000-000000000002',
         jsonb_build_array(pg_temp.link('other', ' ', 'https://pat.example.org', 'pat.example.org')), null) $q$);

-- 5. At most 20 per lead.
select public.crm_add_contact_links('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd1000000-0000-4000-8000-000000000002',
  (select jsonb_agg(pg_temp.link('website', null, 'https://s' || g || '.example.com', 's' || g || '.example.com'))
     from generate_series(1, 20) g), null);
insert into smoke_checks (label, ok)
select 'the 21st link is refused',
       (select count(*) from public.crm_contact_links where contact_id = 'd1000000-0000-4000-8000-000000000002') = 20
   and pg_temp.refused($q$ select public.crm_add_contact_links('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
         'd1000000-0000-4000-8000-000000000002',
         jsonb_build_array(pg_temp.link('website', null, 'https://s21.example.com', 's21.example.com')), null) $q$);

-- 6. Another workspace's lead is not reachable.
insert into smoke_checks (label, ok)
select 'links: another workspace''s lead is refused',
       pg_temp.refused($q$ select public.crm_add_contact_links('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
         'd1000000-0000-4000-8000-000000000009',
         jsonb_build_array(pg_temp.link('github', null, 'https://github.com/x', 'github.com/x')), null) $q$);

-- 7a. A merge moves the loser's links to the survivor; one both had is kept once.
insert into public.crm_contacts (id, workspace_id, full_name) values
  ('d1000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Pat (dupe)');
select public.crm_add_contact_links('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd1000000-0000-4000-8000-000000000003',
  jsonb_build_array(pg_temp.link('github', null, 'https://github.com/pat', 'github.com/pat'),
                    pg_temp.link('x', null, 'https://x.com/pat', 'x.com/pat')), null);
select public.crm_merge_contacts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000003', null);
insert into smoke_checks (label, ok)
select 'a merge moves links to the survivor, de-duplicated',
       (select count(*) from public.crm_contact_links where contact_id = 'd1000000-0000-4000-8000-000000000003') = 0
   and (select string_agg(url_key, ',' order by url_key) from public.crm_contact_links
         where contact_id = 'd1000000-0000-4000-8000-000000000001') = 'github.com/pat,pat.example.com,x.com/pat';

-- ---------------------------------------------------------------------------
-- 2. Add one role
-- ---------------------------------------------------------------------------

create temp table r as
select
  (select id from public.crm_lead_roles where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and system_key = 'decision_maker') as dm,
  (select id from public.crm_lead_roles where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and system_key = 'technical') as tech,
  (select id from public.crm_lead_roles where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and system_key = 'other') as other;

create or replace function pg_temp.roles(p_contact uuid) returns text language sql as $$
  select coalesce(string_agg(lr.system_key || ':' || a.is_auto::text, ',' order by lr.system_key), '')
    from public.crm_contact_role_assignments a
    join public.crm_lead_roles lr on lr.id = a.role_id
   where a.contact_id = p_contact
$$;

select public.crm_apply_auto_roles('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', jsonb_build_array(
  jsonb_build_object('contact_id', 'd1000000-0000-4000-8000-000000000001', 'title', 'CIO', 'role_ids', jsonb_build_array((select tech from r))),
  jsonb_build_object('contact_id', 'd1000000-0000-4000-8000-000000000002', 'title', 'Intern', 'role_ids', jsonb_build_array((select other from r)))
));

-- 7. Adding Decision Maker keeps the other roles, as a person's choice, and pins the lead.
select public.crm_add_contact_role('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd1000000-0000-4000-8000-000000000001',
  'decision_maker', '11111111-1111-1111-1111-111111111111');
insert into smoke_checks (label, ok)
select 'decision maker added beside the existing role, lead pinned',
       pg_temp.roles('d1000000-0000-4000-8000-000000000001') = 'decision_maker:false,technical:false'
   and (select manual_at is not null from public.crm_contact_role_state
         where contact_id = 'd1000000-0000-4000-8000-000000000001');

-- 8. "Other" means none of the above — it goes.
select public.crm_add_contact_role('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd1000000-0000-4000-8000-000000000002',
  'decision_maker', null);
insert into smoke_checks (label, ok)
select '"other" is dropped when a real role is added',
       pg_temp.roles('d1000000-0000-4000-8000-000000000002') = 'decision_maker:false';

-- 9. A pinned lead stays pinned: suggestions do not touch it.
select public.crm_apply_auto_roles('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', jsonb_build_array(
  jsonb_build_object('contact_id', 'd1000000-0000-4000-8000-000000000002', 'title', 'Intern', 'role_ids', jsonb_build_array((select other from r)))
));
insert into smoke_checks (label, ok)
select 'suggestions leave the decision maker alone',
       pg_temp.roles('d1000000-0000-4000-8000-000000000002') = 'decision_maker:false';

-- 10. A disabled role, and another workspace's lead, are refused.
update public.crm_lead_roles set is_active = false where id = (select tech from r);
insert into smoke_checks (label, ok)
select 'role: disabled role and foreign lead refused',
       pg_temp.refused($q$ select public.crm_add_contact_role('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
         'd1000000-0000-4000-8000-000000000002', 'technical', null) $q$)
   and pg_temp.refused($q$ select public.crm_add_contact_role('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
         'd1000000-0000-4000-8000-000000000009', 'decision_maker', null) $q$);

-- ---------------------------------------------------------------------------
-- 3. Atomic tag delete
-- ---------------------------------------------------------------------------

insert into public.crm_contact_tags (workspace_id, contact_id, tag_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd1000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000005');
select public.crm_set_company_tags('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-00000000000a',
  '91000000-0000-4000-8000-000000000001', null, array['92000000-0000-4000-8000-000000000001']::uuid[], null);

-- 11. A value leads carry, and one accounts carry, are in use; an unused one goes.
create temp table t11 as
select public.crm_delete_tag_value('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '92000000-0000-4000-8000-000000000005') as lead_val,
       public.crm_delete_tag_value('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '92000000-0000-4000-8000-000000000001') as account_val,
       public.crm_delete_tag_value('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '92000000-0000-4000-8000-000000000002') as unused_val;
insert into smoke_checks (label, ok)
select 'delete: in use (lead), in use (account), unused deleted',
       lead_val = 'in_use' and account_val = 'in_use' and unused_val = 'deleted'
   and (select count(*) from public.crm_contact_tags where tag_id = '92000000-0000-4000-8000-000000000005') = 1
   and not exists (select 1 from public.crm_tags where id = '92000000-0000-4000-8000-000000000002')
  from t11;

-- 12. Another workspace's id is "not found", never deleted.
insert into smoke_checks (label, ok)
select 'delete: another workspace''s value is not found',
       public.crm_delete_tag_value('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '92000000-0000-4000-8000-000000000003') = 'not_found'
   and exists (select 1 from public.crm_tags where id = '92000000-0000-4000-8000-000000000003');

-- ---------------------------------------------------------------------------
-- 4. Disabled group
-- ---------------------------------------------------------------------------

select public.crm_set_company_tags('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-00000000000a',
  '91000000-0000-4000-8000-000000000002', null, array['92000000-0000-4000-8000-000000000003']::uuid[], null);
update public.crm_tag_groups set is_active = false where id = '91000000-0000-4000-8000-000000000002';

-- 13. Adding to a disabled group is refused; removing from it still works.
create temp table t13 as
select pg_temp.refused($q$ select public.crm_set_company_tags('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
         'c1000000-0000-4000-8000-00000000000a', '91000000-0000-4000-8000-000000000002', null,
         array['92000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000004']::uuid[], null) $q$) as add_refused;
create temp table t13b as
select (public.crm_set_company_tags('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-00000000000a',
         '91000000-0000-4000-8000-000000000002', null, '{}'::uuid[], null) ->> 'changed')::boolean as removed;
insert into smoke_checks (label, ok)
select 'disabled group: add refused, removal allowed',
       (select add_refused from t13) and (select removed from t13b)
   and not exists (select 1 from public.crm_company_tags
                    where company_id = 'c1000000-0000-4000-8000-00000000000a'
                      and group_id = '91000000-0000-4000-8000-000000000002');

-- ---------------------------------------------------------------------------
-- 5. Access
-- ---------------------------------------------------------------------------

-- 14. RLS on, members read only, functions service-role only.
insert into smoke_checks (label, ok)
select 'RLS on; no client write; functions service-role only',
       (select relrowsecurity from pg_class where oid = 'public.crm_contact_links'::regclass)
   and not has_table_privilege('authenticated', 'public.crm_contact_links', 'insert')
   and not has_table_privilege('anon', 'public.crm_contact_links', 'select')
   and not has_function_privilege('authenticated', 'public.crm_add_contact_links(uuid,uuid,jsonb,uuid,text)', 'execute')
   and not has_function_privilege('authenticated', 'public.crm_add_contact_role(uuid,uuid,text,uuid)', 'execute')
   and not has_function_privilege('authenticated', 'public.crm_delete_tag_value(uuid,uuid)', 'execute')
   and not has_function_privilege('authenticated', 'public.crm_set_company_tags(uuid,uuid,uuid,uuid,uuid[],uuid,boolean,text)', 'execute')
   and has_function_privilege('service_role', 'public.crm_add_contact_role(uuid,uuid,text,uuid)', 'execute');

-- ---------------------------------------------------------------------------
-- The gate
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 15;
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
