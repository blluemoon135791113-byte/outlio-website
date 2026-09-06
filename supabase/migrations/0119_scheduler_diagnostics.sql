-- Why the scheduler is not firing, answerable without a SQL console.
--
-- WHY THIS EXISTS
--
-- 0118 scheduled the tick with pg_cron. It produced zero ticks, and finding
-- out why required reading `cron.job`, `cron.job_run_details` and
-- `net._http_response` -- none of which PostgREST exposes, because only
-- `public` is in the exposed schema list. So the one question that matters
-- ("is the scheduler running, and if not, what did it say?") was answerable
-- only by a human pasting queries into the dashboard.
--
-- That is the same shape as the bug this whole area keeps producing: the
-- system knows what went wrong and has no way to tell anyone.
--
-- ⚠️ SECURITY DEFINER, SO IT IS GATED IN ITS FIRST STATEMENT. It reads schemas
-- the caller cannot reach; without the admin check any authenticated user
-- could read the platform's scheduler internals.
--
-- ⚠️ DELIBERATELY DOES NOT RETURN `command`. Both `cron.job` and
-- `cron.job_run_details` store the job's SQL text, which names the Vault
-- secret. The secret VALUE is never in there -- it is looked up at call time --
-- but the safe habit is to not ship job bodies to a client at all. Likewise
-- `net._http_response.headers` and `.content` are excluded: the response body
-- is our own TickResult today, and that is not a guarantee worth relying on.
create or replace function public.scheduler_diagnostics()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, cron, net
as $$
declare
  result jsonb;
begin
  /*
   * ⚠️ `is_admin()` ALONE IS NOT ENOUGH, and not because it is too strict.
   *
   * It resolves the caller through `auth.uid()`, which is NULL for the service
   * role — so a check of `is_admin()` on its own would refuse the admin page
   * itself, which reads through `createAdminClient`. The service role already
   * bypasses RLS on every table in the database; admitting it here grants it
   * nothing it did not already have, and refusing it would only guarantee this
   * function has no working caller.
   */
  /*
   * ⚠️ THE `coalesce`s ARE THE CHECK, NOT DECORATION.
   *
   * Written as `not (is_admin() or auth.role() = 'service_role')` this gate
   * FAILS OPEN. A caller with no JWT claims at all — a direct database
   * connection rather than a request through PostgREST — gets NULL from
   * `auth.role()`, so the comparison is NULL, `false or NULL` is NULL,
   * `not NULL` is NULL, and `if NULL then` does not fire. The raise is skipped
   * and the function returns everything.
   *
   * Caught by running the function with no claims set, which is the only way
   * this shows up: it type-checks, it applies cleanly, and it refuses
   * correctly in all three of the cases you would think to try.
   */
  if not (
    coalesce(public.is_admin(), false)
    or coalesce(auth.role(), '') = 'service_role'
  ) then
    raise exception 'not authorized';
  end if;

  select jsonb_build_object(
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'jobname', j.jobname,
        'schedule', j.schedule,
        'active', j.active))
      from cron.job j
    ), '[]'::jsonb),

    'recent_job_runs', coalesce((
      select jsonb_agg(x)
      from (
        select d.status, d.return_message, d.start_time, d.end_time
        from cron.job_run_details d
        order by d.start_time desc
        limit 10
      ) x
    ), '[]'::jsonb),

    'recent_http', coalesce((
      select jsonb_agg(y)
      from (
        select r.status_code, r.error_msg, r.timed_out, r.created
        from net._http_response r
        order by r.created desc
        limit 10
      ) y
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

-- ⚠️ NOT `public`/`anon`. The function gates on is_admin() itself, but a
-- function that only refuses AFTER being entered is one edit away from not
-- refusing at all.
revoke all on function public.scheduler_diagnostics() from public;
grant execute on function public.scheduler_diagnostics() to authenticated;
grant execute on function public.scheduler_diagnostics() to service_role;
