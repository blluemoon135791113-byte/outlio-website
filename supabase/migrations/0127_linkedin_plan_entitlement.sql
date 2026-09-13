-- ---------------------------------------------------------------------------
-- 0127 — The LinkedIn module entitlement, as a migration rather than a scratch
--        UPDATE typed into the SQL editor.
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  THIS IS WHY `linkedin_enabled` WENT MISSING.                             ║
-- ║                                                                           ║
-- ║  It was applied by hand and never written down. `linkedin_senders_max`    ║
-- ║  was applied by hand a second time, from a file that had been overwritten  ║
-- ║  in between. The result was a plan carrying a sender CAP for a module it   ║
-- ║  was not ENTITLED to — a shape no code path expects, because no code path  ║
-- ║  creates it.                                                              ║
-- ║                                                                           ║
-- ║  Every other module entitlement in this product is in 0103. This one was   ║
-- ║  not, so nothing could tell that it was missing: not a test, not a fresh   ║
-- ║  environment, not a reviewer reading the migrations in order. A fresh      ║
-- ║  Supabase project would have replayed 0002..0126 and produced a database   ║
-- ║  where LinkedIn is off for everyone, correctly, permanently, and silently. ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠️ THE TWO KEYS ARE SET IN ONE STATEMENT PER PLAN, ON PURPOSE. Entitlement
-- and cap answer one question — "may this workspace connect LinkedIn senders,
-- and how many" — and the answer must not be assemblable from two separate
-- runs. Split across statements, a partial apply leaves a cap with no
-- entitlement (what happened) or an entitlement with no cap (unbounded, worse).
--
-- ⚠️ `|| limits` PUTS THE EXISTING BLOB ON THE RIGHT, matching 0103's direction:
-- the right-hand side wins, so a value already set in production is PRESERVED
-- and this migration only fills gaps. Reversing it would silently reset any
-- per-plan override made since. Verified on Postgres 16:
--   '{"a":1}'::jsonb || '{"b":2}'::jsonb  ->  {"a": 1, "b": 2}
--   '{"a":1}'::jsonb || '{"a":9}'::jsonb  ->  {"a": 9}
--
-- Not entitled, deliberately:
--   starter — LinkedIn outreach is the reason to move up a tier, exactly as
--             email and flows are in 0103.
--   agency  — `is_active = false` and its limits blob is already malformed
--             (missing `credits_per_month`, which makes `getPlanById` throw).
--             Adding keys to a blob that already breaks the reader would make
--             that blob look more complete than it is. Left for the owner.
-- ---------------------------------------------------------------------------

update public.plans
set limits = jsonb_build_object(
      'linkedin_enabled',     true,
      'linkedin_senders_max', 2
    ) || limits
where key = 'trial';

update public.plans
set limits = jsonb_build_object(
      'linkedin_enabled',     true,
      'linkedin_senders_max', 10
    ) || limits
where key = 'professional';

update public.plans
set limits = jsonb_build_object(
      'linkedin_enabled',     true,
      'linkedin_senders_max', 20
    ) || limits
where key = 'custom';

-- ---------------------------------------------------------------------------
-- ⚠️ FAIL LOUDLY IF THE PAIR IS SPLIT.
--
-- The failure this migration exists to repair was invisible: a SELECT showed
-- a sender cap and a NULL entitlement side by side and nothing objected. This
-- makes the database object. It is cheap, it runs once, and it converts the
-- exact state that wasted an afternoon into an error with a name.
-- ---------------------------------------------------------------------------
do $$
declare
  split_count int;
  offenders   text;
begin
  select count(*), string_agg(key, ', ' order by key)
    into split_count, offenders
    from public.plans
   where (limits ? 'linkedin_enabled') <> (limits ? 'linkedin_senders_max');

  if split_count > 0 then
    raise exception
      'LinkedIn entitlement and sender cap are split on plan(s): %. '
      'A plan with a cap but no entitlement reads as "LinkedIn is off" while '
      'carrying a number that says otherwise; a plan with an entitlement but '
      'no cap connects senders without limit. Set both or neither.',
      offenders;
  end if;
end
$$;
