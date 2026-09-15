-- Smoke test for 0076. Proves what only execution can:
--   * the optimistic lock actually refuses a stale card
--   * a stage move writes EXACTLY ONE activity, and a retry writes none
--   * stage history and time-in-stage are recorded
--   * won/lost rules are enforced at the moment of closing
--
-- ⚠️ EVERY CHECK IS RECORDED, THEN GATED. This file used to print values for a
-- person to read, and its must-fail moves ran with ON_ERROR_STOP lifted, so a
-- move that wrongly SUCCEEDED passed silently. Each check now goes into
-- `smoke_checks` through `coalesce(…, false)`, and the gate at the end raises
-- unless exactly the expected number were recorded and every one is true.
--
-- ⚠️ A STALE VERSION RAISES serialization_failure HERE. 0077 later changes that
-- to check_violation, but this file runs against 0076 alone.
--
-- Run it with:
--   scripts/check-migration.sh supabase/migrations/0076_crm_opportunities.sql \
--     supabase/smoke/0076_opportunities.sql

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
   'Deal Contact','99999999-9999-4999-8999-999999999999');

insert into public.crm_pipelines (id, workspace_id, name, is_default) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','Sales',true);

insert into public.crm_pipeline_stages (id, workspace_id, pipeline_id, name, kind, sort_order, default_probability) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','New','open',1,10),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Demo','open',2,50),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3','22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Won','won',3,100),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4','22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Lost','lost',4,0);

-- A second pipeline, to prove a cross-pipeline move is refused.
insert into public.crm_pipelines (id, workspace_id, name) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','22222222-2222-4222-8222-222222222222','Other');
insert into public.crm_pipeline_stages (id, workspace_id, pipeline_id, name, sort_order) values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','22222222-2222-4222-8222-222222222222','cccccccc-cccc-4ccc-8ccc-cccccccccccc','Elsewhere',1);

insert into public.crm_opportunities
  (id, workspace_id, title, contact_id, owner_user_id, pipeline_id, stage_id, value_amount, currency, probability)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','22222222-2222-4222-8222-222222222222',
        'Acme renewal','33333333-3333-4333-8333-333333333333',
        '99999999-9999-4999-8999-999999999999',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
        12500.50,'USD',10);

-- ===========================================================================
-- A normal move.
-- ===========================================================================
create temp table move_result as
select public.crm_move_opportunity_stage(
  '22222222-2222-4222-8222-222222222222','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 1,
  '11111111-1111-4111-8111-111111111111') as moved;

insert into smoke_checks (label, ok)
select 'the move returns version 2, still open',
       coalesce((moved ->> 'version')::int = 2 and moved ->> 'status' = 'open', false)
  from move_result;

insert into smoke_checks (label, ok) values
  ('probability picked up the Demo stage default of 50',
   coalesce((select probability = 50 from public.crm_opportunities
              where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'), false)),
  ('the card is at version 2 and still open',
   coalesce((select version = 2 and status::text = 'open' from public.crm_opportunities
              where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'), false));

insert into smoke_checks (label, ok)
select 'the move wrote exactly one STAGE_CHANGED activity carrying the deal',
       coalesce(count(*) = 1 and bool_and(activity_type::text = 'STAGE_CHANGED'), false)
  from public.crm_activities
 where refs->>'opportunity_id' = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

insert into smoke_checks (label, ok)
select 'one stage-history row, timed, with the owner frozen',
       coalesce(count(*) = 1
                and bool_and(from_stage_id is not null
                             and seconds_in_previous_stage is not null
                             and owner_user_id_at_event = '99999999-9999-4999-8999-999999999999'), false)
  from public.crm_opportunity_stage_history
 where opportunity_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

-- ===========================================================================
-- ACCEPTANCE 2: a retry of the same move writes NOTHING.
-- ===========================================================================
do $$
declare
  v_stale boolean := false;
  v_same  boolean := false;
  v_cross boolean := false;
  v_lost  boolean := false;
begin
  begin
    perform public.crm_move_opportunity_stage(
      '22222222-2222-4222-8222-222222222222','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 1,
      '11111111-1111-4111-8111-111111111111');
  exception
    when serialization_failure then
      v_stale := true;
  end;

  begin
    perform public.crm_move_opportunity_stage(
      '22222222-2222-4222-8222-222222222222','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 2,
      '11111111-1111-4111-8111-111111111111');
  exception
    when check_violation then
      v_same := true;
  end;

  begin
    perform public.crm_move_opportunity_stage(
      '22222222-2222-4222-8222-222222222222','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 2,
      '11111111-1111-4111-8111-111111111111');
  exception
    when check_violation then
      v_cross := true;
  end;

  begin
    perform public.crm_move_opportunity_stage(
      '22222222-2222-4222-8222-222222222222','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4', 2,
      '11111111-1111-4111-8111-111111111111');
  exception
    when check_violation then
      v_lost := true;
  end;

  insert into smoke_checks (label, ok) values
    ('ACCEPTANCE 2: a stale version is refused', v_stale),
    ('a move to the stage it is already in is refused', v_same),
    ('a cross-pipeline move is refused', v_cross),
    ('losing without a reason is refused', v_lost);
end $$;

insert into smoke_checks (label, ok)
select 'still exactly one activity after four refused attempts', coalesce(count(*) = 1, false)
  from public.crm_activities
 where refs->>'opportunity_id' = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

-- ===========================================================================
-- Closing won.
-- ===========================================================================
do $$
begin
  perform public.crm_move_opportunity_stage(
    '22222222-2222-4222-8222-222222222222','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', 2,
    '11111111-1111-4111-8111-111111111111');
end $$;

insert into smoke_checks (label, ok) values
  ('closing won sets status won, probability 100 and a close time',
   coalesce((select status::text = 'won' and probability = 100 and closed_at is not null
               from public.crm_opportunities where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'), false)),
  ('the won card is at version 3 with its value unchanged',
   coalesce((select version = 3 and value_amount = 12500.50
               from public.crm_opportunities where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'), false));

insert into smoke_checks (label, ok)
select 'the win is its own activity type, beside the one stage change',
       coalesce(count(*) = 2
                and count(*) filter (where activity_type::text = 'OPPORTUNITY_WON') = 1
                and count(*) filter (where activity_type::text = 'STAGE_CHANGED') = 1, false)
  from public.crm_activities
 where refs->>'opportunity_id' = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

-- ===========================================================================
-- Stage history is append-only.
-- ===========================================================================
do $$
declare
  v_refused boolean := false;
begin
  begin
    update public.crm_opportunity_stage_history set to_stage_id = null;
  exception
    when restrict_violation then
      v_refused := true;
  end;

  insert into smoke_checks (label, ok)
  values ('stage history refuses an UPDATE', v_refused);
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
