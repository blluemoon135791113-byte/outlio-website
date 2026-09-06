-- The scheduler that actually fires.
--
-- WHY THIS REPLACES THE GITHUB WORKFLOW AS THE PRIMARY TRIGGER
--
-- .github/workflows/cron.yml asks for a tick every 5 minutes. Measured over
-- its last 19 scheduled runs, GitHub delivered one every 193 minutes on
-- average -- gaps ranging from 100 to 279 minutes. It never once ran close to
-- the requested interval. GitHub deprioritises scheduled workflows on free
-- tiers and drops them under load; the workflow's own comment allowed for a
-- delay "of several minutes" and was wrong by two orders of magnitude.
--
-- At ~7 ticks a day and `emailsPerTick` of 25, that capped the entire platform
-- at roughly 185 emails per day across all workspaces combined.
--
-- pg_cron runs inside the database, which is already paid for and already the
-- thing that must be up for any of this to work.
--
-- WHY EVERY 5 MINUTES AND NOT EVERY MINUTE
--
-- Vercel Hobby allows 100 GB-hours of function duration per month. A tick
-- takes 6-13 seconds. Once a minute is ~43,000 invocations a month and roughly
-- 120 GB-hours -- over the limit, which would take down the whole app to make
-- the scheduler prompt. Once every 5 minutes is ~24 GB-hours.
--
-- ⚠️ REQUIRES A SECRET THAT IS NOT IN THIS FILE. Store it first:
--
--   select vault.create_secret(
--     '<the CRON_SECRET value from Vercel>',
--     'outlio_cron_secret',
--     'Bearer token for /api/cron');
--
-- The secret is never written into a migration, a job definition, or a URL.
-- The job reads it from Vault at call time. /api/cron fails closed, so if the
-- secret is missing or wrong every request is refused and the admin panel
-- shows the scheduler as stale -- loudly wrong rather than quietly broken.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent: re-running this migration replaces the schedule rather than
-- stacking a second copy of it.
select cron.unschedule(jobid)
from cron.job
where jobname = 'outlio-background-tick';

select cron.schedule(
  'outlio-background-tick',
  '*/5 * * * *',
  $job$
  select net.http_get(
    url := 'https://app.outlio.io/api/cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- ⚠️ IN A HEADER, NEVER THE QUERY STRING. URLs get logged.
      'Authorization',
      'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'outlio_cron_secret'
      )
    ),
    -- ⚠️ THE DEFAULT IS 5 SECONDS, AND A TICK TAKES 6-13. Left at the default
    -- this would abort every single call before it finished. 55s sits just
    -- under the route's 60s maxDuration.
    timeout_milliseconds := 55000
  );
  $job$
);
