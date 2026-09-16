-- Smoke test for 0075. Proves the two things only execution can prove:
-- activities are genuinely immutable, and erasure actually cascades.
--
-- ⚠️ EVERY CHECK IS RECORDED, THEN GATED. This file used to print values for a
-- person to read, and its must-fail statements ran with ON_ERROR_STOP lifted,
-- so a statement that wrongly SUCCEEDED passed silently. Each check now goes
-- into `smoke_checks` through `coalesce(…, false)`, and the gate at the end
-- raises unless exactly the expected number were recorded and every one is true.
--
-- Run it with:
--   scripts/check-migration.sh supabase/migrations/0075_crm_operations.sql \
--     supabase/smoke/0075_operations.sql

\set ON_ERROR_STOP on
begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111','owner@example.com'),
  ('99999999-9999-4999-8999-999999999999','actor@example.com');
insert into public.profiles (id, email) values
  ('11111111-1111-4111-8111-111111111111','owner@example.com');
insert into public.workspaces (id, owner_user_id, name) values
  ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','WS');

insert into public.crm_contacts (id, workspace_id, full_name, owner_user_id) values
  ('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222',
   'Erasure Subject','11111111-1111-4111-8111-111111111111');

insert into public.crm_contact_emails (workspace_id, contact_id, address, identity_key, is_primary)
values ('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
        'subject@example.com','subject@example.com',true);

insert into public.crm_activities
  (id, workspace_id, activity_type, channel, contact_id, actor_user_id, owner_user_id_at_event)
values ('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222',
        'OPENER_SENT','linkedin','33333333-3333-4333-8333-333333333333',
        '99999999-9999-4999-8999-999999999999','11111111-1111-4111-8111-111111111111');

insert into public.crm_notes (workspace_id, contact_id, body)
values ('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','A note');
insert into public.crm_tasks (workspace_id, contact_id, title)
values ('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','Call them');
insert into public.crm_notifications (workspace_id, user_id, kind, title, refs)
values ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',
        'crm.reply', 'They replied',
        '{"contact_id":"33333333-3333-4333-8333-333333333333"}'::jsonb);

-- ===========================================================================
-- ACCEPTANCE 5: activities are immutable.
-- ===========================================================================
do $$
declare
  v_refused boolean := false;
begin
  begin
    update public.crm_activities set channel = 'email'
     where id = '44444444-4444-4444-8444-444444444444';
  exception
    when restrict_violation then
      v_refused := true;
  end;

  insert into smoke_checks (label, ok)
  values ('ACCEPTANCE 5: an UPDATE to an activity is refused', v_refused);
end $$;

do $$
declare
  v_refused boolean := false;
begin
  begin
    delete from public.crm_activities where id = '44444444-4444-4444-8444-444444444444';
  exception
    when restrict_violation then
      v_refused := true;
  end;

  insert into smoke_checks (label, ok)
  values ('ACCEPTANCE 5: a DELETE of an activity is refused', v_refused);
end $$;

insert into smoke_checks (label, ok)
values ('the activity is untouched after both attempts',
        coalesce((select channel::text = 'linkedin'
                         and actor_user_id is not null
                         and owner_user_id_at_event is not null
                    from public.crm_activities
                   where id = '44444444-4444-4444-8444-444444444444'), false));

-- ===========================================================================
-- Attribution survives reassignment.
-- ===========================================================================
update public.crm_contacts set owner_user_id = '99999999-9999-4999-8999-999999999999'
 where id = '33333333-3333-4333-8333-333333333333';

insert into smoke_checks (label, ok) values
  ('the contact now belongs to the new owner',
   coalesce((select owner_user_id = '99999999-9999-4999-8999-999999999999'
               from public.crm_contacts where id = '33333333-3333-4333-8333-333333333333'), false)),
  ('the activity still credits the owner at the time',
   coalesce((select owner_user_id_at_event = '11111111-1111-4111-8111-111111111111'
               from public.crm_activities where id = '44444444-4444-4444-8444-444444444444'), false));

-- ===========================================================================
-- ACCEPTANCE 6: erasure cascades.
-- ===========================================================================
create temp table erase_result as
select public.crm_erase_contact(
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '11111111-1111-4111-8111-111111111111',
  'test') as erased;

insert into smoke_checks (label, ok)
select 'erasure reports 1 note, 1 task, 1 activity and 1 notification removed',
       coalesce((erased ->> 'notes')::int = 1
                and (erased ->> 'tasks')::int = 1
                and (erased ->> 'activities')::int = 1
                and (erased ->> 'notifications')::int = 1, false)
  from erase_result;

-- Nothing personal remains.
insert into smoke_checks (label, ok)
select 'ACCEPTANCE 6: no contact row remains', coalesce(count(*) = 0, false)
  from public.crm_contacts where id = '33333333-3333-4333-8333-333333333333';

insert into smoke_checks (label, ok)
select 'ACCEPTANCE 6: no email remains', coalesce(count(*) = 0, false)
  from public.crm_contact_emails where contact_id = '33333333-3333-4333-8333-333333333333';

insert into smoke_checks (label, ok)
select 'ACCEPTANCE 6: no activity remains', coalesce(count(*) = 0, false)
  from public.crm_activities where contact_id = '33333333-3333-4333-8333-333333333333';

insert into smoke_checks (label, ok)
select 'ACCEPTANCE 6: no note remains', coalesce(count(*) = 0, false)
  from public.crm_notes where contact_id = '33333333-3333-4333-8333-333333333333';

insert into smoke_checks (label, ok)
select 'ACCEPTANCE 6: no task remains', coalesce(count(*) = 0, false)
  from public.crm_tasks where contact_id = '33333333-3333-4333-8333-333333333333';

insert into smoke_checks (label, ok)
select 'ACCEPTANCE 6: no notification remains', coalesce(count(*) = 0, false)
  from public.crm_notifications where refs->>'contact_id' = '33333333-3333-4333-8333-333333333333';

-- But the proof of erasure survives, carrying no personal data.
insert into smoke_checks (label, ok)
select 'one erasure audit row survives, with a target and counts',
       coalesce(count(*) = 1 and bool_and(target_id is not null and after_state is not null), false)
  from public.crm_audit_logs where action = 'crm.contact.erased';

-- And the guard is back up afterwards.
insert into public.crm_activities (workspace_id, activity_type, channel, company_id, refs)
values ('22222222-2222-4222-8222-222222222222','ENGAGEMENT','manual',null,'{"x":1}'::jsonb);

do $$
declare
  v_refused boolean := false;
begin
  begin
    update public.crm_activities set channel = 'email' where refs->>'x' = '1';
  exception
    when restrict_violation then
      v_refused := true;
  end;

  insert into smoke_checks (label, ok)
  values ('the append-only guard is back up after erasure', v_refused);
end $$;

-- ---------------------------------------------------------------------------
-- The gate.
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 14;
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
