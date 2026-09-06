-- ===========================================================================
-- OUTLIO — PENDING MIGRATIONS (0103)
-- Updated 2026-09-01
--
-- ⚠️ THE PLATFORM IS CURRENTLY OFF FOR EVERY PAYING CUSTOMER.
--
-- `resolveModules` adds a module only when `plans.limits` says so, and no plan
-- row has ever carried these keys. `planLimitsSchema` defaults the absent ones
-- to FALSE for crm/email/flows/reports and `workspace_member_limit` to 1. So
-- M2 through M9 are invisible to everyone except platform staff, who bypass
-- the plan entirely -- which is exactly why it went unnoticed: every screen
-- worked whenever staff looked at it.
--
-- This also subsumes Q6 (team invitations refused everywhere), which was one
-- symptom of the same root cause.
--
-- ⚠️ READ THE PACKAGING BEFORE APPLYING. Which module belongs to which tier,
-- and how many seats each gets, is YOUR pricing decision, not a technical
-- fact. Edit the numbers freely. The only part that is not a matter of taste
-- is that they must be set at all.
--
-- Recommended, and what this file does:
--
--   plan                     crm  email  flows  reports  integr  hubble  seats
--   trial (3 days)            Y     N      N       Y       Y       Y       1
--   starter "Lead Engine"     Y     N      N       Y       Y       Y       2
--   professional "Pro"        Y     Y      Y       Y       Y       Y       5
--   custom "Pro + Hubble"     Y     Y      Y       Y       Y       Y      10
--   agency (inactive)         Y     Y      Y       Y       Y       Y      25
--
-- The trial deliberately cannot send email: a free trial that can send cold
-- mail is a spam vector aimed at us, and the complaints land on Outlio's own
-- domain reputation and on every paying customer's deliverability.
--
-- NON-DESTRUCTIVE AND IDEMPOTENT: `jsonb_build_object(...) || limits` puts the
-- existing value last, so anything already set by hand wins and re-running
-- changes nothing.
--
-- SMOKE-TESTED: correct values per plan, unrelated limits untouched, a
-- hand-set value survives a re-run, and the closing guard proves it fires for
-- a plan with no entitlements.
--
-- AFTER APPLYING: npm run db:types  (no schema change, but keeps it in step)
-- ===========================================================================

-- 0103 — turn the platform on for the plans that include it (M9)
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  THE WHOLE PLATFORM IS CURRENTLY OFF FOR EVERY PAYING CUSTOMER.          ║
-- ║                                                                           ║
-- ║  `resolveModules` adds a module only when `plans.limits` says so, and no  ║
-- ║  plan row has ever carried these keys. `planLimitsSchema` defaults the    ║
-- ║  absent ones to FALSE for crm/email/flows/reports, and                    ║
-- ║  `workspace_member_limit` to 1.                                           ║
-- ║                                                                           ║
-- ║  That default was RIGHT while the platform was being built: existing      ║
-- ║  Lead Engine customers had to keep behaving exactly as before, and a      ║
-- ║  half-finished CRM must not appear in their account. It is wrong now that ║
-- ║  the modules exist -- M2 through M9 are invisible to everyone except      ║
-- ║  platform staff, who bypass the plan entirely.                            ║
-- ║                                                                           ║
-- ║  Only platform admins could see any of it, which is exactly why this went ║
-- ║  unnoticed: every screen worked when staff looked at it.                  ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠️ THE PACKAGING BELOW IS A RECOMMENDATION, NOT A TECHNICAL FACT. Which
-- module belongs to which tier, and how many seats each gets, is a pricing
-- decision. The values are gathered in one place per plan so they are trivial
-- to change; the ONLY part that is not a matter of taste is that they must be
-- set at all.
--
-- ⚠️ NON-DESTRUCTIVE AND IDEMPOTENT. `jsonb_build_object(...) || limits` puts
-- the EXISTING value last, so anything already set by hand wins and re-running
-- this changes nothing. It only fills in keys that are absent.

-- ---------------------------------------------------------------------------
-- Free trial — 3 days, 10 credits
--
-- ⚠️ DELIBERATELY NO EMAIL. A free trial that can send cold email is a spam
-- vector aimed at us: someone signs up, blasts a list, and the resulting
-- complaints land on Outlio's own reputation and on the deliverability of
-- every paying customer sharing our infrastructure. The trial exists to show
-- the product, and the CRM shows it.
-- ---------------------------------------------------------------------------
update public.plans
set limits = jsonb_build_object(
      'crm_enabled',            true,
      'email_enabled',          false,
      'flows_enabled',          false,
      'reports_enabled',        true,
      'integrations_enabled',   true,
      'hubble_enabled',         true,
      'workspace_member_limit', 1
    ) || limits
where key = 'trial';

-- ---------------------------------------------------------------------------
-- Lead Engine (starter) — 100 credits
--
-- Named for what it is. CRM and reports make the extracted leads useful;
-- email and flows are the reason to move up a tier.
-- ---------------------------------------------------------------------------
update public.plans
set limits = jsonb_build_object(
      'crm_enabled',            true,
      'email_enabled',          false,
      'flows_enabled',          false,
      'reports_enabled',        true,
      'integrations_enabled',   true,
      'hubble_enabled',         true,
      'workspace_member_limit', 2
    ) || limits
where key = 'starter';

-- ---------------------------------------------------------------------------
-- Pro — 300 credits. The full platform.
-- ---------------------------------------------------------------------------
update public.plans
set limits = jsonb_build_object(
      'crm_enabled',            true,
      'email_enabled',          true,
      'flows_enabled',          true,
      'reports_enabled',        true,
      'integrations_enabled',   true,
      'hubble_enabled',         true,
      'workspace_member_limit', 5
    ) || limits
where key = 'professional';

-- ---------------------------------------------------------------------------
-- Pro + Hubble (custom) — 1,000 credits.
-- ---------------------------------------------------------------------------
update public.plans
set limits = jsonb_build_object(
      'crm_enabled',            true,
      'email_enabled',          true,
      'flows_enabled',          true,
      'reports_enabled',        true,
      'integrations_enabled',   true,
      'hubble_enabled',         true,
      'workspace_member_limit', 10
    ) || limits
where key = 'custom';

-- ---------------------------------------------------------------------------
-- Agency — still `is_active = false` and described as pending final pricing.
-- Entitlements are set anyway so that activating it is a pricing decision
-- alone, not a pricing decision plus a forgotten entitlement bug.
-- ---------------------------------------------------------------------------
update public.plans
set limits = jsonb_build_object(
      'crm_enabled',            true,
      'email_enabled',          true,
      'flows_enabled',          true,
      'reports_enabled',        true,
      'integrations_enabled',   true,
      'hubble_enabled',         true,
      'workspace_member_limit', 25
    ) || limits
where key = 'agency';

-- ---------------------------------------------------------------------------
-- ⚠️ REFUSE TO FINISH IF A PLAN WAS MISSED.
--
-- A plan added later, or a key renamed, would leave a tier silently switched
-- off -- and the symptom is a customer who paid and sees nothing, which is the
-- failure this migration exists to end. Better to fail here than to ship it.
-- ---------------------------------------------------------------------------
do $$
declare missing text;
begin
  select string_agg(key::text, ', ')
  into missing
  from public.plans
  where not (limits ? 'crm_enabled')
     or not (limits ? 'workspace_member_limit');

  if missing is not null then
    raise exception 'plans still missing module entitlements: %', missing;
  end if;
end
$$;
