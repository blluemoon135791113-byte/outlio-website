-- 0045 — research job queue
--
-- Mirrors the extraction queue from 0013 exactly: FOR UPDATE SKIP LOCKED,
-- attempts, exponential backoff, and a stale-claim reaper. That pattern is
-- already proven in production here, and a second, subtly different queue is
-- how one of them ends up with a bug the other does not have.
--
-- WHY A QUEUE AT ALL: a research run over a few hundred companies takes minutes
-- and spends money. It must survive the browser closing, must never run twice
-- for one request, and a run cut short by a function timeout must be
-- recoverable — which is exactly what `reap_stale_research_runs` is for.

create table if not exists public.research_job_queue (
  id              uuid primary key default gen_random_uuid(),
  research_run_id uuid not null unique
                    references public.research_runs(id) on delete cascade,
  status          public.queue_status not null default 'pending',
  attempts        int not null default 0,
  max_attempts    int not null default 3,
  claimed_at      timestamptz,
  claimed_by      text,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists research_job_queue_set_updated_at on public.research_job_queue;
create trigger research_job_queue_set_updated_at
  before update on public.research_job_queue
  for each row execute function public.set_updated_at();

create index if not exists research_job_queue_claim_idx
  on public.research_job_queue (status, next_attempt_at)
  where status = 'pending';
create index if not exists research_job_queue_stale_idx
  on public.research_job_queue (status, claimed_at)
  where status = 'claimed';

-- RLS ENABLED, NO POLICIES → denies every non-service-role client, exactly as
-- job_queue does. Only the runner touches this table.
alter table public.research_job_queue enable row level security;
revoke all on table public.research_job_queue from public, anon, authenticated;
grant select, insert, update, delete on table public.research_job_queue to service_role;

-- ---------------------------------------------------------------------------
-- enqueue_research_run
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_research_run(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.research_job_queue (research_run_id, status, next_attempt_at)
  values (p_run_id, 'pending', now())
  on conflict (research_run_id) do nothing;

  update public.research_runs
     set status = 'pending'
   where id = p_run_id
     and status in ('pending', 'planning');
end;
$$;

revoke all on function public.enqueue_research_run(uuid) from public, anon, authenticated;
grant execute on function public.enqueue_research_run(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- claim_research_run — the exact run that caused this wake-up.
--
-- `attempts` must be qualified: RETURNS TABLE declares an OUT parameter of the
-- same name, and a bare reference raises at runtime. That bug cost a debugging
-- session in 0013; the comment stays so it is not rediscovered.
-- ---------------------------------------------------------------------------

create or replace function public.claim_research_run(
  p_run_id     uuid,
  p_user_id    uuid,
  p_claimed_by text
)
returns table (research_run_id uuid, user_id uuid, attempts int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue_id uuid;
begin
  select q.id
    into v_queue_id
    from public.research_job_queue q
    join public.research_runs r on r.id = q.research_run_id
   where q.research_run_id = p_run_id
     and r.user_id = p_user_id
     and q.status = 'pending'
     and q.next_attempt_at <= now()
     and q.attempts < q.max_attempts
   for update of q skip locked
   limit 1;

  if v_queue_id is null then
    return;
  end if;

  update public.research_job_queue
     set status     = 'claimed',
         claimed_at = now(),
         claimed_by = p_claimed_by,
         attempts   = public.research_job_queue.attempts + 1
   where id = v_queue_id;

  -- `user_id` MUST be qualified. RETURNS TABLE declares an OUT parameter of the
  -- same name, so a bare reference is ambiguous and raises at runtime — the
  -- same trap `claim_next_job` hit with `attempts` in 0013.
  update public.research_runs
     set status     = 'running',
         started_at = coalesce(public.research_runs.started_at, now())
   where public.research_runs.id = p_run_id
     and public.research_runs.user_id = p_user_id;

  return query
    select r.id, r.user_id, q.attempts
      from public.research_runs r
      join public.research_job_queue q on q.research_run_id = r.id
     where r.id = p_run_id;
end;
$$;

revoke all on function public.claim_research_run(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_research_run(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- claim_next_research_run — for a polling worker, when one exists.
-- ---------------------------------------------------------------------------

create or replace function public.claim_next_research_run(p_claimed_by text)
returns table (research_run_id uuid, user_id uuid, attempts int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue_id uuid;
  v_run_id   uuid;
begin
  select q.id, q.research_run_id
    into v_queue_id, v_run_id
    from public.research_job_queue q
   where q.status = 'pending'
     and q.next_attempt_at <= now()
     and q.attempts < q.max_attempts
   order by q.next_attempt_at
   for update skip locked
   limit 1;

  if v_queue_id is null then
    return;
  end if;

  update public.research_job_queue
     set status     = 'claimed',
         claimed_at = now(),
         claimed_by = p_claimed_by,
         attempts   = public.research_job_queue.attempts + 1
   where id = v_queue_id;

  update public.research_runs
     set status     = 'running',
         started_at = coalesce(public.research_runs.started_at, now())
   where public.research_runs.id = v_run_id;

  return query
    select r.id, r.user_id, q.attempts
      from public.research_runs r
      join public.research_job_queue q on q.research_run_id = r.id
     where r.id = v_run_id;
end;
$$;

revoke all on function public.claim_next_research_run(text)
  from public, anon, authenticated;
grant execute on function public.claim_next_research_run(text) to service_role;

-- ---------------------------------------------------------------------------
-- reap_stale_research_runs
--
-- NOT OPTIONAL. `after()` on Vercel can be cut short by a function timeout,
-- leaving a run 'claimed' forever with no worker to recover it. This is the
-- only thing that returns it to the queue.
--
-- Explicit ::queue_status casts — a bare string literal in a CASE is text and
-- Postgres will not coerce it into the enum column.
-- ---------------------------------------------------------------------------

create or replace function public.reap_stale_research_runs(p_timeout_seconds int default 900)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  with stale as (
    select id, research_run_id, attempts, max_attempts
      from public.research_job_queue
     where status = 'claimed'
       and claimed_at < now() - make_interval(secs => p_timeout_seconds)
     for update skip locked
  ),
  requeued as (
    update public.research_job_queue q
       set status = case
                      when s.attempts >= s.max_attempts then 'failed'::public.queue_status
                      else 'pending'::public.queue_status
                    end,
           claimed_at = null,
           claimed_by = null,
           -- Exponential backoff, capped so a run is not deferred for hours.
           next_attempt_at = now() + make_interval(secs => least(60 * (2 ^ s.attempts), 900)),
           last_error = coalesce(q.last_error, 'reclaimed after stale claim')
      from stale s
     where q.id = s.id
    returning q.research_run_id, q.status
  )
  update public.research_runs r
     set status = case
                    when rq.status = 'failed' then 'failed'
                    else 'pending'
                  end,
         error_code = case when rq.status = 'failed' then 'ERR_TIMEOUT' else null end
    from requeued rq
   where r.id = rq.research_run_id;

  get diagnostics v_count = row_count;
  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.reap_stale_research_runs(int)
  from public, anon, authenticated;
grant execute on function public.reap_stale_research_runs(int) to service_role;
