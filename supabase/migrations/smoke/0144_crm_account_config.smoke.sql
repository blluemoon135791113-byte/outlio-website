-- Smoke test for 0144 — is every workspace seeded, once, and are system rows
-- protected without blocking workspace deletion?
--
-- Run with:
--   scripts/check-migration.sh supabase/migrations/0144_crm_account_config.sql \
--     supabase/migrations/smoke/0144_crm_account_config.smoke.sql

\set ON_ERROR_STOP on

begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
);
grant all on smoke_checks to authenticated;
grant usage, select on sequence smoke_checks_n_seq to authenticated;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'outsider@example.com');

-- The trigger, not a manual call, must seed this one.
insert into public.workspaces (id, name, owner_user_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Smoke',
        '11111111-1111-1111-1111-111111111111');
insert into public.workspace_memberships (workspace_id, user_id, role)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner');

insert into public.workspaces (id, name, owner_user_id)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Other',
        '22222222-2222-2222-2222-222222222222');

-- 1–5. A new workspace starts with the full vocabulary.
insert into smoke_checks (label, ok)
select 'trigger seeds 12 ICP types',
       coalesce((select count(id) = 12 from public.crm_icp_types
                  where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), false);
insert into smoke_checks (label, ok)
select 'trigger seeds 6 products',
       coalesce((select count(id) = 6 from public.crm_products
                  where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), false);
insert into smoke_checks (label, ok)
select 'trigger seeds 9 statuses with new and assigned keyed',
       coalesce((select count(id) = 9
                        and count(system_key) filter (where system_key in ('new', 'assigned')) = 2
                   from public.crm_account_statuses
                  where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), false);
insert into smoke_checks (label, ok)
select 'trigger seeds 4 lead roles',
       coalesce((select count(id) = 4 from public.crm_lead_roles
                  where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), false);
insert into smoke_checks (label, ok)
select 'champion has 5 title and 5 function keywords',
       coalesce((select count(k.id) filter (where k.match_kind = 'title') = 5
                        and count(k.id) filter (where k.match_kind = 'function') = 5
                   from public.crm_lead_role_rules k
                   join public.crm_lead_roles r on r.id = k.role_id
                  where r.workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
                    and r.system_key = 'champion'), false);

-- 6. Re-seeding adds nothing.
select public.crm_seed_account_config('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into smoke_checks (label, ok)
select 'seed is idempotent',
       coalesce((select (select count(id) from public.crm_icp_types where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 12
                    and (select count(id) from public.crm_lead_role_rules where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 31), false);

-- 7. Seeds stay inside their workspace.
insert into smoke_checks (label, ok)
select 'other workspace seeded separately',
       coalesce((select count(id) = 12 from public.crm_icp_types
                  where workspace_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), false);

-- 8. A system status cannot be deleted.
do $$
declare
  v_refused boolean := false;
begin
  begin
    delete from public.crm_account_statuses
     where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and system_key = 'new';
  exception when restrict_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('system status delete refused', v_refused);
end $$;

-- 9. An ordinary status can be.
delete from public.crm_account_statuses
 where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and slug = 'closed';
insert into smoke_checks (label, ok)
select 'non-system status deletable',
       coalesce((select count(id) = 8 from public.crm_account_statuses
                  where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), false);

-- 10. Duplicate names are refused case-insensitively.
do $$
declare
  v_refused boolean := false;
begin
  begin
    insert into public.crm_icp_types (workspace_id, name, slug)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'tpa', 'tpa-2');
  exception when unique_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('duplicate ICP name refused', v_refused);
end $$;

-- 11–12. RLS: a member reads their vocabulary; an outsider reads none of it.
do $$
declare
  v_rows integer;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
  set local role authenticated;
  select count(id) into v_rows from public.crm_products;
  reset role;
  insert into smoke_checks (label, ok) values ('member reads own workspace products only', v_rows = 6);

  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', true);
  set local role authenticated;
  select count(id) into v_rows from public.crm_products;
  reset role;
  insert into smoke_checks (label, ok) values ('non-member reads nothing', v_rows = 0);
end $$;

-- 13. The system-row guard does not block deleting the workspace.
delete from public.workspaces where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
insert into smoke_checks (label, ok)
select 'workspace deletion cascades past system rows',
       coalesce((select count(id) = 0 from public.crm_lead_roles
                  where workspace_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), false);

-- 14. Not callable by clients.
insert into smoke_checks (label, ok)
select 'seed function is service-role only',
       not has_function_privilege('authenticated', 'public.crm_seed_account_config(uuid)', 'execute')
       and not has_function_privilege('anon', 'public.crm_seed_account_config(uuid)', 'execute');

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
