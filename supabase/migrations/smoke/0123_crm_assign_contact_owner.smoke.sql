-- Smoke test for 0123 — do the contact update and its audit row commit together?
--
-- ⚠️ "APPLIES CLEANLY" DOES NOT PROVE THIS. `check_function_bodies` syntax-checks
-- a plpgsql body; it does not resolve table or column names inside it. A column
-- that does not exist creates the function happily and fails the first time
-- somebody reassigns a contact — at which point the failure is in production, on
-- the path that decides who owns a customer relationship.
--
-- So this exercises the real function against real rows.
--
-- ⚠️ EVERY CHECK IS RECORDED, THEN GATED. `if v_count <> 1 then raise` skips
-- silently when the left side is NULL. So each check goes into `smoke_checks`
-- through `coalesce(…, false)`, and the gate at the end raises unless exactly
-- the expected number were recorded and every one is true.
--
-- Run it with:
--   scripts/check-migration.sh supabase/migrations/0123_crm_assign_contact_owner.sql \
--     supabase/migrations/smoke/0123_crm_assign_contact_owner.smoke.sql

\set ON_ERROR_STOP on

begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
);

-- ---------------------------------------------------------------------------
-- A workspace, two members, and two contacts. The second contact is the
-- control: nothing reassigns it, so if it moves the function is touching rows
-- it was not asked about and every assertion below would pass for the wrong
-- reason.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.workspaces (id, name, owner_user_id)
values ('33333333-3333-3333-3333-333333333333', 'Smoke',
        '11111111-1111-1111-1111-111111111111');

insert into public.crm_contacts (id, workspace_id, full_name, owner_user_id)
values ('44444444-4444-4444-4444-444444444444',
        '33333333-3333-3333-3333-333333333333', 'Ada Okonkwo',
        '11111111-1111-1111-1111-111111111111');

-- The control.
insert into public.crm_contacts (id, workspace_id, full_name, owner_user_id)
values ('55555555-5555-5555-5555-555555555555',
        '33333333-3333-3333-3333-333333333333', 'Marcus Bellweather',
        '11111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- 1. A real reassignment: Alice → Bob.
-- ---------------------------------------------------------------------------
do $$
declare
  v_result   jsonb;
  v_owner    uuid;
  v_count    integer;
  v_from     uuid;
  v_at_event uuid;
begin
  v_result := public.crm_assign_contact_owner(
    '33333333-3333-3333-3333-333333333333',
    '44444444-4444-4444-4444-444444444444',
    '22222222-2222-2222-2222-222222222222',
    '11111111-1111-1111-1111-111111111111'
  );

  insert into smoke_checks (label, ok)
  values ('a real reassignment reports changed=true',
          coalesce((v_result->>'changed')::boolean, false));

  insert into smoke_checks (label, ok)
  values ('a real reassignment returns an activity id',
          v_result->>'activity_id' is not null);

  -- The contact actually moved.
  select owner_user_id into v_owner
    from public.crm_contacts
   where id = '44444444-4444-4444-4444-444444444444';

  insert into smoke_checks (label, ok)
  values ('the contact is owned by Bob after reassignment',
          v_owner is not distinct from '22222222-2222-2222-2222-222222222222'::uuid);

  -- Exactly one audit row, and it says the right thing.
  select count(*) into v_count
    from public.crm_activities
   where contact_id = '44444444-4444-4444-4444-444444444444'
     and activity_type = 'OWNER_ASSIGNED';

  insert into smoke_checks (label, ok)
  values ('the reassignment wrote exactly 1 OWNER_ASSIGNED row',
          coalesce(v_count = 1, false));

  select (metadata->>'from')::uuid, owner_user_id_at_event
    into v_from, v_at_event
    from public.crm_activities
   where contact_id = '44444444-4444-4444-4444-444444444444'
     and activity_type = 'OWNER_ASSIGNED';

  -- ⚠️ BOTH must be the OLD owner. `owner_user_id_at_event` read from the
  -- post-update row would say Bob, which silently breaks attribution
  -- reporting — last quarter's numbers move when a book is reassigned.
  insert into smoke_checks (label, ok)
  values ('metadata.from is the old owner, Alice',
          v_from is not distinct from '11111111-1111-1111-1111-111111111111'::uuid);

  insert into smoke_checks (label, ok)
  values ('owner_user_id_at_event is the old owner, Alice',
          v_at_event is not distinct from '11111111-1111-1111-1111-111111111111'::uuid);
end $$;

-- ---------------------------------------------------------------------------
-- 2. A no-op: assigning Bob to a contact Bob already owns.
--
-- ⚠️ THE POINT IS THAT NO ACTIVITY IS WRITTEN. An OWNER_ASSIGNED row for a
-- handover that did not happen is exactly the false history 0123 exists to
-- prevent, and it would be unremovable once written.
-- ---------------------------------------------------------------------------
do $$
declare
  v_result jsonb;
  v_count  integer;
begin
  v_result := public.crm_assign_contact_owner(
    '33333333-3333-3333-3333-333333333333',
    '44444444-4444-4444-4444-444444444444',
    '22222222-2222-2222-2222-222222222222',
    '11111111-1111-1111-1111-111111111111'
  );

  insert into smoke_checks (label, ok)
  values ('a no-op reports changed=false',
          coalesce((v_result->>'changed')::boolean = false, false));

  select count(*) into v_count
    from public.crm_activities
   where contact_id = '44444444-4444-4444-4444-444444444444'
     and activity_type = 'OWNER_ASSIGNED';

  insert into smoke_checks (label, ok)
  values ('a no-op writes no activity (still 1 row)',
          coalesce(v_count = 1, false));
end $$;

-- ---------------------------------------------------------------------------
-- 3. Unassigning — NULL is a legitimate owner.
--
-- ⚠️ THIS IS WHY THE FUNCTION USES `is not distinct from`. With `=`, the
-- comparison against NULL is NULL rather than true, so "already unassigned"
-- would be treated as a change and write an activity saying nothing happened.
-- ---------------------------------------------------------------------------
do $$
declare
  v_result jsonb;
  v_owner  uuid;
  v_count  integer;
begin
  v_result := public.crm_assign_contact_owner(
    '33333333-3333-3333-3333-333333333333',
    '44444444-4444-4444-4444-444444444444',
    null,
    '11111111-1111-1111-1111-111111111111'
  );

  insert into smoke_checks (label, ok)
  values ('unassigning reports changed=true',
          coalesce((v_result->>'changed')::boolean, false));

  select owner_user_id into v_owner
    from public.crm_contacts
   where id = '44444444-4444-4444-4444-444444444444';

  -- ⚠️ `found` AS WELL AS NULL. A missing row also leaves v_owner NULL, and
  -- would otherwise read as a successful unassign.
  insert into smoke_checks (label, ok)
  values ('the contact has no owner after unassign',
          found and v_owner is null);

  -- Unassigning again must be the no-op.
  v_result := public.crm_assign_contact_owner(
    '33333333-3333-3333-3333-333333333333',
    '44444444-4444-4444-4444-444444444444',
    null,
    '11111111-1111-1111-1111-111111111111'
  );

  insert into smoke_checks (label, ok)
  values ('unassigning an unassigned contact reports changed=false',
          coalesce((v_result->>'changed')::boolean = false, false));

  select count(*) into v_count
    from public.crm_activities
   where contact_id = '44444444-4444-4444-4444-444444444444'
     and activity_type = 'OWNER_ASSIGNED';

  insert into smoke_checks (label, ok)
  values ('2 OWNER_ASSIGNED rows (assign + unassign)',
          coalesce(v_count = 2, false));
end $$;

-- ---------------------------------------------------------------------------
-- 4. The control contact was never touched.
-- ---------------------------------------------------------------------------
do $$
declare
  v_owner uuid;
  v_count integer;
begin
  select owner_user_id into v_owner
    from public.crm_contacts
   where id = '55555555-5555-5555-5555-555555555555';

  insert into smoke_checks (label, ok)
  values ('the control contact is still owned by Alice',
          v_owner is not distinct from '11111111-1111-1111-1111-111111111111'::uuid);

  select count(*) into v_count
    from public.crm_activities
   where contact_id = '55555555-5555-5555-5555-555555555555';

  insert into smoke_checks (label, ok)
  values ('the control contact has no activities',
          coalesce(v_count = 0, false));
end $$;

-- ---------------------------------------------------------------------------
-- 5. A contact in another workspace is not reachable.
-- ---------------------------------------------------------------------------
do $$
declare
  v_failed boolean := false;
begin
  begin
    perform public.crm_assign_contact_owner(
      '99999999-9999-9999-9999-999999999999',
      '44444444-4444-4444-4444-444444444444',
      '22222222-2222-2222-2222-222222222222',
      '11111111-1111-1111-1111-111111111111'
    );
  exception when no_data_found then
    v_failed := true;
  end;

  insert into smoke_checks (label, ok)
  values ('a contact cannot be reassigned through the wrong workspace id',
          coalesce(v_failed, false));
end $$;

-- ---------------------------------------------------------------------------
-- The gate.
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 15;
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
