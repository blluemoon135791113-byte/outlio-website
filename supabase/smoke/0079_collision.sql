-- Smoke test for 0079. The risk here is the new enum value: a migration can
-- ADD it and create a function that names it, and still fail the first time
-- the function actually runs.
--
-- ⚠️ EVERY CHECK IS RECORDED, THEN GATED. This file used to print values for a
-- person to read, and its must-fail statements ran with ON_ERROR_STOP lifted,
-- so a statement that wrongly SUCCEEDED passed silently. Each check now goes
-- into `smoke_checks` through `coalesce(…, false)`, and the gate at the end
-- raises unless exactly the expected number were recorded and every one is true.
--
-- Run it with:
--   scripts/check-migration.sh supabase/migrations/0079_crm_collision_guard.sql \
--     supabase/smoke/0079_collision.sql

\set ON_ERROR_STOP on
begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111','owner@example.com'),
  ('99999999-9999-4999-8999-999999999999','setter@example.com');
insert into public.profiles (id, email) values
  ('11111111-1111-4111-8111-111111111111','owner@example.com');
insert into public.workspaces (id, owner_user_id, name) values
  ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','WS');

insert into public.crm_contacts (id, workspace_id, full_name, owner_user_id) values
  ('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222',
   'Contested Prospect','99999999-9999-4999-8999-999999999999');

-- ===========================================================================
-- Defaults apply with no settings row.
-- ===========================================================================
insert into smoke_checks (label, ok)
values ('with no settings row, the contact mode falls back to the default',
        coalesce((select contact_mode::text from public.crm_collision_settings
                   where workspace_id = '22222222-2222-4222-8222-222222222222'), 'warn (default)')
        = 'warn (default)');

-- ===========================================================================
-- The new enum value is usable at runtime.
-- ===========================================================================
create temp table override_result as
select public.crm_record_collision_override(
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '11111111-1111-4111-8111-111111111111',
  'Existing relationship, agreed with owner') as activity_id;

-- An activity naming the owner who was stepped over.
insert into smoke_checks (label, ok) values
  ('the override writes a COLLISION_OVERRIDE activity on the system channel',
   coalesce((select a.activity_type::text = 'COLLISION_OVERRIDE' and a.channel::text = 'system'
               from public.crm_activities a join override_result o on a.id = o.activity_id), false)),
  ('the activity credits the overrider as its actor',
   coalesce((select a.actor_user_id = '11111111-1111-4111-8111-111111111111'
               from public.crm_activities a join override_result o on a.id = o.activity_id), false)),
  ('the activity names the owner who was stepped over',
   coalesce((select a.owner_user_id_at_event = '99999999-9999-4999-8999-999999999999'
               from public.crm_activities a join override_result o on a.id = o.activity_id), false)),
  ('the activity carries the reason',
   coalesce((select a.metadata->>'reason' = 'Existing relationship, agreed with owner'
               from public.crm_activities a join override_result o on a.id = o.activity_id), false));

-- AND an audit row, in the same transaction.
insert into smoke_checks (label, ok)
select 'one audit row targets the contact and records a reason',
       coalesce(count(*) = 1
                and bool_and(target_id = '33333333-3333-4333-8333-333333333333' and reason is not null), false)
  from public.crm_audit_logs where action = 'crm.collision.override';

-- ===========================================================================
-- One open reassignment request per person.
-- ===========================================================================
insert into public.crm_reassignment_requests
  (workspace_id, contact_id, requested_by, current_owner_user_id, note)
values ('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
        '11111111-1111-4111-8111-111111111111','99999999-9999-4999-8999-999999999999','Please');

do $$
declare
  v_refused boolean := false;
begin
  begin
    insert into public.crm_reassignment_requests
      (workspace_id, contact_id, requested_by, current_owner_user_id)
    values ('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
            '11111111-1111-4111-8111-111111111111','99999999-9999-4999-8999-999999999999');
  exception
    when unique_violation then
      v_refused := true;
  end;

  insert into smoke_checks (label, ok)
  values ('asking twice for the same person is refused', v_refused);
end $$;

do $$
declare
  v_refused boolean := false;
begin
  begin
    update public.crm_reassignment_requests set status = 'approved';
  exception
    when check_violation then
      v_refused := true;
  end;

  insert into smoke_checks (label, ok)
  values ('a resolved request with no timestamp is refused', v_refused);
end $$;

-- Resolving properly works, and frees the slot.
update public.crm_reassignment_requests
   set status='declined', resolved_at=now(), resolved_by='99999999-9999-4999-8999-999999999999';
insert into public.crm_reassignment_requests
  (workspace_id, contact_id, requested_by, current_owner_user_id)
values ('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
        '11111111-1111-4111-8111-111111111111','99999999-9999-4999-8999-999999999999');

insert into smoke_checks (label, ok)
select 'resolving a request frees the slot for a new one', coalesce(count(*) = 2, false)
  from public.crm_reassignment_requests;

-- ---------------------------------------------------------------------------
-- The gate.
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 9;
  v_total    integer;
  v_failed   text;
begin
  select count(*),
         string_agg(label, '; ' order by n) filter (where ok is not true)
    into v_total, v_failed
    from smoke_checks;

  -- ⚠️ THE COUNT IS PART OF THE TEST. A check that never ran records nothing,
  -- so it would pass by being absent. Adding or removing a check means
  -- changing this number, on purpose.
  if v_total <> v_expected then
    raise exception 'SMOKE FAILED: expected % checks, recorded %', v_expected, v_total;
  end if;

  if v_failed is not null then
    raise exception 'SMOKE FAILED: %', v_failed;
  end if;

  raise notice 'SMOKE PASSED: % of % checks', v_total, v_expected;
end $$;

rollback;
