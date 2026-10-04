-- Smoke test for 0147 — does assignment history stay in step with
-- owner_user_id on EVERY path that writes it?
--
-- ⚠️ "IT ASSIGNED SOMEBODY" PROVES NOTHING. Every check names which row, which
-- reason and which owner, and the legacy paths (a plain insert, the real 0129
-- handover, a membership delete, a user delete) are exercised directly rather
-- than through the new functions — those are the paths nobody will remember.
--
-- Run with:
--   scripts/check-migration.sh supabase/migrations/0147_crm_account_assignment.sql \
--     supabase/migrations/smoke/0147_crm_account_assignment.smoke.sql

\set ON_ERROR_STOP on

begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'sam@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'taylor@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'outsider@example.com'),
  ('55555555-5555-5555-5555-555555555555', 'leaver@example.com');

insert into public.workspaces (id, name, owner_user_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Smoke', '11111111-1111-1111-1111-111111111111');

insert into public.workspace_memberships (workspace_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'setter'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'setter'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '55555555-5555-5555-5555-555555555555', 'setter');

create temp view st as
select co.id, co.owner_user_id, s.system_key, s.slug
  from public.crm_companies co
  left join public.crm_account_statuses s on s.id = co.status_id;

-- 1. The ingestion path: a plain insert with an owner opens history and is Assigned.
insert into public.crm_companies (id, workspace_id, name, normalized_name, owner_user_id, created_by)
values ('c1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'Acme', 'acme', '22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222');
insert into smoke_checks (label, ok)
select 'insert with owner opens one assignment and is Assigned',
       coalesce((select count(a.id) = 1 from public.crm_company_assignments a
                  where a.company_id = 'c1000000-0000-4000-8000-000000000001'
                    and a.user_id = '22222222-2222-2222-2222-222222222222'
                    and a.unassigned_at is null), false)
       and coalesce((select system_key = 'assigned' from st where id = 'c1000000-0000-4000-8000-000000000001'), false);

-- 2. Without an owner it is New and unassigned.
insert into public.crm_companies (id, workspace_id, name, normalized_name)
values ('c1000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Beta', 'beta');
insert into smoke_checks (label, ok)
select 'insert without owner is New with no history',
       coalesce((select system_key = 'new' from st where id = 'c1000000-0000-4000-8000-000000000002'), false)
       and not exists (select 1 from public.crm_company_assignments
                        where company_id = 'c1000000-0000-4000-8000-000000000002');

-- 3. Assigning moves New → Assigned and records the actor.
select public.crm_assign_company('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-000000000002',
                                 '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');
insert into smoke_checks (label, ok)
select 'assign sets owner, auto-moves to Assigned, writes one activity with the actor',
       coalesce((select owner_user_id = '22222222-2222-2222-2222-222222222222' and system_key = 'assigned'
                   from st where id = 'c1000000-0000-4000-8000-000000000002'), false)
       and coalesce((select count(id) = 1 from public.crm_activities
                      where company_id = 'c1000000-0000-4000-8000-000000000002'
                        and activity_type = 'ACCOUNT_ASSIGNED'
                        and actor_user_id = '11111111-1111-1111-1111-111111111111'), false);

-- 4. Repeating it changes nothing and writes nothing.
insert into smoke_checks (label, ok)
select 'repeat assign is a no-op',
       coalesce((public.crm_assign_company('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                   'c1000000-0000-4000-8000-000000000002', '22222222-2222-2222-2222-222222222222',
                   '11111111-1111-1111-1111-111111111111') ->> 'changed')::boolean = false, false)
       and coalesce((select count(id) = 1 from public.crm_activities
                      where company_id = 'c1000000-0000-4000-8000-000000000002'), false);

-- 5. Reassigning closes the old row with the actor and reason, opens the new one.
update public.crm_companies
   set status_id = (select id from public.crm_account_statuses
                     where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and slug = 'researching')
 where id = 'c1000000-0000-4000-8000-000000000002';
select public.crm_assign_company('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-000000000002',
                                 '33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111');
insert into smoke_checks (label, ok)
select 'reassign closes old row as reassigned by the actor and opens the new one',
       coalesce((select end_reason = 'reassigned' and unassigned_by = '11111111-1111-1111-1111-111111111111'
                   from public.crm_company_assignments
                  where company_id = 'c1000000-0000-4000-8000-000000000002'
                    and user_id = '22222222-2222-2222-2222-222222222222'), false)
       and coalesce((select count(id) = 1 from public.crm_company_assignments
                      where company_id = 'c1000000-0000-4000-8000-000000000002' and unassigned_at is null
                        and user_id = '33333333-3333-3333-3333-333333333333'), false);

-- 6. A status somebody chose is not overwritten by reassignment.
insert into smoke_checks (label, ok)
select 'chosen status survives reassignment',
       coalesce((select slug = 'researching' from st where id = 'c1000000-0000-4000-8000-000000000002'), false);

-- 7. 'add' is refused while one assignee is the rule.
do $$
declare
  v_refused boolean := false;
begin
  begin
    perform public.crm_assign_company('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-000000000002',
                                      '22222222-2222-2222-2222-222222222222', null, 'add');
  exception when check_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('add refused when multiple assignees are off', v_refused);
end $$;

-- 8. So is a second open row written directly.
do $$
declare
  v_refused boolean := false;
begin
  begin
    insert into public.crm_company_assignments (workspace_id, company_id, user_id)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-000000000002',
            '22222222-2222-2222-2222-222222222222');
  exception when check_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('second active assignee refused at the table', v_refused);
end $$;

-- 9. A non-member cannot be assigned.
do $$
declare
  v_refused boolean := false;
begin
  begin
    perform public.crm_assign_company('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-000000000002',
                                      '44444444-4444-4444-4444-444444444444');
  exception when check_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('non-member assignee refused', v_refused);
end $$;

-- 10. With the setting on, 'add' keeps the primary and adds a second.
insert into public.crm_account_settings (workspace_id, allow_multiple_assignees)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select public.crm_assign_company('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-000000000002',
                                 '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'add');
insert into smoke_checks (label, ok)
select 'add keeps the primary and opens a second row',
       coalesce((select owner_user_id = '33333333-3333-3333-3333-333333333333'
                   from st where id = 'c1000000-0000-4000-8000-000000000002'), false)
       and coalesce((select count(id) = 2 from public.crm_company_assignments
                      where company_id = 'c1000000-0000-4000-8000-000000000002' and unassigned_at is null), false);

-- 11. The setting cannot be switched off under an account with two.
do $$
declare
  v_refused boolean := false;
begin
  begin
    update public.crm_account_settings set allow_multiple_assignees = false
     where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  exception when check_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('cannot disable multiple while it is in use', v_refused);
end $$;

-- 12. Unassigning the primary passes it to the remaining assignee.
select public.crm_unassign_company('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-000000000002',
                                   '33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111');
insert into smoke_checks (label, ok)
select 'unassigning the primary promotes the remaining assignee',
       coalesce((select owner_user_id = '22222222-2222-2222-2222-222222222222'
                   from st where id = 'c1000000-0000-4000-8000-000000000002'), false)
       and coalesce((select count(id) = 1 from public.crm_company_assignments
                      where company_id = 'c1000000-0000-4000-8000-000000000002' and unassigned_at is null), false);

-- 13. A legacy owner write (how 0129's handover moves companies) gets history.
update public.crm_companies set owner_user_id = '33333333-3333-3333-3333-333333333333'
 where id = 'c1000000-0000-4000-8000-000000000001';
insert into smoke_checks (label, ok)
select 'direct owner write closes the old row, opens the new, and writes the activity',
       coalesce((select end_reason = 'reassigned' from public.crm_company_assignments
                  where company_id = 'c1000000-0000-4000-8000-000000000001'
                    and user_id = '22222222-2222-2222-2222-222222222222'), false)
       and coalesce((select count(id) = 1 from public.crm_company_assignments
                      where company_id = 'c1000000-0000-4000-8000-000000000001' and unassigned_at is null
                        and user_id = '33333333-3333-3333-3333-333333333333'), false)
       and coalesce((select count(id) = 1 from public.crm_activities
                      where company_id = 'c1000000-0000-4000-8000-000000000001'
                        and activity_type = 'ACCOUNT_ASSIGNED'
                        and metadata ->> 'reason' = 'owner_changed'), false);

-- 14. Closed history is immutable.
do $$
declare
  v_refused boolean := false;
begin
  begin
    update public.crm_company_assignments set unassigned_at = now() + interval '1 day'
     where company_id = 'c1000000-0000-4000-8000-000000000001'
       and user_id = '22222222-2222-2222-2222-222222222222';
  exception when restrict_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('closed history cannot be edited', v_refused);
end $$;

-- 15. The real member handover (0129) moves the primary through the trigger.
select public.crm_handover_member_records('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
         '33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
         '11111111-1111-1111-1111-111111111111');
insert into smoke_checks (label, ok)
select 'handover moves the primary and its history',
       coalesce((select owner_user_id = '11111111-1111-1111-1111-111111111111'
                   from st where id = 'c1000000-0000-4000-8000-000000000001'), false)
       and not exists (select 1 from public.crm_company_assignments
                        where user_id = '33333333-3333-3333-3333-333333333333' and unassigned_at is null);

-- 16. A member leaving closes their secondary assignments and passes on ownership.
select public.crm_assign_company('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-000000000001',
                                 '55555555-5555-5555-5555-555555555555', null, 'add');
update public.crm_companies set owner_user_id = '55555555-5555-5555-5555-555555555555'
 where id = 'c1000000-0000-4000-8000-000000000001';
delete from public.workspace_memberships
 where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
   and user_id = '55555555-5555-5555-5555-555555555555';
insert into smoke_checks (label, ok)
select 'membership removal closes as member_removed and hands the primary on',
       coalesce((select bool_and(end_reason = 'member_removed') from public.crm_company_assignments
                  where user_id = '55555555-5555-5555-5555-555555555555'
                    and unassigned_at is not null
                    and assigned_at >= now() - interval '1 minute'), false)
       and not exists (select 1 from public.crm_company_assignments
                        where user_id = '55555555-5555-5555-5555-555555555555' and unassigned_at is null)
       and coalesce((select owner_user_id = '11111111-1111-1111-1111-111111111111'
                       from st where id = 'c1000000-0000-4000-8000-000000000001'), false);

-- 17. Deleting a user who owns an account does not fail, and leaves it unowned.
insert into public.workspace_memberships (workspace_id, user_id, role)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'setter');
insert into public.crm_companies (id, workspace_id, name, normalized_name, owner_user_id)
values ('c1000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'Gamma', 'gamma', '44444444-4444-4444-4444-444444444444');
delete from auth.users where id = '44444444-4444-4444-4444-444444444444';
insert into smoke_checks (label, ok)
select 'user deletion leaves the account unowned, back to New, with no open rows',
       coalesce((select owner_user_id is null and system_key = 'new'
                   from st where id = 'c1000000-0000-4000-8000-000000000003'), false)
       and not exists (select 1 from public.crm_company_assignments
                        where company_id = 'c1000000-0000-4000-8000-000000000003' and unassigned_at is null);

-- 18. Unassign everyone.
select public.crm_unassign_company('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c1000000-0000-4000-8000-000000000002',
                                   null, '11111111-1111-1111-1111-111111111111');
insert into smoke_checks (label, ok)
select 'unassign all leaves no owner, no open rows, and keeps a chosen status',
       coalesce((select owner_user_id is null and slug = 'researching'
                   from st where id = 'c1000000-0000-4000-8000-000000000002'), false)
       and not exists (select 1 from public.crm_company_assignments
                        where company_id = 'c1000000-0000-4000-8000-000000000002' and unassigned_at is null);

-- 19. Clients cannot call the functions.
insert into smoke_checks (label, ok)
select 'assign/unassign are service-role only',
       not has_function_privilege('authenticated', 'public.crm_assign_company(uuid,uuid,uuid,uuid,text)', 'execute')
       and not has_function_privilege('anon', 'public.crm_assign_company(uuid,uuid,uuid,uuid,text)', 'execute')
       and not has_function_privilege('authenticated', 'public.crm_unassign_company(uuid,uuid,uuid,uuid)', 'execute');

-- 20. Deleting the workspace still works with all of this in place.
delete from public.workspaces where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into smoke_checks (label, ok)
select 'workspace deletion cascades',
       not exists (select 1 from public.crm_company_assignments
                    where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

-- ---------------------------------------------------------------------------
-- The gate
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 20;
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
