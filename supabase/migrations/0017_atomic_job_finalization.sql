-- 0017 — atomic upload finalization and audited account suspension
--
-- Finalizing an upload previously used three separate RPCs. Concurrent retries
-- could spend more than one credit, and a later queue failure could leave a
-- charged job that was never runnable. Keep the state transition, billing,
-- usage counters, and queue insertion in one database transaction.

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

  v_credits_left := public.consume_credit(
    p_user_id,
    1,
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

-- Suspending an account and writing its audit record must also be atomic.
create or replace function public.set_user_suspension(
  p_user_id  uuid,
  p_admin_id uuid,
  p_suspend  boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
begin
  if p_user_id = p_admin_id then
    raise exception 'An admin cannot suspend their own account';
  end if;

  select to_jsonb(p)
    into v_before
    from (
      select role, suspended_at, suspended_reason
        from public.profiles
       where id = p_user_id
       for update
    ) p;

  if v_before is null then
    raise exception 'No such user: %', p_user_id;
  end if;

  update public.profiles
     set suspended_at = case when p_suspend then now() else null end,
         suspended_reason = case when p_suspend then 'Suspended by admin' else null end,
         role = case
           -- `suspended_at` is the access boundary. Preserve the user's real
           -- role so unsuspending a subscriber does not silently remove their
           -- paid entitlement. Only normalize rows created by the legacy flow.
           when not p_suspend and role = 'suspended_user'
             then 'registered_user'::public.user_role
           else role
         end
   where id = p_user_id;

  insert into public.admin_audit_logs (
    admin_id, action, target_type, target_id, target_user_id,
    before_state, after_state, reason
  ) values (
    p_admin_id,
    case when p_suspend then 'user.suspend' else 'user.unsuspend' end,
    'profile',
    p_user_id,
    p_user_id,
    v_before,
    jsonb_build_object('suspended', p_suspend),
    case when p_suspend then 'Suspended by admin' else 'Unsuspended by admin' end
  );
end;
$$;

revoke all on function public.set_user_suspension(uuid, uuid, boolean)
  from public, anon, authenticated;
