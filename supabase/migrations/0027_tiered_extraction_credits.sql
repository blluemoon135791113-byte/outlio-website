-- 0027 — tiered extraction credits
--
-- Until now every extraction cost exactly 1 credit regardless of how many files
-- it processed, so a 30-file Pro run and a 1-file run were billed the same. An
-- extraction is now charged per BLOCK of files, and the block size is a plan
-- limit (`files_per_credit`) read at runtime like every other limit.
--
--   cost = ceil(file_count / files_per_credit), minimum 1
--
-- With the file ceilings already in `files_per_extraction`:
--
--   trial         5 files  / block 5   → 1 credit at the 5-file max
--   starter      10 files  / block 5   → 1 credit for 1-5, 2 credits for 6-10
--   professional 30 files  / block 10  → 1 / 2 / 3 credits across 10-file blocks
--   custom       50 files  / block 10  → 1 … 5 credits across 10-file blocks
--
-- A NULL or zero `files_per_credit` keeps the old behaviour: 1 credit per run.
-- Exports are unchanged — still a flat 1 credit per download.

update public.plans
   set limits = limits || jsonb_build_object('files_per_credit', 5)
 where key in ('trial', 'starter');

update public.plans
   set limits = limits || jsonb_build_object('files_per_credit', 10)
 where key in ('professional', 'custom');

-- Legacy/deactivated tiers keep a flat cost rather than failing limit parsing.
update public.plans
   set limits = limits || jsonb_build_object('files_per_credit', null)
 where not (limits ? 'files_per_credit');

-- ---------------------------------------------------------------------------
-- extraction_credit_cost
--
-- The single definition of the tiering arithmetic on the database side. The
-- application mirrors it in lib/limits/credits.ts for display only; this
-- function is what actually bills.
-- ---------------------------------------------------------------------------

create or replace function public.extraction_credit_cost(
  p_file_count       int,
  p_files_per_credit int
)
returns int
language sql
immutable
set search_path = public
as $$
  select greatest(
    1,
    coalesce(
      ceil(greatest(coalesce(p_file_count, 0), 0)::numeric
           / nullif(greatest(coalesce(p_files_per_credit, 0), 0), 0))::int,
      1
    )
  );
$$;

revoke all on function public.extraction_credit_cost(int, int)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- finalize_upload_job — unchanged except that the credit charge is now tiered.
--
-- The charge still happens inside the same transaction as the state change and
-- the queue insert, so a retry can never double-charge and a failed charge can
-- never leave a runnable job.
-- ---------------------------------------------------------------------------

create or replace function public.finalize_upload_job(
  p_job_id  uuid,
  p_user_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status          public.job_status;
  v_file_count      int;
  v_files_per_credit int;
  v_credit_cost     int;
  v_credits_left    int;
  v_month_start     timestamptz := date_trunc('month', now());
  v_month_end       timestamptz := date_trunc('month', now()) + interval '1 month';
  v_day_start       timestamptz := date_trunc('day', now());
  v_day_end         timestamptz := date_trunc('day', now()) + interval '1 day';
begin
  select status
    into v_status
    from public.extraction_jobs
   where id = p_job_id
     and user_id = p_user_id
   for update;

  if not found then
    return 'not_found';
  end if;

  -- A client may retry after losing the first response. Never charge twice.
  if v_status in ('queued', 'processing', 'completed', 'partially_completed') then
    return 'already_finalized';
  end if;

  if v_status <> 'uploaded' then
    return 'invalid_state';
  end if;

  select count(*)::int
    into v_file_count
    from public.uploaded_files
   where extraction_job_id = p_job_id
     and user_id = p_user_id
     and deleted_at is null;

  if v_file_count = 0 then
    update public.extraction_jobs
       set status = 'failed',
           error_code = 'ERR_STORAGE',
           error_message = 'No files were uploaded successfully.'
     where id = p_job_id;
    return 'no_files';
  end if;

  -- Block size comes from plans.limits, never from application code.
  select (p.limits ->> 'files_per_credit')::int
    into v_files_per_credit
    from public.profiles pr
    join public.plans p on p.id = pr.plan_id
   where pr.id = p_user_id;

  v_credit_cost := public.extraction_credit_cost(v_file_count, v_files_per_credit);

  v_credits_left := public.consume_credit(
    p_user_id,
    v_credit_cost,
    v_month_start,
    v_month_end
  );

  if v_credits_left < 0 then
    update public.extraction_jobs
       set status = 'failed',
           error_code = 'ERR_LIMIT_REACHED',
           error_message = 'Not enough credits.'
     where id = p_job_id;
    return 'insufficient_credits';
  end if;

  perform public.increment_usage(
    p_user_id, 'files', v_month_start, v_month_end, v_file_count
  );
  perform public.increment_usage(
    p_user_id, 'extractions', v_month_start, v_month_end, 1
  );
  perform public.increment_usage(
    p_user_id, 'extractions', v_day_start, v_day_end, 1
  );

  insert into public.job_queue (job_id, status, next_attempt_at)
  values (p_job_id, 'pending', now())
  on conflict (job_id) do nothing;

  update public.extraction_jobs
     set status = 'queued',
         file_count = v_file_count,
         progress_step = 'Waiting in queue',
         progress_current = 0,
         progress_total = v_file_count
   where id = p_job_id;

  return 'ok';
end;
$$;

revoke all on function public.finalize_upload_job(uuid, uuid)
  from public, anon, authenticated;
