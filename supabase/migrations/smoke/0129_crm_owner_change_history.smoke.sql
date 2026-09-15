-- Smoke test for 0129 — bulk assignment and member handover leave history.
--
-- ⚠️ GATED: every check goes through coalesce(..., false) into smoke_checks, and
-- the final block raises unless exactly the expected number were recorded and
-- all are true.
--
-- ⚠️ A SECOND WORKSPACE HOLDS THE SAME PEOPLE'S RECORDS. Both functions run
-- with the service role and trust the workspace id they are given; the other
-- workspace is what proves they touch nothing outside it.
--
-- ⚠️ EVERY RUN IS CAUGHT AND RECORDED, NOT LEFT TO ABORT THE SCRIPT. A
-- function that raises part way — as one that let another workspace's contact
-- reach crm_assign_contact_owner would — must show up as named failed checks.
-- An aborted script says nothing about which rule broke, and a mutation run
-- cannot tell it from a syntax error.
--
-- Run it with:
--   scripts/check-migration.sh supabase/migrations/0129_crm_owner_change_history.sql \
--     supabase/migrations/smoke/0129_crm_owner_change_history.smoke.sql

\set ON_ERROR_STOP on

begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
) on commit drop;

create temp table ran (
  label text primary key,
  res   jsonb not null
) on commit drop;

-- People: M owns both workspaces. L is leaving W. S takes over. X is an outsider to W.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'owner.m@example.com'),
  ('00000000-0000-4000-8000-0000000000a1', 'leaver.l@example.com'),
  ('00000000-0000-4000-8000-0000000000b1', 'successor.s@example.com'),
  ('00000000-0000-4000-8000-0000000000f1', 'outsider.x@example.com');

insert into public.workspaces (id, name, owner_user_id) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'W', '00000000-0000-4000-8000-00000000000a'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'O', '00000000-0000-4000-8000-00000000000a');

-- X belongs to O only, so X is a real user and a member somewhere — just not of W.
insert into public.workspace_memberships (workspace_id, user_id, role) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'owner'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'setter'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000b1', 'manager'),
  ('bbbbbbbb-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000a', 'owner'),
  ('bbbbbbbb-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a1', 'setter'),
  ('bbbbbbbb-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000f1', 'setter');

/*
 * Contacts in W: k1, k2 owned by L; k3 by S; k4 by L but deleted; k5 unowned.
 * In O: k9 owned by L.
 */
insert into public.crm_contacts (id, workspace_id, full_name, owner_user_id, source, deleted_at) values
  ('c0000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'K1', '00000000-0000-4000-8000-0000000000a1', 'manual', null),
  ('c0000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'K2', '00000000-0000-4000-8000-0000000000a1', 'manual', null),
  ('c0000000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'K3', '00000000-0000-4000-8000-0000000000b1', 'manual', null),
  ('c0000000-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000001', 'K4', '00000000-0000-4000-8000-0000000000a1', 'manual', now()),
  ('c0000000-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000001', 'K5', null,                                   'manual', null),
  ('c0000000-0000-4000-8000-000000000009', 'bbbbbbbb-0000-4000-8000-000000000002', 'K9', '00000000-0000-4000-8000-0000000000a1', 'manual', null);

insert into public.crm_companies (id, workspace_id, name, normalized_name, owner_user_id, source) values
  ('c0c00000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Leaver Co', 'leaver co', '00000000-0000-4000-8000-0000000000a1', 'manual'),
  ('c0c00000-0000-4000-8000-000000000009', 'bbbbbbbb-0000-4000-8000-000000000002', 'Other Co',  'other co',  '00000000-0000-4000-8000-0000000000a1', 'manual');

insert into public.crm_pipelines (id, workspace_id, name) values
  ('aaaaaaaa-1111-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Sales W'),
  ('bbbbbbbb-1111-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002', 'Sales O');

insert into public.crm_pipeline_stages (id, workspace_id, pipeline_id, name, kind, sort_order) values
  ('aaaaaaaa-2222-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-1111-4000-8000-000000000001', 'New', 'open', 1),
  ('bbbbbbbb-2222-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-1111-4000-8000-000000000002', 'New', 'open', 1);

insert into public.crm_opportunities (id, workspace_id, pipeline_id, stage_id, title, owner_user_id) values
  ('aaaaaaaa-3333-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-1111-4000-8000-000000000001', 'aaaaaaaa-2222-4000-8000-000000000001', 'Deal W', '00000000-0000-4000-8000-0000000000a1'),
  ('bbbbbbbb-3333-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-1111-4000-8000-000000000002', 'bbbbbbbb-2222-4000-8000-000000000002', 'Deal O', '00000000-0000-4000-8000-0000000000a1');

/*
 * Tasks in W: t1 open (about k1), t2 open and snoozed, t3 completed, t4 open
 * but S's, t5 open but deleted. In O: t9 open. All but t4 are L's.
 */
insert into public.crm_tasks (id, workspace_id, contact_id, title, assigned_to_user_id, status, snoozed_until, completed_at, deleted_at, created_by) values
  ('7a500000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Call K1',   '00000000-0000-4000-8000-0000000000a1', 'open',      null,                     null,  null,  '00000000-0000-4000-8000-0000000000a1'),
  ('7a500000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', null,                                   'Snoozed',   '00000000-0000-4000-8000-0000000000a1', 'open',      now() + interval '3 days', null,  null,  '00000000-0000-4000-8000-0000000000a1'),
  ('7a500000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', null,                                   'Done',      '00000000-0000-4000-8000-0000000000a1', 'completed', null,                     now(), null,  '00000000-0000-4000-8000-0000000000a1'),
  ('7a500000-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000001', null,                                   'S''s task', '00000000-0000-4000-8000-0000000000b1', 'open',      null,                     null,  null,  '00000000-0000-4000-8000-0000000000b1'),
  ('7a500000-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000001', null,                                   'Deleted',   '00000000-0000-4000-8000-0000000000a1', 'open',      null,                     null,  now(), '00000000-0000-4000-8000-0000000000a1'),
  ('7a500000-0000-4000-8000-000000000009', 'bbbbbbbb-0000-4000-8000-000000000002', null,                                   'Other',     '00000000-0000-4000-8000-0000000000a1', 'open',      null,                     null,  null,  '00000000-0000-4000-8000-0000000000a1');

-- ===========================================================================
-- Bulk assignment
-- ===========================================================================
do $$
declare v boolean := false;
begin
  begin
    perform public.crm_bulk_assign_contacts(
      'aaaaaaaa-0000-4000-8000-000000000001',
      array(select gen_random_uuid() from generate_series(1, 201)),
      '00000000-0000-4000-8000-0000000000b1',
      '00000000-0000-4000-8000-00000000000a'
    );
  exception when invalid_parameter_value then v := true;
  end;
  insert into smoke_checks (label, ok) values ('bulk: more than 200 contacts is refused', v);
end $$;

do $$
declare v boolean := false;
begin
  begin
    perform public.crm_bulk_assign_contacts(
      'aaaaaaaa-0000-4000-8000-000000000001',
      array['c0000000-0000-4000-8000-000000000005']::uuid[],
      '00000000-0000-4000-8000-0000000000f1',
      '00000000-0000-4000-8000-00000000000a'
    );
  exception when check_violation then v := true;
  end;
  insert into smoke_checks (label, ok)
  select 'bulk: an owner from outside the workspace is refused, and nothing changes',
         v and (select owner_user_id from public.crm_contacts where id = 'c0000000-0000-4000-8000-000000000005') is null
           and not exists (select 1 from public.crm_activities where contact_id = 'c0000000-0000-4000-8000-000000000005');
end $$;

/*
 * k5 (unowned) moves; k3 is already S's; k4 is deleted; k9 is another
 * workspace's; the last id exists nowhere. One change, one no-op, three skips.
 */
do $$
declare v jsonb;
begin
  begin
    v := public.crm_bulk_assign_contacts(
  'aaaaaaaa-0000-4000-8000-000000000001',
  array[
    'c0000000-0000-4000-8000-000000000005',
    'c0000000-0000-4000-8000-000000000003',
    'c0000000-0000-4000-8000-000000000004',
    'c0000000-0000-4000-8000-000000000009',
    'deadbeef-0000-4000-8000-000000000000'
  ]::uuid[],
  '00000000-0000-4000-8000-0000000000b1',
  '00000000-0000-4000-8000-00000000000a'
);
  exception when others then
    v := jsonb_build_object('raised', sqlerrm);
  end;
  insert into ran values ('bulk', v);
end $$;

insert into smoke_checks (label, ok)
select 'bulk: reports one changed, one already theirs, three skipped',
       coalesce((res ->> 'changed')::int = 1 and (res ->> 'unchanged')::int = 1 and (res ->> 'skipped')::int = 3, false)
  from ran where label = 'bulk';

insert into smoke_checks (label, ok)
select 'bulk: only the contact that changed is listed for announcement, with its previous owner',
       coalesce(jsonb_array_length(res -> 'assignments') = 1
                and res -> 'assignments' -> 0 ->> 'contact_id' = 'c0000000-0000-4000-8000-000000000005'
                and res -> 'assignments' -> 0 -> 'from' = 'null'::jsonb
                and (res -> 'assignments' -> 0 ->> 'activity_id') is not null, false)
  from ran where label = 'bulk';

insert into smoke_checks (label, ok)
select 'bulk: the change wrote OWNER_ASSIGNED from nobody to S, by M, and the activity is the one listed',
       exists (
         select 1 from public.crm_activities a, ran r
          where r.label = 'bulk'
            and a.id::text = r.res -> 'assignments' -> 0 ->> 'activity_id'
            and a.contact_id = 'c0000000-0000-4000-8000-000000000005'
            and a.activity_type = 'OWNER_ASSIGNED'
            and a.actor_user_id = '00000000-0000-4000-8000-00000000000a'
            and a.metadata -> 'from' = 'null'::jsonb
            and a.metadata ->> 'to' = '00000000-0000-4000-8000-0000000000b1'
       )
       and (select owner_user_id from public.crm_contacts where id = 'c0000000-0000-4000-8000-000000000005') = '00000000-0000-4000-8000-0000000000b1';

insert into smoke_checks (label, ok)
select 'bulk: the already-theirs, deleted and other-workspace contacts kept their owners and gained no history',
       (select count(id) from public.crm_activities
         where contact_id in ('c0000000-0000-4000-8000-000000000003',
                              'c0000000-0000-4000-8000-000000000004',
                              'c0000000-0000-4000-8000-000000000009')) = 0
       and (select owner_user_id from public.crm_contacts where id = 'c0000000-0000-4000-8000-000000000004') = '00000000-0000-4000-8000-0000000000a1'
       and (select owner_user_id from public.crm_contacts where id = 'c0000000-0000-4000-8000-000000000009') = '00000000-0000-4000-8000-0000000000a1';

do $$
declare v jsonb;
begin
  begin
    v := public.crm_bulk_assign_contacts(
  'aaaaaaaa-0000-4000-8000-000000000001',
  array['c0000000-0000-4000-8000-000000000005']::uuid[],
  null,
  '00000000-0000-4000-8000-00000000000a'
);
  exception when others then
    v := jsonb_build_object('raised', sqlerrm);
  end;
  insert into ran values ('unassign', v);
end $$;

insert into smoke_checks (label, ok)
select 'bulk: unassigning writes history too, to nobody',
       coalesce((res ->> 'changed')::int = 1, false)
       and (select owner_user_id from public.crm_contacts where id = 'c0000000-0000-4000-8000-000000000005') is null
       and exists (
         select 1 from public.crm_activities
          where contact_id = 'c0000000-0000-4000-8000-000000000005'
            and activity_type = 'OWNER_ASSIGNED'
            and metadata ->> 'from' = '00000000-0000-4000-8000-0000000000b1'
            and metadata -> 'to' = 'null'::jsonb
       )
  from ran where label = 'unassign';

-- ===========================================================================
-- Member handover
-- ===========================================================================
do $$
declare v boolean := false;
begin
  begin
    perform public.crm_handover_member_records(
      'aaaaaaaa-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-0000000000a1',
      '00000000-0000-4000-8000-0000000000f1',
      '00000000-0000-4000-8000-00000000000a'
    );
  exception when check_violation then v := true;
  end;
  insert into smoke_checks (label, ok)
  select 'handover: to someone outside the workspace is refused, and nothing moves',
         v and (select owner_user_id from public.crm_contacts where id = 'c0000000-0000-4000-8000-000000000001') = '00000000-0000-4000-8000-0000000000a1'
           and (select assigned_to_user_id from public.crm_tasks where id = '7a500000-0000-4000-8000-000000000001') = '00000000-0000-4000-8000-0000000000a1'
           and (select owner_user_id from public.crm_companies where id = 'c0c00000-0000-4000-8000-000000000001') = '00000000-0000-4000-8000-0000000000a1';
end $$;

do $$
declare v jsonb;
begin
  begin
    v := public.crm_handover_member_records(
  'aaaaaaaa-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-0000000000a1',
  '00000000-0000-4000-8000-0000000000b1',
  '00000000-0000-4000-8000-00000000000a'
);
  exception when others then
    v := jsonb_build_object('raised', sqlerrm);
  end;
  insert into ran values ('handover', v);
end $$;

insert into smoke_checks (label, ok)
select 'handover: counts three contacts (one deleted), one company, one deal, three open tasks (one deleted)',
       coalesce((res ->> 'contacts')::int = 3 and (res ->> 'companies')::int = 1
                and (res ->> 'opportunities')::int = 1 and (res ->> 'tasks')::int = 3, false)
  from ran where label = 'handover';

insert into smoke_checks (label, ok)
select 'handover: every contact L owned in W is now S''s, the deleted one included',
       (select count(id) from public.crm_contacts
         where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000001'
           and owner_user_id = '00000000-0000-4000-8000-0000000000a1') = 0
       and (select owner_user_id from public.crm_contacts where id = 'c0000000-0000-4000-8000-000000000004') = '00000000-0000-4000-8000-0000000000b1';

insert into smoke_checks (label, ok)
select 'handover: each live contact wrote OWNER_ASSIGNED from L to S by M; the deleted one wrote nothing',
       (select count(id) from public.crm_activities
         where contact_id in ('c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002')
           and activity_type = 'OWNER_ASSIGNED'
           and actor_user_id = '00000000-0000-4000-8000-00000000000a'
           and metadata ->> 'from' = '00000000-0000-4000-8000-0000000000a1'
           and metadata ->> 'to' = '00000000-0000-4000-8000-0000000000b1') = 2
       and (select count(id) from public.crm_activities
             where contact_id = 'c0000000-0000-4000-8000-000000000004') = 0;

insert into smoke_checks (label, ok)
select 'handover: both live contacts are listed for announcement',
       coalesce(jsonb_array_length(res -> 'assignments') = 2, false)
  from ran where label = 'handover';

insert into smoke_checks (label, ok)
select 'handover: open tasks moved and the snooze was cleared; the completed and S''s tasks were not touched',
       (select assigned_to_user_id from public.crm_tasks where id = '7a500000-0000-4000-8000-000000000001') = '00000000-0000-4000-8000-0000000000b1'
       and (select assigned_to_user_id from public.crm_tasks where id = '7a500000-0000-4000-8000-000000000002') = '00000000-0000-4000-8000-0000000000b1'
       and (select snoozed_until from public.crm_tasks where id = '7a500000-0000-4000-8000-000000000002') is null
       and (select assigned_to_user_id from public.crm_tasks where id = '7a500000-0000-4000-8000-000000000003') = '00000000-0000-4000-8000-0000000000a1'
       and (select assigned_to_user_id from public.crm_tasks where id = '7a500000-0000-4000-8000-000000000005') = '00000000-0000-4000-8000-0000000000b1';

insert into smoke_checks (label, ok)
select 'handover: the two live tasks wrote TASK_REASSIGNED, and t1''s records L as the contact''s owner at the time',
       (select count(id) from public.crm_activities
         where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000001'
           and activity_type = 'TASK_REASSIGNED'
           and metadata ->> 'reason' = 'member_handover') = 2
       and exists (
         select 1 from public.crm_activities
          where activity_type = 'TASK_REASSIGNED'
            and refs ->> 'task_id' = '7a500000-0000-4000-8000-000000000001'
            and owner_user_id_at_event = '00000000-0000-4000-8000-0000000000a1'
            and metadata ->> 'to' = '00000000-0000-4000-8000-0000000000b1'
       )
       and not exists (
         select 1 from public.crm_activities where refs ->> 'task_id' = '7a500000-0000-4000-8000-000000000005'
       );

insert into smoke_checks (label, ok)
select 'handover: the company and the deal moved to S',
       (select owner_user_id from public.crm_companies where id = 'c0c00000-0000-4000-8000-000000000001') = '00000000-0000-4000-8000-0000000000b1'
       and (select owner_user_id from public.crm_opportunities where id = 'aaaaaaaa-3333-4000-8000-000000000001') = '00000000-0000-4000-8000-0000000000b1';

insert into smoke_checks (label, ok)
select 'handover: L''s records in the other workspace are untouched',
       (select owner_user_id from public.crm_contacts where id = 'c0000000-0000-4000-8000-000000000009') = '00000000-0000-4000-8000-0000000000a1'
       and (select owner_user_id from public.crm_companies where id = 'c0c00000-0000-4000-8000-000000000009') = '00000000-0000-4000-8000-0000000000a1'
       and (select owner_user_id from public.crm_opportunities where id = 'bbbbbbbb-3333-4000-8000-000000000002') = '00000000-0000-4000-8000-0000000000a1'
       and (select assigned_to_user_id from public.crm_tasks where id = '7a500000-0000-4000-8000-000000000009') = '00000000-0000-4000-8000-0000000000a1';

-- A resubmitted removal must do nothing a second time.
do $$
declare v jsonb;
begin
  begin
    v := public.crm_handover_member_records(
  'aaaaaaaa-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-0000000000a1',
  '00000000-0000-4000-8000-0000000000b1',
  '00000000-0000-4000-8000-00000000000a'
);
  exception when others then
    v := jsonb_build_object('raised', sqlerrm);
  end;
  insert into ran values ('handover-again', v);
end $$;

insert into smoke_checks (label, ok)
select 'handover: running it again moves nothing and writes no history',
       coalesce((res ->> 'contacts')::int = 0 and (res ->> 'tasks')::int = 0
                and jsonb_array_length(res -> 'assignments') = 0, false)
       and (select count(id) from public.crm_activities
             where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000001'
               and activity_type in ('OWNER_ASSIGNED', 'TASK_REASSIGNED')) = 6
  from ran where label = 'handover-again';

-- With no successor, in O: records are unassigned, with history.
do $$
declare v jsonb;
begin
  begin
    v := public.crm_handover_member_records(
  'bbbbbbbb-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-0000000000a1',
  null,
  '00000000-0000-4000-8000-00000000000a'
);
  exception when others then
    v := jsonb_build_object('raised', sqlerrm);
  end;
  insert into ran values ('to-nobody', v);
end $$;

insert into smoke_checks (label, ok)
select 'handover: to nobody unassigns contacts and tasks, and still records it',
       coalesce((res ->> 'contacts')::int = 1 and (res ->> 'tasks')::int = 1, false)
       and (select owner_user_id from public.crm_contacts where id = 'c0000000-0000-4000-8000-000000000009') is null
       and (select assigned_to_user_id from public.crm_tasks where id = '7a500000-0000-4000-8000-000000000009') is null
       and exists (
         select 1 from public.crm_activities
          where contact_id = 'c0000000-0000-4000-8000-000000000009'
            and activity_type = 'OWNER_ASSIGNED'
            and metadata -> 'to' = 'null'::jsonb
       )
  from ran where label = 'to-nobody';

-- ---------------------------------------------------------------------------
-- Who may run them
-- ---------------------------------------------------------------------------
insert into smoke_checks (label, ok)
select 'only the service role can run either function',
       has_function_privilege('service_role', 'public.crm_bulk_assign_contacts(uuid,uuid[],uuid,uuid)', 'execute')
       and not has_function_privilege('authenticated', 'public.crm_bulk_assign_contacts(uuid,uuid[],uuid,uuid)', 'execute')
       and not has_function_privilege('anon', 'public.crm_bulk_assign_contacts(uuid,uuid[],uuid,uuid)', 'execute')
       and has_function_privilege('service_role', 'public.crm_handover_member_records(uuid,uuid,uuid,uuid)', 'execute')
       and not has_function_privilege('authenticated', 'public.crm_handover_member_records(uuid,uuid,uuid,uuid)', 'execute')
       and not has_function_privilege('anon', 'public.crm_handover_member_records(uuid,uuid,uuid,uuid)', 'execute');

-- ---------------------------------------------------------------------------
-- The gate
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 19;
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
