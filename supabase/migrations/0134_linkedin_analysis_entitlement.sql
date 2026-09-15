-- ---------------------------------------------------------------------------
-- 0134 — the strategy-analysis entitlement, as a migration.
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  Owner, 2026-09-15: "that analysis feature would be for premium users     ║
-- ║  only and admin".                                                         ║
-- ║                                                                           ║
-- ║  ⚠️ A MIGRATION AND NOT A SCRATCH `UPDATE`, WHICH IS 0127'S ENTIRE LESSON. ║
-- ║  `linkedin_enabled` was applied by hand, never written down, and later     ║
-- ║  found missing — with a sender CAP sitting on a plan that was not          ║
-- ║  entitled to the module at all. Nothing could detect it, because there     ║
-- ║  was no record the key was meant to exist.                                ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠️ "PREMIUM" IS NOT A PLAN IN THIS PRODUCT, so it had to be interpreted. The
-- plans are trial, starter, professional, agency and custom. The reading taken
-- here, and the reason for each:
--
--   professional, custom — YES. They are the paid tiers that carry
--     `linkedin_enabled` (0127), and a report about a TEAM's messaging needs a
--     team, which is what those tiers sell.
--
--   trial — NO, and this is the one worth arguing about. Trial DOES carry
--     `linkedin_enabled`, so this is the first place the two diverge. The
--     analysis reads whatever outreach exists, and a trial workspace has days
--     of it — `caveatFor` would open every report with "only 3 actions have
--     been recorded, too few to compute a reply rate". Shipping the premium
--     feature's worst possible showing as its first impression sells it badly.
--
--   starter — NO, matching 0127: LinkedIn is the reason to move up a tier.
--
--   agency — NO. `is_active = false` and its limits blob is already malformed
--     (missing `credits_per_month`, which makes `getPlanById` throw). Adding a
--     key to a blob that already breaks its reader would make it look more
--     complete than it is. Still the owner's to fix.
--
-- ⚠️ IF THAT READING IS WRONG, THE FIX IS ANOTHER MIGRATION, NOT AN UPDATE
-- TYPED INTO THE EDITOR. That is how the last one was lost.
--
-- ⚠️ `|| limits` PUTS THE EXISTING BLOB ON THE RIGHT, matching 0103 and 0127:
-- the right-hand side wins, so a value already set in production is PRESERVED
-- and this only fills a gap. Reversing it would silently reset a per-plan
-- override made since.
-- ---------------------------------------------------------------------------

update public.plans
set limits = jsonb_build_object('linkedin_analysis_enabled', true) || limits
where key in ('professional', 'custom');

/*
 * ⚠️ THE ENTITLEMENT MUST NOT OUTLIVE THE MODULE IT REPORTS ON. A plan with
 * `linkedin_analysis_enabled` and no `linkedin_enabled` would show a manager a
 * premium analysis screen for a channel their workspace cannot use — the same
 * mismatched shape 0127 found in production, where a sender cap sat on a plan
 * with no entitlement.
 *
 * Raised rather than silently corrected: which of the two keys is wrong is a
 * decision about what was sold, and this migration cannot make it.
 */
do $$
declare
  broken text;
begin
  select string_agg(key::text, ', ')
    into broken
    from public.plans
   where (limits ->> 'linkedin_analysis_enabled')::boolean is true
     and coalesce((limits ->> 'linkedin_enabled')::boolean, false) is not true;

  if broken is not null then
    raise exception
      'Plans entitled to LinkedIn analysis but not to LinkedIn itself: %. '
      'Fix the pair in one statement — 0127 exists because they were split.',
      broken;
  end if;
end $$;

/*
 * ⚠️ `key::text` IN THE `string_agg` ABOVE. `plans.key` is the enum
 * `public.plan_key`, and `string_agg(key, ', ')` fails with
 * "function string_agg(plan_key, unknown) does not exist" — which is exactly
 * how 0127 reached the SQL editor broken. `0059:199` was the prior art nobody
 * followed.
 */
