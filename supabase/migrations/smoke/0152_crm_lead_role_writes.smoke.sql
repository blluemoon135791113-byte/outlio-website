-- Smoke test for 0152 — suggestions apply, a person's choice is never
-- overwritten, and "back to automatic" really is.
--
-- Run with:
--   scripts/check-migration.sh supabase/migrations/0152_crm_lead_role_writes.sql \
--     supabase/migrations/smoke/0152_crm_lead_role_writes.smoke.sql

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
  ('d1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Pat', 'VP Revenue Cycle'),
  ('d1000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Sam', 'Revenue Cycle Manager'),
  ('d1000000-0000-4000-8000-000000000009', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Elsewhere', 'CFO');

create temp table r as
select
  (select id from public.crm_lead_roles where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and system_key = 'decision_maker') as dm,
  (select id from public.crm_lead_roles where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and system_key = 'champion') as champ,
  (select id from public.crm_lead_roles where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and system_key = 'technical') as tech,
  (select id from public.crm_lead_roles where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and system_key = 'other') as other;

create or replace function pg_temp.roles(p_contact uuid) returns text language sql as $$
  select coalesce(string_agg(lr.system_key || ':' || a.is_auto::text, ',' order by lr.system_key), '')
    from public.crm_contact_role_assignments a
    join public.crm_lead_roles lr on lr.id = a.role_id
   where a.contact_id = p_contact
$$;

-- 1. Suggestions land as automatic rows, and the title is remembered.
select public.crm_apply_auto_roles('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', jsonb_build_array(
  jsonb_build_object('contact_id', 'd1000000-0000-4000-8000-000000000001', 'title', 'VP Revenue Cycle', 'role_ids', jsonb_build_array((select dm from r))),
  jsonb_build_object('contact_id', 'd1000000-0000-4000-8000-000000000002', 'title', 'Revenue Cycle Manager', 'role_ids', jsonb_build_array((select champ from r)))
));
insert into smoke_checks (label, ok)
select 'suggestions applied as automatic',
       pg_temp.roles('d1000000-0000-4000-8000-000000000001') = 'decision_maker:true'
       and pg_temp.roles('d1000000-0000-4000-8000-000000000002') = 'champion:true'
       and coalesce((select auto_title = 'VP Revenue Cycle' from public.crm_contact_role_state
                      where contact_id = 'd1000000-0000-4000-8000-000000000001'), false);

-- 2. A re-run with a new title replaces the automatic roles.
select public.crm_apply_auto_roles('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', jsonb_build_array(
  jsonb_build_object('contact_id', 'd1000000-0000-4000-8000-000000000001', 'title', 'CIO', 'role_ids', jsonb_build_array((select tech from r)))
));
insert into smoke_checks (label, ok)
select 'a re-run replaces automatic roles', pg_temp.roles('d1000000-0000-4000-8000-000000000001') = 'technical:true';

-- 3. A person's choice: two roles, both manual, the lead pinned.
select public.crm_set_contact_roles('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd1000000-0000-4000-8000-000000000002',
         array[(select champ from r), (select dm from r)], '11111111-1111-1111-1111-111111111111');
insert into smoke_checks (label, ok)
select 'manual choice stored, several roles, pinned',
       pg_temp.roles('d1000000-0000-4000-8000-000000000002') = 'champion:false,decision_maker:false'
       and exists (select 1 from public.crm_contact_role_state
                    where contact_id = 'd1000000-0000-4000-8000-000000000002'
                      and manual_at is not null and manual_by = '11111111-1111-1111-1111-111111111111');

-- 4. THE RULE: a later classifier run (a title change) leaves it alone.
insert into smoke_checks (label, ok)
select 'classifier never overwrites a manual choice',
       coalesce((public.crm_apply_auto_roles('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', jsonb_build_array(
         jsonb_build_object('contact_id', 'd1000000-0000-4000-8000-000000000002', 'title', 'CTO',
                            'role_ids', jsonb_build_array((select tech from r))))) ->> 'skipped_manual')::int = 1, false)
       and pg_temp.roles('d1000000-0000-4000-8000-000000000002') = 'champion:false,decision_maker:false';

-- 5. Removing every role by hand is a choice too — it stays empty.
select public.crm_set_contact_roles('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd1000000-0000-4000-8000-000000000002',
         '{}'::uuid[], '11111111-1111-1111-1111-111111111111');
select public.crm_apply_auto_roles('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', jsonb_build_array(
  jsonb_build_object('contact_id', 'd1000000-0000-4000-8000-000000000002', 'title', 'CTO', 'role_ids', jsonb_build_array((select tech from r)))
));
insert into smoke_checks (label, ok)
select 'a manual empty set survives the classifier', pg_temp.roles('d1000000-0000-4000-8000-000000000002') = '';

-- 6. Back to automatic: unpinned, cleared, and the classifier applies again.
select public.crm_set_contact_roles('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd1000000-0000-4000-8000-000000000002',
         null, '11111111-1111-1111-1111-111111111111');
select public.crm_apply_auto_roles('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', jsonb_build_array(
  jsonb_build_object('contact_id', 'd1000000-0000-4000-8000-000000000002', 'title', 'CTO', 'role_ids', jsonb_build_array((select tech from r)))
));
insert into smoke_checks (label, ok)
select 'reset returns the lead to automatic',
       pg_temp.roles('d1000000-0000-4000-8000-000000000002') = 'technical:true'
       and exists (select 1 from public.crm_contact_role_state
                    where contact_id = 'd1000000-0000-4000-8000-000000000002' and manual_at is null);

-- 7. A disabled role is dropped from suggestions and cannot be newly chosen.
update public.crm_lead_roles set is_active = false where id = (select other from r);
select public.crm_apply_auto_roles('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', jsonb_build_array(
  jsonb_build_object('contact_id', 'd1000000-0000-4000-8000-000000000001', 'title', 'Office Assistant', 'role_ids', jsonb_build_array((select other from r)))
));
do $$
declare
  v_refused boolean := false;
begin
  begin
    perform public.crm_set_contact_roles('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd1000000-0000-4000-8000-000000000001',
              array[(select other from r)], null);
  exception when check_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok)
  values ('disabled role neither suggested nor newly chosen',
          v_refused and pg_temp.roles('d1000000-0000-4000-8000-000000000001') = '');
end $$;

-- 8. Another workspace's lead is skipped by the batch and refused by the manual writer.
do $$
declare
  v_result  jsonb;
  v_refused boolean := false;
begin
  v_result := public.crm_apply_auto_roles('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', jsonb_build_array(
    jsonb_build_object('contact_id', 'd1000000-0000-4000-8000-000000000009', 'title', 'CFO',
                       'role_ids', jsonb_build_array((select dm from r)))));
  begin
    perform public.crm_set_contact_roles('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd1000000-0000-4000-8000-000000000009',
              array[(select dm from r)], null);
  exception when no_data_found then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok)
  values ('cross-workspace lead untouched',
          (v_result ->> 'missing')::int = 1 and v_refused
          and pg_temp.roles('d1000000-0000-4000-8000-000000000009') = '');
end $$;

-- 9. Service role only.
insert into smoke_checks (label, ok)
select 'service-role only',
       not has_function_privilege('authenticated', 'public.crm_apply_auto_roles(uuid,jsonb)', 'execute')
       and not has_function_privilege('authenticated', 'public.crm_set_contact_roles(uuid,uuid,uuid[],uuid)', 'execute')
       and not has_function_privilege('authenticated', 'public.crm_lock_contact_role_state(uuid,uuid)', 'execute');

-- ---------------------------------------------------------------------------
-- The gate
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 9;
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
