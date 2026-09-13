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
-- Run it with:
--   scripts/check-migration.sh supabase/migrations/0123_crm_assign_contact_owner.sql \
--     supabase/migrations/smoke/0123_crm_assign_contact_owner.smoke.sql

\set ON_ERROR_STOP on

begin;

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

  if (v_result->>'changed')::boolean is not true then
    raise exception 'a real reassignment reported changed=false: %', v_result;
  end if;

  if v_result->>'activity_id' is null then
    raise exception 'no activity id returned: %', v_result;
  end if;

  -- The contact actually moved.
  select owner_user_id into v_owner
    from public.crm_contacts
   where id = '44444444-4444-4444-4444-444444444444';

  if v_owner is distinct from '22222222-2222-2222-2222-222222222222'::uuid then
    raise exception 'owner is % after reassignment, expected Bob', v_owner;
  end if;

  -- Exactly one audit row, and it says the right thing.
  select count(*) into v_count
    from public.crm_activities
   where contact_id = '44444444-4444-4444-4444-444444444444'
     and activity_type = 'OWNER_ASSIGNED';

  if v_count <> 1 then
    raise exception 'expected 1 OWNER_ASSIGNED row, found %', v_count;
  end if;

  select (metadata->>'from')::uuid, owner_user_id_at_event
    into v_from, v_at_event
    from public.crm_activities
   where contact_id = '44444444-4444-4444-4444-444444444444'
     and activity_type = 'OWNER_ASSIGNED';

  -- ⚠️ BOTH must be the OLD owner. `owner_user_id_at_event` read from the
  -- post-update row would say Bob, which silently breaks attribution
  -- reporting — last quarter's numbers move when a book is reassigned.
  if v_from is distinct from '11111111-1111-1111-1111-111111111111'::uuid then
    raise exception 'metadata.from is %, expected Alice', v_from;
  end if;

  if v_at_event is distinct from '11111111-1111-1111-1111-111111111111'::uuid then
    raise exception 'owner_user_id_at_event is %, expected Alice', v_at_event;
  end if;
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

  if (v_result->>'changed')::boolean is not false then
    raise exception 'a no-op reported changed=true: %', v_result;
  end if;

  select count(*) into v_count
    from public.crm_activities
   where contact_id = '44444444-4444-4444-4444-444444444444'
     and activity_type = 'OWNER_ASSIGNED';

  if v_count <> 1 then
    raise exception 'a no-op wrote an activity: now % rows', v_count;
  end if;
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

  if (v_result->>'changed')::boolean is not true then
    raise exception 'unassigning reported changed=false: %', v_result;
  end if;

  select owner_user_id into v_owner
    from public.crm_contacts
   where id = '44444444-4444-4444-4444-444444444444';

  if v_owner is not null then
    raise exception 'contact still owned by % after unassign', v_owner;
  end if;

  -- Unassigning again must be the no-op.
  v_result := public.crm_assign_contact_owner(
    '33333333-3333-3333-3333-333333333333',
    '44444444-4444-4444-4444-444444444444',
    null,
    '11111111-1111-1111-1111-111111111111'
  );

  if (v_result->>'changed')::boolean is not false then
    raise exception 'unassigning an unassigned contact reported changed=true: %', v_result;
  end if;

  select count(*) into v_count
    from public.crm_activities
   where contact_id = '44444444-4444-4444-4444-444444444444'
     and activity_type = 'OWNER_ASSIGNED';

  if v_count <> 2 then
    raise exception 'expected 2 OWNER_ASSIGNED rows (assign + unassign), found %', v_count;
  end if;
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

  if v_owner is distinct from '11111111-1111-1111-1111-111111111111'::uuid then
    raise exception 'the control contact moved to %, so the function is writing rows it was not asked about', v_owner;
  end if;

  select count(*) into v_count
    from public.crm_activities
   where contact_id = '55555555-5555-5555-5555-555555555555';

  if v_count <> 0 then
    raise exception 'the control contact has % activities', v_count;
  end if;
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

  if not v_failed then
    raise exception 'a contact was reassigned through the wrong workspace id';
  end if;
end $$;

rollback;
