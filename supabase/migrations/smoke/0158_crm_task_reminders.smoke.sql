-- Smoke test for 0158 — a due reminder is claimed exactly once; future,
-- completed and deleted tasks are never claimed.
--
-- Run with:
--   scripts/check-migration.sh supabase/migrations/0158_crm_task_reminders.sql \
--     supabase/migrations/smoke/0158_crm_task_reminders.smoke.sql

\set ON_ERROR_STOP on

begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'owner@example.com');
insert into public.workspaces (id, name, owner_user_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'W', '11111111-1111-1111-1111-111111111111');

insert into public.crm_tasks (id, workspace_id, title, assigned_to_user_id, remind_at, status, completed_at, deleted_at) values
  ('f0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Due',       '11111111-1111-1111-1111-111111111111', now() - interval '1 minute', 'open', null, null),
  ('f0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Future',    '11111111-1111-1111-1111-111111111111', now() + interval '1 day',    'open', null, null),
  ('f0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Done',      '11111111-1111-1111-1111-111111111111', now() - interval '1 minute', 'completed', now(), null),
  ('f0000000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Deleted',   '11111111-1111-1111-1111-111111111111', now() - interval '1 minute', 'open', null, now()),
  ('f0000000-0000-4000-8000-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'No remind', '11111111-1111-1111-1111-111111111111', null,                         'open', null, null);

create temp table first_claim as select * from public.crm_claim_due_task_reminders(50);
create temp table second_claim as select * from public.crm_claim_due_task_reminders(50);

insert into smoke_checks (label, ok) values
  ('claims only the due open task', (select array_agg(title) = array['Due'] from first_claim)),
  ('stamps reminded_at', (select reminded_at is not null from public.crm_tasks where id = 'f0000000-0000-4000-8000-000000000001')),
  ('second claim returns nothing', (select count(*) = 0 from second_claim)),
  ('future reminder untouched', (select reminded_at is null from public.crm_tasks where id = 'f0000000-0000-4000-8000-000000000002'));

select n, label, ok from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 4;
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
