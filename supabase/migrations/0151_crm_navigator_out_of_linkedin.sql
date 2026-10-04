-- ---------------------------------------------------------------------------
-- 0151 — Finish the 0145 transition: Sales Navigator ids leave the LinkedIn column
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  ⚠️ APPLY THIS AFTER THE STEP-2 CODE IS DEPLOYED — NOT BEFORE.            ║
-- ║                                                                           ║
-- ║  The reverse of the usual rule, and on purpose. Code from before step 2   ║
-- ║  writes Navigator addresses into `linkedin_url`; the CHECK added below    ║
-- ║  refuses that, so applying early would make lead ingestion fail on every  ║
-- ║  Navigator-identified company. Step-2 code writes the Navigator column    ║
-- ║  and reads both, so it works before AND after this migration.             ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- 0145 COPIED each Navigator id into `normalized_sales_navigator_url` and left
-- it in `normalized_linkedin_url` too, because the code then running matched
-- on that column. This clears the duplicate, retires the mirror trigger, and
-- adds the CHECK that keeps the two kinds of address apart from now on.
--
-- NO VALUE IS LOST: a LinkedIn-column value is cleared only where it is
-- byte-identical to the Navigator column. Anything else raises and the whole
-- migration rolls back (production on 2026-10-01: 44 rows, all identical).
--
-- `updated_at` is left alone: GET /api/v1/companies keeps returning the same
-- `linkedin_url` (it falls back to the Navigator address), so to an API
-- consumer nothing about these accounts changed.
--
-- ⚠️ VALIDATE BEFORE APPLYING:
--   scripts/check-migration.sh supabase/migrations/0151_crm_navigator_out_of_linkedin.sql \
--     supabase/migrations/smoke/0151_crm_navigator_out_of_linkedin.smoke.sql
--
-- ROLLBACK (puts the duplicates back, and the mirror with them):
--   alter table public.crm_companies drop constraint if exists crm_companies_linkedin_is_public;
--   alter table public.crm_companies disable trigger crm_companies_set_updated_at;
--   update public.crm_companies
--      set linkedin_url = sales_navigator_url, normalized_linkedin_url = normalized_sales_navigator_url
--    where normalized_linkedin_url is null and normalized_sales_navigator_url is not null;
--   alter table public.crm_companies enable trigger crm_companies_set_updated_at;
--   then re-run the mirror function and trigger section of 0145.
--   ⚠️ The restore can collide with crm_companies_linkedin_uniq only if a
--   public page was since recorded with that exact value, which the CHECK
--   below makes impossible while it stands.
-- ---------------------------------------------------------------------------

alter table public.crm_companies disable trigger crm_companies_set_updated_at;

update public.crm_companies
   set linkedin_url            = null,
       normalized_linkedin_url = null
 where normalized_linkedin_url ~ '^linkedin\.com/sales/company/[0-9]+$'
   and normalized_linkedin_url = normalized_sales_navigator_url;

alter table public.crm_companies enable trigger crm_companies_set_updated_at;

do $$
declare
  v_left bigint;
begin
  select count(id) into v_left
    from public.crm_companies
   where normalized_linkedin_url ~ '^linkedin\.com/sales/'
      or normalized_linkedin_url ~ '/sales/';
  if v_left <> 0 then
    raise exception '0151: % companies hold a Navigator address in the LinkedIn column that differs from their Navigator column; resolve them before applying', v_left
      using errcode = 'check_violation';
  end if;
end
$$;

drop trigger if exists crm_companies_mirror_navigator_url on public.crm_companies;
drop function if exists public.crm_companies_mirror_navigator_url();

alter table public.crm_companies drop constraint if exists crm_companies_linkedin_is_public;
alter table public.crm_companies
  add constraint crm_companies_linkedin_is_public check (
    normalized_linkedin_url is null
    or normalized_linkedin_url !~ '/sales/'
  );

comment on constraint crm_companies_linkedin_is_public on public.crm_companies is
  'The LinkedIn column holds public company pages only. Sales Navigator ids live in normalized_sales_navigator_url (0145/0151).';
