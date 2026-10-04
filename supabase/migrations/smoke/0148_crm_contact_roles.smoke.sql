-- Smoke test for 0148 — several roles per lead, roles in use cannot be
-- deleted, tenants cannot be crossed, and lead deletion still cascades.
--
-- Run with:
--   scripts/check-migration.sh supabase/migrations/0148_crm_contact_roles.sql \
--     supabase/migrations/smoke/0148_crm_contact_roles.smoke.sql

\set ON_ERROR_STOP on

begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com');

insert into public.workspaces (id, name, owner_user_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Smoke', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Other', '11111111-1111-1111-1111-111111111111');

insert into public.crm_contacts (id, workspace_id, full_name, job_title)
values ('d1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'Pat Example', 'VP Revenue Cycle');

create temp table r as
select
  (select id from public.crm_lead_roles where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and system_key = 'decision_maker') as dm,
  (select id from public.crm_lead_roles where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and system_key = 'champion') as champ,
  (select id from public.crm_lead_roles where workspace_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and system_key = 'champion') as other_champ;

-- 1. A lead can hold two roles.
insert into public.crm_contact_role_assignments (workspace_id, contact_id, role_id, is_auto)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'd1000000-0000-4000-8000-000000000001'::uuid, dm, true from r
union all
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'd1000000-0000-4000-8000-000000000001'::uuid, champ, false from r;
insert into smoke_checks (label, ok)
select 'a lead holds two roles',
       coalesce((select count(*) = 2 from public.crm_contact_role_assignments
                  where contact_id = 'd1000000-0000-4000-8000-000000000001'), false);

-- 2. The same role twice is refused.
do $$
declare
  v_refused boolean := false;
begin
  begin
    insert into public.crm_contact_role_assignments (workspace_id, contact_id, role_id)
    select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'd1000000-0000-4000-8000-000000000001'::uuid, dm from r;
  exception when unique_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('duplicate role refused', v_refused);
end $$;

-- 3. A role in use cannot be deleted (and Champion is a system row anyway; use a custom one).
insert into public.crm_lead_roles (id, workspace_id, name, slug)
values ('e1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Influencer', 'influencer');
insert into public.crm_contact_role_assignments (workspace_id, contact_id, role_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd1000000-0000-4000-8000-000000000001',
        'e1000000-0000-4000-8000-000000000001');
do $$
declare
  v_refused boolean := false;
begin
  begin
    delete from public.crm_lead_roles where id = 'e1000000-0000-4000-8000-000000000001';
  exception when foreign_key_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('role in use cannot be deleted', v_refused);
end $$;

-- 4. Another workspace's role cannot be attached.
do $$
declare
  v_refused boolean := false;
begin
  begin
    insert into public.crm_contact_role_assignments (workspace_id, contact_id, role_id)
    select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'd1000000-0000-4000-8000-000000000001'::uuid, other_champ from r;
  exception when foreign_key_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('cross-workspace role refused', v_refused);
end $$;

-- 5. Manual state is recorded per lead.
insert into public.crm_contact_role_state (workspace_id, contact_id, manual_at, manual_by)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd1000000-0000-4000-8000-000000000001', now(),
        '11111111-1111-1111-1111-111111111111');
insert into smoke_checks (label, ok)
select 'manual state recorded',
       exists (select 1 from public.crm_contact_role_state
                where contact_id = 'd1000000-0000-4000-8000-000000000001' and manual_at is not null);

-- 6. Hard-deleting the lead (erasure) takes its roles and state with it.
delete from public.crm_contacts where id = 'd1000000-0000-4000-8000-000000000001';
insert into smoke_checks (label, ok)
select 'lead deletion cascades',
       not exists (select 1 from public.crm_contact_role_assignments where contact_id = 'd1000000-0000-4000-8000-000000000001')
       and not exists (select 1 from public.crm_contact_role_state where contact_id = 'd1000000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------------------
-- The gate
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 6;
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
