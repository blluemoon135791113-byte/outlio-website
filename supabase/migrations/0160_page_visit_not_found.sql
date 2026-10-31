-- 0160 — a page that does not exist is its own outcome (2026-11-01)
--
-- The first upload logged after 0159 filed 404s as `unreachable`: 53 of the
-- team-page reader's 146 visits, most of them guessed paths (/team, /about-us)
-- that simply do not exist. Mixed in with real outages they made "unreachable"
-- meaningless. `not_found` separates them. Until this is applied, the app files
-- them as `unreachable` (lib/intelligence/observe.ts retries on the check).

alter table public.enrichment_page_visits
  drop constraint if exists enrichment_page_visits_outcome_check;

alter table public.enrichment_page_visits
  add constraint enrichment_page_visits_outcome_check check (outcome in (
    'read_contact', 'read_empty', 'refused', 'js_rendered', 'blocked',
    'not_found', 'unreachable', 'timeout', 'not_html', 'too_large'));

-- Self-check: exactly one outcome check remains, and it admits not_found.
do $$
declare
  checks int;
begin
  select count(*) into checks
  from pg_constraint
  where conrelid = 'public.enrichment_page_visits'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%outcome%';
  if checks <> 1 then
    raise exception '0160: expected one outcome check on enrichment_page_visits, found %', checks;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'enrichment_page_visits_outcome_check'
      and pg_get_constraintdef(oid) like '%not_found%'
  ) then
    raise exception '0160: the outcome check does not admit not_found';
  end if;
end $$;
