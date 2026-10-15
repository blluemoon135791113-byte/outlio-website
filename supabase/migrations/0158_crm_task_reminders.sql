-- 0158 — task reminders (Opportunities board, owner request 2026-10-15)
--
-- "Remind me to follow up with John on Thursday at 10:00." A task already has
-- `due_at`; a reminder is a separate, explicit time because most tasks do not
-- want one, and firing on `due_at` would have reminded every existing open
-- task the moment this shipped.
--
-- Delivery is the 5-minute cron tick: it claims due reminders through
-- `crm_claim_due_task_reminders`, which stamps `reminded_at` in the same
-- statement so two overlapping ticks can never send one reminder twice.

alter table public.crm_tasks
  add column if not exists remind_at   timestamptz,
  add column if not exists reminded_at timestamptz;

comment on column public.crm_tasks.remind_at is
  'When to notify the assignee. NULL = no reminder. Fired once by the cron tick.';
comment on column public.crm_tasks.reminded_at is
  'Set when the reminder was claimed for delivery; never cleared except when remind_at changes.';

-- The tick's only query: open, unsent, due.
create index if not exists crm_tasks_reminder_due_idx
  on public.crm_tasks (remind_at)
  where remind_at is not null
    and reminded_at is null
    and status = 'open'
    and deleted_at is null;

create or replace function public.crm_claim_due_task_reminders(p_limit integer)
returns table (
  id                  uuid,
  workspace_id        uuid,
  assigned_to_user_id uuid,
  title               text,
  contact_id          uuid,
  opportunity_id      uuid,
  remind_at           timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  with due as (
    select t.id
    from public.crm_tasks t
    where t.remind_at is not null
      and t.remind_at <= now()
      and t.reminded_at is null
      and t.status = 'open'
      and t.deleted_at is null
    order by t.remind_at
    limit greatest(1, least(p_limit, 500))
    for update skip locked
  )
  update public.crm_tasks t
     set reminded_at = now()
    from due
   where t.id = due.id
  returning t.id, t.workspace_id, t.assigned_to_user_id, t.title,
            t.contact_id, t.opportunity_id, t.remind_at;
$$;

revoke all on function public.crm_claim_due_task_reminders(integer) from public, anon, authenticated;
grant execute on function public.crm_claim_due_task_reminders(integer) to service_role;
