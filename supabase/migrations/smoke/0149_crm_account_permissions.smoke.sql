-- Smoke test for 0149 — the full default matrix, the owner exemption,
-- overrides tied to membership, and who can read an override.
--
-- Run with:
--   scripts/check-migration.sh supabase/migrations/0149_crm_account_permissions.sql \
--     supabase/migrations/smoke/0149_crm_account_permissions.smoke.sql

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
  ('22222222-2222-2222-2222-222222222222', 'sam@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'taylor@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'outsider@example.com');

insert into public.workspaces (id, name, owner_user_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Smoke', '11111111-1111-1111-1111-111111111111');
insert into public.workspace_memberships (workspace_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'setter'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'setter');

-- 1. Full matrix: 4 roles × 9 permissions, no owner rows.
insert into smoke_checks (label, ok)
select 'trigger seeds 36 defaults and no owner rows',
       coalesce((select count(*) = 36 and count(*) filter (where role = 'owner') = 0
                   from public.crm_account_role_defaults
                  where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), false);

-- 2–5. The agreed defaults, cell by cell where it matters.
insert into smoke_checks (label, ok)
select 'admin holds all nine',
       coalesce((select bool_and(granted) and count(*) = 9 from public.crm_account_role_defaults
                  where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and role = 'admin'), false);
insert into smoke_checks (label, ok)
select 'manager lacks exactly delete and config.manage',
       coalesce((select array_agg(permission order by permission) = array['accounts.delete', 'config.manage']
                   from public.crm_account_role_defaults
                  where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and role = 'manager' and not granted), false);
insert into smoke_checks (label, ok)
select 'setter holds exactly edit and both tag edits',
       coalesce((select array_agg(permission order by permission)
                        = array['accounts.edit', 'accounts.edit_icp_tags', 'accounts.edit_product_tags']
                   from public.crm_account_role_defaults
                  where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and role = 'setter' and granted), false);
insert into smoke_checks (label, ok)
select 'viewer holds nothing',
       coalesce((select not bool_or(granted) from public.crm_account_role_defaults
                  where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and role = 'viewer'), false);

-- 6. The owner cannot be given a row.
do $$
declare
  v_refused boolean := false;
begin
  begin
    insert into public.crm_account_role_defaults (workspace_id, role, permission, granted)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'owner', 'config.manage', false);
  exception when check_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('owner row refused', v_refused);
end $$;

-- 7. An unknown permission is refused.
do $$
declare
  v_refused boolean := false;
begin
  begin
    insert into public.crm_account_permission_overrides (workspace_id, user_id, permission, granted)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'accounts.everything', true);
  exception when check_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('unknown permission refused', v_refused);
end $$;

-- 8. A non-member cannot be given an override.
do $$
declare
  v_refused boolean := false;
begin
  begin
    insert into public.crm_account_permission_overrides (workspace_id, user_id, permission, granted)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'accounts.create', true);
  exception when foreign_key_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('override for non-member refused', v_refused);
end $$;

-- 9–10. Sam's override is visible to Sam and the owner, not to Taylor.
insert into public.crm_account_permission_overrides (workspace_id, user_id, permission, granted)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'accounts.create', true);

do $$
declare
  v_sam   integer;
  v_owner integer;
  v_other integer;
begin
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', true);
  set local role authenticated;
  select count(*) into v_sam from public.crm_account_permission_overrides;
  reset role;

  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
  set local role authenticated;
  select count(*) into v_owner from public.crm_account_permission_overrides;
  reset role;

  perform set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333"}', true);
  set local role authenticated;
  select count(*) into v_other from public.crm_account_permission_overrides;
  reset role;

  insert into smoke_checks (label, ok) values ('the person and the owner read the override', v_sam = 1 and v_owner = 1);
  insert into smoke_checks (label, ok) values ('another setter cannot read it', v_other = 0);
end $$;

-- 11. Leaving the workspace removes the override.
delete from public.workspace_memberships
 where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
   and user_id = '22222222-2222-2222-2222-222222222222';
insert into smoke_checks (label, ok)
select 'membership removal removes overrides',
       not exists (select 1 from public.crm_account_permission_overrides
                    where user_id = '22222222-2222-2222-2222-222222222222');

-- 12. Re-seeding never overwrites an edited default.
update public.crm_account_role_defaults set granted = true
 where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and role = 'setter' and permission = 'accounts.create';
select public.crm_seed_account_permissions('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into smoke_checks (label, ok)
select 're-seed keeps an edited default',
       coalesce((select granted from public.crm_account_role_defaults
                  where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
                    and role = 'setter' and permission = 'accounts.create'), false);

-- ---------------------------------------------------------------------------
-- The gate
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 12;
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
