-- 0109 — finish the job 0091 started
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  0091 FIXED `email_events` AND SAID `crm_activities` "HAS BEEN RIGHT ALL  ║
-- ║  ALONG". IT WAS NOT.                                                      ║
-- ║                                                                           ║
-- ║  0091 diagnosed the rule correctly: `ON DELETE SET NULL` is incompatible  ║
-- ║  with an append-only table, because nulling a foreign key is an UPDATE    ║
-- ║  and the guard rejects UPDATE. It then checked `crm_activities`'s ENTITY  ║
-- ║  references — contact and company, which genuinely are plain references — ║
-- ║  and did not check its USER references, which are not.                    ║
-- ║                                                                           ║
-- ║  Four of the six append-only tables carry the same trap:                  ║
-- ║                                                                           ║
-- ║    crm_activities                 actor_user_id, owner_user_id_at_event   ║
-- ║    crm_audit_logs                 actor_user_id                           ║
-- ║    crm_merge_events               performed_by                            ║
-- ║    crm_opportunity_stage_history  actor_user_id, owner_user_id_at_event   ║
-- ║                                                                           ║
-- ║  CONSEQUENCE, observed in production on 2026-09-04: a user who has ever   ║
-- ║  performed a CRM action cannot be deleted. Removing a teammate, or        ║
-- ║  clearing test accounts, fails with                                       ║
-- ║                                                                           ║
-- ║    ERROR: public.crm_opportunity_stage_history is append-only;            ║
-- ║           UPDATE is not permitted                                         ║
-- ║                                                                           ║
-- ║  — an error that names the wrong culprit. Nothing in it suggests a        ║
-- ║  foreign key, so the reader goes looking at the audit guard instead.      ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- THE FIX, exactly as 0091: plain references with the default NO ACTION.
-- Deleting a referenced user is then REFUSED outright, with an error that says
-- "foreign key", rather than attempting an impossible update.
--
-- ⚠️ REFUSAL IS THE CORRECT OUTCOME HERE, NOT A LIMITATION.
--   • `owner_user_id_at_event` is attribution: "credited to whoever owned the
--     contact AT THE TIME". Nulling it on user deletion silently rewrites
--     historical revenue attribution — which is precisely what an append-only
--     table exists to prevent.
--   • The supported ways to remove data remain open: soft-delete, workspace
--     teardown (the guard permits a DELETE whose parent workspace is gone), and
--     erasure, which sets `outlio.erasure = 'on'` and deletes child rows
--     explicitly before the parent — see `crm_erase_contact`.

-- ---------------------------------------------------------------------------
-- ⚠️ THE CONSTRAINTS ARE FOUND, NOT NAMED.
--
-- Every one of these was declared inline, so Postgres named it
-- `<table>_<column>_fkey` — almost certainly. Almost is not good enough: a
-- `drop constraint if exists` against a guessed name that is wrong does
-- NOTHING, the `add` below then succeeds under a new name, and the table ends
-- up with BOTH constraints — the old SET NULL one still live. The migration
-- would report success and change nothing.
--
-- So the old constraint is located in `pg_constraint` by what it IS: a foreign
-- key, on this column, referencing auth.users, with `confdeltype = 'n'`
-- (SET NULL).
-- ---------------------------------------------------------------------------
do $$
declare
  target record;
  found  record;
  fixed  integer := 0;
begin
  for target in
    select * from (values
      ('crm_activities',                'actor_user_id'),
      ('crm_activities',                'owner_user_id_at_event'),
      ('crm_audit_logs',                'actor_user_id'),
      ('crm_merge_events',              'performed_by'),
      ('crm_opportunity_stage_history', 'actor_user_id'),
      ('crm_opportunity_stage_history', 'owner_user_id_at_event')
    ) as t(table_name, column_name)
  loop
    for found in
      select c.conname
        from pg_constraint c
        join pg_class      rel  on rel.oid = c.conrelid
        join pg_namespace  nsp  on nsp.oid = rel.relnamespace
        join pg_attribute  att  on att.attrelid = c.conrelid
                               and att.attnum = c.conkey[1]
       where c.contype   = 'f'
         and nsp.nspname = 'public'
         and rel.relname = target.table_name
         and att.attname = target.column_name
         -- 'n' = SET NULL. A constraint already on NO ACTION is left alone,
         -- so this migration is idempotent.
         and c.confdeltype = 'n'
         and array_length(c.conkey, 1) = 1
    loop
      execute format('alter table public.%I drop constraint %I',
                     target.table_name, found.conname);

      execute format(
        'alter table public.%I add constraint %I foreign key (%I) references auth.users(id)',
        target.table_name,
        target.table_name || '_' || target.column_name || '_fkey',
        target.column_name);

      fixed := fixed + 1;
      raise notice 'fixed %.% (was %)', target.table_name, target.column_name, found.conname;
    end loop;
  end loop;

  raise notice '0109: % constraint(s) moved from SET NULL to NO ACTION', fixed;
end $$;

-- ---------------------------------------------------------------------------
-- ⚠️ THE MIGRATION PROVES ITSELF.
--
-- A `do` block that finds nothing is indistinguishable from one that worked,
-- and this is the second attempt at this bug — 0091 believed it was done. This
-- fails loudly if any SET NULL reference to auth.users survives on an
-- append-only table.
-- ---------------------------------------------------------------------------
do $$
declare
  leftover integer;
begin
  select count(*) into leftover
    from pg_constraint c
    join pg_class     rel on rel.oid = c.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
   where c.contype = 'f'
     and nsp.nspname = 'public'
     and c.confdeltype = 'n'
     and rel.relname in (
       'crm_activities', 'crm_audit_logs', 'crm_merge_events',
       'crm_opportunity_stage_history', 'email_events', 'meeting_events'
     );

  if leftover > 0 then
    raise exception
      '0109 failed: % ON DELETE SET NULL foreign key(s) remain on append-only tables', leftover;
  end if;
end $$;

comment on table public.crm_activities is
  'Append-only. References use NO ACTION deliberately (0091, 0109): ON DELETE '
  'SET NULL is an UPDATE, which the append-only guard rejects, making the '
  'referenced row permanently undeletable. owner_user_id_at_event is '
  'attribution and must survive the user leaving. Remove data by soft-delete, '
  'workspace teardown, or erasure (outlio.erasure = on).';

comment on table public.crm_opportunity_stage_history is
  'Append-only. Same NO ACTION rule as crm_activities — see 0109.';
