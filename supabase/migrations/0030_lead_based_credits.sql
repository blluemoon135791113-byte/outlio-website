-- 0030 — extraction credits are billed by LEAD, not by file
--
-- Until now an extraction was charged per block of FILES (0027), which meant a
-- 25-lead page and a 3-lead page cost the same. Credits are now charged per
-- block of LEADS, aggregated across the whole run:
--
--   cost = ceil(lead_count / leads_per_credit), minimum 1
--
-- "Aggregated across the run" is the point: three files holding 10 leads each
-- is 30 leads = 2 credits, NOT 3 credits. You consume credits by leads, never
-- by files.
--
-- With leads_per_credit = 25 on every active plan:
--
--   trial          10 credits →    250 leads / month
--   starter       100 credits →  2,500 leads / month
--   professional  300 credits →  7,500 leads / month
--   custom       1000 credits → 25,000 leads / month
--
-- ---------------------------------------------------------------------------
-- WHEN THE CHARGE HAPPENS — this is the structural change
-- ---------------------------------------------------------------------------
--
-- A file's lead count does not exist until the file is parsed, so the charge
-- can no longer happen at upload time. The flow is now:
--
--   finalize_upload_job()      pre-flight only: is there at least 1 credit?
--                              enqueues. CHARGES NOTHING.
--   worker parses every file   lead count now known
--   charge_extraction_leads()  the real charge, before any lead row is
--                              inserted and before the CSV is written
--
-- If the user cannot afford the run, charge_extraction_leads returns
-- 'insufficient_credits', nothing is charged, and the worker fails the job
-- WITHOUT delivering a partial export. The user is never billed for output
-- they did not receive, and the balance can never go negative.
--
-- Idempotency: extraction_jobs.credits_charged is written in the same
-- statement that spends the credits. A retried job sees it set and returns
-- 'already_charged' without spending again. The `after()` trigger retries
-- twice and the stale-claim reaper can re-run a job, so this matters.

-- ---------------------------------------------------------------------------
-- 1. Plan limits and pricing
-- ---------------------------------------------------------------------------

-- Every active plan bills at 25 leads per credit. files_per_credit is dead.
update public.plans
   set limits = (limits - 'files_per_credit')
                || jsonb_build_object('leads_per_credit', 25)
 where key in ('trial', 'starter', 'professional', 'custom');

-- Legacy/deactivated tiers keep a flat 1 credit per run rather than failing
-- limit parsing.
update public.plans
   set limits = (limits - 'files_per_credit')
                || jsonb_build_object('leads_per_credit', null)
 where not (limits ? 'leads_per_credit');

-- Monthly lead ceilings. credits_per_month x 25 is the same number, so credits
-- bind first in practice; records_per_month is the explicit cap that retires
-- the plan (enforced in lib/auth/decide.ts) and the figure shown on the
-- dashboard.
update public.plans
   set limits = limits || jsonb_build_object(
         'credits_per_month',     10,
         'records_per_month',     250,
         'extractions_per_day',   null,
         'extractions_per_month', null
       )
 where key = 'trial';

update public.plans
   set name        = 'Lead Engine',
       description = '$28/month · 100 credits · 2,500 leads',
       limits      = limits || jsonb_build_object(
         'credits_per_month',     100,
         'records_per_month',     2500,
         'extractions_per_day',   null,
         'extractions_per_month', null
       )
 where key = 'starter';

update public.plans
   set name        = 'Pro',
       description = '$43/month · 300 credits · 7,500 leads',
       limits      = limits || jsonb_build_object(
         'credits_per_month',     300,
         'records_per_month',     7500,
         'extractions_per_day',   null,
         'extractions_per_month', null
       )
 where key = 'professional';

update public.plans
   set name        = 'Custom',
       description = '25,000+ leads/month · contact us',
       limits      = limits || jsonb_build_object(
         'credits_per_month',     1000,
         'records_per_month',     25000,
         'extractions_per_day',   null,
         'extractions_per_month', null
       )
 where key = 'custom';

-- ---------------------------------------------------------------------------
-- 2. lead_credit_cost — the single definition of the arithmetic
--
-- lib/limits/credits.ts mirrors this for quoting in the UI. THIS is what bills.
-- ---------------------------------------------------------------------------

create or replace function public.lead_credit_cost(
  p_lead_count       int,
  p_leads_per_credit int
)
returns int
language sql
immutable
set search_path = public
as $$
  select greatest(
    1,
    coalesce(
      ceil(greatest(coalesce(p_lead_count, 0), 0)::numeric
           / nullif(greatest(coalesce(p_leads_per_credit, 0), 0), 0))::int,
      1
    )
  );
$$;

revoke all on function public.lead_credit_cost(int, int)
  from public, anon, authenticated;

-- The file-based cost function has no callers left.
drop function if exists public.extraction_credit_cost(int, int);

-- ---------------------------------------------------------------------------
-- 3. Where the charge is recorded
-- ---------------------------------------------------------------------------

alter table public.extraction_jobs
  add column if not exists credits_charged int;

comment on column public.extraction_jobs.credits_charged is
  'Credits spent on this run, written by charge_extraction_leads once the lead '
  'count is known. NULL means not yet charged. Non-NULL makes a retry a no-op.';

-- ---------------------------------------------------------------------------
-- 4. finalize_upload_job — pre-flight gate only, no charge
--
-- Still one transaction with the queue insert, so a retry can never enqueue
-- twice and a rejected run can never leave a runnable job.
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
  v_status       public.job_status;
  v_file_count   int;
  v_role         public.user_role;
  v_allowance    int;
  v_used         int;
  v_month_start  timestamptz := date_trunc('month', now());
  v_month_end    timestamptz := date_trunc('month', now()) + interval '1 month';
  v_day_start    timestamptz := date_trunc('day', now());
  v_day_end      timestamptz := date_trunc('day', now()) + interval '1 day';
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

  -- A client may retry after losing the first response.
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

  -- Pre-flight: refuse to queue work the user provably cannot pay for. The
  -- real cost is unknown until the files are parsed, so this only catches an
  -- exhausted balance. charge_extraction_leads does the exact arithmetic.
  select role into v_role from public.profiles where id = p_user_id;

  if v_role <> 'admin' then
    select (p.limits ->> 'credits_per_month')::int
      into v_allowance
      from public.profiles pr
      join public.plans p on p.id = pr.plan_id
     where pr.id = p_user_id;

    -- NULL allowance means unlimited; skip the gate entirely.
    if v_allowance is not null then
      v_allowance := v_allowance + public.granted_credits(p_user_id, v_month_start);

      select coalesce(count, 0)::int
        into v_used
        from public.usage_counters
       where user_id = p_user_id
         and metric = 'credits'
         and period_start = v_month_start;

      if coalesce(v_used, 0) >= v_allowance then
        update public.extraction_jobs
           set status = 'failed',
               error_code = 'ERR_LIMIT_REACHED',
               error_message = 'No extraction credits left this month.'
         where id = p_job_id;
        return 'insufficient_credits';
      end if;
    end if;
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

-- ---------------------------------------------------------------------------
-- 5. charge_extraction_leads — the real charge
--
-- Called by the worker once every file has been parsed and BEFORE any lead row
-- is inserted or any CSV is written. Returns one row:
--
--   status   'ok' | 'already_charged' | 'insufficient_credits' | 'not_found'
--   charged  credits actually spent on this run
--   required credits the run needs (set on insufficient_credits so the user
--            can be told the exact shortfall)
--   left     credits remaining after the spend
-- ---------------------------------------------------------------------------

create or replace function public.charge_extraction_leads(
  p_job_id     uuid,
  p_user_id    uuid,
  p_lead_count int
)
returns table (status text, charged int, required int, credits_left int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_already          int;
  v_leads_per_credit int;
  v_cost             int;
  v_left             int;
  v_month_start      timestamptz := date_trunc('month', now());
  v_month_end        timestamptz := date_trunc('month', now()) + interval '1 month';
begin
  select credits_charged
    into v_already
    from public.extraction_jobs
   where id = p_job_id
     and user_id = p_user_id
   for update;

  if not found then
    status := 'not_found'; charged := 0; required := 0; credits_left := 0;
    return next;
    return;
  end if;

  -- Replay of an already-billed run: never charge twice.
  if v_already is not null then
    status := 'already_charged'; charged := v_already; required := v_already;
    credits_left := 0;
    return next;
    return;
  end if;

  -- Nothing parsed means nothing delivered, so nothing is owed. The worker
  -- fails the job separately.
  if coalesce(p_lead_count, 0) <= 0 then
    status := 'ok'; charged := 0; required := 0; credits_left := 0;
    return next;
    return;
  end if;

  select (p.limits ->> 'leads_per_credit')::int
    into v_leads_per_credit
    from public.profiles pr
    join public.plans p on p.id = pr.plan_id
   where pr.id = p_user_id;

  v_cost := public.lead_credit_cost(p_lead_count, v_leads_per_credit);

  v_left := public.consume_credit(p_user_id, v_cost, v_month_start, v_month_end);

  if v_left < 0 then
    -- consume_credit already rolled its own spend back. Nothing is charged and
    -- credits_charged stays NULL, so a later retry with a smaller batch works.
    status := 'insufficient_credits'; charged := 0; required := v_cost;
    credits_left := 0;
    return next;
    return;
  end if;

  update public.extraction_jobs
     set credits_charged = v_cost
   where id = p_job_id
     and user_id = p_user_id;

  -- Leads are the billable unit, so they are also the metered one. This is
  -- what records_per_month is measured against.
  perform public.increment_usage(
    p_user_id, 'records', v_month_start, v_month_end, p_lead_count
  );

  status := 'ok'; charged := v_cost; required := v_cost; credits_left := v_left;
  return next;
end;
$$;

revoke all on function public.charge_extraction_leads(uuid, uuid, int)
  from public, anon, authenticated;
