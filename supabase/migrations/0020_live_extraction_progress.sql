-- 0020: live extraction progress
--
-- Only operational job/file tables are replicated. extracted_leads contains
-- personal data and deliberately stays out of Realtime payloads; the client
-- refreshes lead previews after a job update under the user's existing RLS.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
        from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'extraction_jobs'
    ) then
      alter publication supabase_realtime add table public.extraction_jobs;
    end if;

    if not exists (
      select 1
        from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'uploaded_files'
    ) then
      alter publication supabase_realtime add table public.uploaded_files;
    end if;
  end if;
end
$$;
