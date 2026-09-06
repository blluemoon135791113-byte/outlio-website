-- 0078 — realtime for the pipeline board (M3 Phase 7)
--
-- Supabase Realtime only broadcasts changes for tables in the
-- `supabase_realtime` publication. Without this the board is correct but
-- stale: two people working one pipeline each see their own moves and none of
-- each other's, and the optimistic lock becomes the ONLY thing telling them
-- the board is out of date — after they have already tried to drag something.
--
-- ⚠️ REALTIME RESPECTS RLS, and that is the whole reason this is safe. A
-- subscriber receives a change only if the row is visible to them under the
-- `crm_opportunities_select_member` policy from 0076, so a member of one
-- workspace can never receive another workspace's deals.
--
-- ⚠️ REPLICA IDENTITY. The default is `DEFAULT`, which sends only the primary
-- key for an UPDATE's old row. The board needs to know which STAGE a deal left,
-- not just that something changed, so old values must be included — otherwise
-- a client cannot remove the card from its previous column without refetching
-- the whole board on every move.
--
-- FULL replica identity writes the whole old row to WAL on every update. That
-- cost is acceptable for a table of deals (thousands, not millions) and is the
-- only way to get the previous stage. Revisit if a workspace ever carries
-- enough opportunities for the WAL volume to matter.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    -- Only on a bare Postgres (the local migration harness). Supabase projects
    -- always have it.
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'crm_opportunities'
  ) then
    alter publication supabase_realtime add table public.crm_opportunities;
  end if;
end
$$;

alter table public.crm_opportunities replica identity full;

comment on table public.crm_opportunities is
  'A deal. Separate from the contact because one person can be sold to twice — '
  'a renewal, a second department, a new role at a new company. '
  'Published to supabase_realtime with REPLICA IDENTITY FULL so a board can '
  'tell which stage a deal LEFT, not merely that it changed.';
