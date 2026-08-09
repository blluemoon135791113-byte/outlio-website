-- 0021: claim the job that triggered a worker wake-up
--
-- claim_next_job remains available to a future long-lived queue worker. This
-- targeted claim is for Vercel after() callbacks: a newly finalized upload must
-- start its own job rather than claim one unrelated older queue row.

create or replace function public.claim_job(
  p_job_id uuid,
  p_user_id uuid,
  p_claimed_by text
)
returns table (job_id uuid, user_id uuid, attempts int)
language sql
security definer
set search_path = public
as $$
  with claimed as (
    update public.job_queue q
       set status = 'claimed',
           claimed_at = now(),
           claimed_by = left(p_claimed_by, 200),
           attempts = q.attempts + 1
      from public.extraction_jobs j
     where q.job_id = p_job_id
       and j.id = q.job_id
       and j.user_id = p_user_id
       and q.status = 'pending'
       and q.next_attempt_at <= now()
       and q.attempts < q.max_attempts
    returning q.job_id, q.attempts
  ), marked as (
    update public.extraction_jobs j
       set status = 'processing',
           started_at = coalesce(j.started_at, now()),
           progress_step = 'Processing files'
      from claimed c
     where j.id = c.job_id
    returning j.id, j.user_id
  )
  select m.id, m.user_id, c.attempts
    from marked m
    join claimed c on c.job_id = m.id;
$$;

revoke all on function public.claim_job(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_job(uuid, uuid, text) to service_role;
