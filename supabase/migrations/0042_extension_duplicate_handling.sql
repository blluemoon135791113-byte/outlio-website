-- Let extension capture sessions use the same lead-level duplicate handling
-- modes as uploaded HTML jobs.
alter table public.capture_sessions
  add column if not exists dedupe_mode public.dedupe_mode not null default 'remove_exact';

comment on column public.capture_sessions.dedupe_mode is
  'Lead-level duplicate mode copied to every extraction job in this capture session.';
