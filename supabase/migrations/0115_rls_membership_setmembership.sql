-- 0115 — make workspace RLS index-usable
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  ANY READ THAT DOES NOT ALREADY FILTER BY workspace_id TIMES OUT.         ║
-- ║                                                                           ║
-- ║  Measured on staging 2026-09-05, 100,048 rows in crm_contacts, as an      ║
-- ║  ordinary authenticated user:                                            ║
-- ║                                                                           ║
-- ║    select id from crm_contacts                     → 57014 after ~8.7s   ║
-- ║    select id from crm_contacts limit 100           → 57014 after ~8.6s   ║
-- ║    select id from crm_contacts limit 1000          → 57014 after ~8.4s   ║
-- ║    ...same select with .eq('workspace_id', mine)   → 1 row in 344ms      ║
-- ║                                                                           ║
-- ║  ⚠️ THE LIMIT DOES NOT HELP, WHICH IS THE TELL. The policy has to be      ║
-- ║  evaluated before rows can be discarded, so `limit 100` still visits all  ║
-- ║  100k rows.                                                              ║
-- ║                                                                           ║
-- ║  Isolated by predicate, same user, same data:                            ║
-- ║    where is_admin()                          → completes                 ║
-- ║    where (select public.is_admin())          → completes                 ║
-- ║    where is_workspace_member(workspace_id)   → TIMES OUT                 ║
-- ║                                                                           ║
-- ║  `is_workspace_member` is `security definer`, and PostgreSQL NEVER inlines ║
-- ║  a security-definer SQL function. So it stays an opaque per-row call: the ║
-- ║  planner cannot turn it into an index condition, and it runs a two-table  ║
-- ║  join once per row. 100,048 rows, 100,048 joins.                          ║
-- ║                                                                           ║
-- ║  ⚠️ THIS IS NOT A TEST-ONLY PROBLEM. The application always filters by    ║
-- ║  workspace explicitly, so nothing is slow today — but that makes RLS a    ║
-- ║  correctness backstop that cannot carry a query on its own. The first     ║
-- ║  query written to rely on RLS alone fails once a customer gets big, and   ║
-- ║  it fails as a timeout rather than as a permission error.                 ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- THE CHANGE
--
--   before:  is_workspace_member(workspace_id) or is_admin()
--   after:   workspace_id in (select public.my_workspace_ids())
--              or (select public.is_admin())
--
-- Both halves become uncorrelated subqueries, which PostgreSQL evaluates ONCE
-- as an InitPlan instead of once per row — and `workspace_id in (<constant
-- set>)` is an index condition, which the existing per-table workspace indexes
-- can serve.
--
-- ⚠️ SEMANTICALLY IDENTICAL, AND THAT IS THE ONLY THING THAT MATTERS HERE.
--
--   is_workspace_member(w) := workspace_role_of(w) is not null
--   workspace_role_of(w)   := the caller's role in w, where w is not deleted
--
-- so `is_workspace_member(w)` is true exactly when w appears in the set of
-- workspaces the caller belongs to and which are not deleted. That set is what
-- `my_workspace_ids()` returns, from the same two tables with the same
-- predicates. Membership in the set and truth of the function are the same
-- statement written two ways.
--
-- ⚠️ STILL `security definer`. The set is computed by a definer function for the
-- same reason the original was: `workspace_memberships` has its own RLS, and a
-- policy that read it as the caller would recurse.

create or replace function public.my_workspace_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.workspace_id
    from public.workspace_memberships m
    join public.workspaces w on w.id = m.workspace_id
   where m.user_id = auth.uid()
     and w.deleted_at is null;
$$;

revoke all on function public.my_workspace_ids() from public, anon;
grant execute on function public.my_workspace_ids() to authenticated, service_role;

comment on function public.my_workspace_ids() is
  'The caller''s workspaces, as a set. Exists so RLS can say `workspace_id in '
  '(select my_workspace_ids())` — an uncorrelated subquery PostgreSQL evaluates '
  'once and can serve from an index — instead of calling a security-definer '
  'function per row, which it can never inline. See 0115.';

-- ---------------------------------------------------------------------------
-- Rewrite every policy carrying the exact legacy shape.
--
-- ⚠️ MATCHED ON THE EXACT PREDICATE TEXT, NOT ON A TABLE LIST. A hand-written
-- list of 56 tables is a list that rots; matching the shape means this touches
-- precisely the policies that have it and silently skips anything hand-tuned.
-- The two policies with bespoke predicates (email accounts, and the one keyed
-- on `id` rather than `workspace_id`) are deliberately left alone.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and qual = '(is_workspace_member(workspace_id) OR is_admin())'
  loop
    execute format(
      'alter policy %I on %I.%I using ('
      || 'workspace_id in (select public.my_workspace_ids()) '
      || 'or (select public.is_admin()))',
      r.policyname, r.schemaname, r.tablename
    );
    n := n + 1;
  end loop;

  raise notice '0115: rewrote % policies', n;

  /*
   * ⚠️ SELF-VERIFYING. 0110 exists because a migration silently replaced a
   * function and deleted four responsibilities nobody noticed for eleven days.
   * If this rewrote nothing, the shape has changed underneath the migration and
   * the deployment must stop rather than report success.
   */
  if n = 0 then
    raise exception '0115 matched no policies — the predicate shape has changed';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and qual = '(is_workspace_member(workspace_id) OR is_admin())'
  ) then
    raise exception '0115 left policies with the old shape behind';
  end if;
end
$$;
