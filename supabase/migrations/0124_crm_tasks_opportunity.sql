-- ---------------------------------------------------------------------------
-- 0124 — crm_tasks.opportunity_id
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  ONE MISSING COLUMN, THREE FEATURES THAT CANNOT BE BUILT.                 ║
-- ║                                                                           ║
-- ║  `crm_tasks` carries `contact_id` and `company_id` and nothing else, so a ║
-- ║  task cannot say which DEAL it belongs to. Phase 0 traced three §7/§8     ║
-- ║  gaps to exactly that:                                                    ║
-- ║                                                                           ║
-- ║    • the next-action indicator — §8 defines it as "the earliest           ║
-- ║      permitted open activity linked to THAT DEAL", which is unanswerable  ║
-- ║      when no activity can be linked to a deal                             ║
-- ║    • next-action coverage in reporting — "open deals with a linked open   ║
-- ║      next activity" has no join to count                                  ║
-- ║    • the "deals without a next action" row of My Work, which is the same  ║
-- ║      question asked the other way round                                   ║
-- ║                                                                           ║
-- ║  None of those is a hard problem. They were all waiting on a column.      ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠️ ADDITIVE AND INERT. A nullable column with no writer changes no existing
-- behaviour: every current task keeps a NULL deal and every query that does not
-- mention the column returns exactly what it did before. The code that writes it
-- is a separate change, applied after this one — reversed, every task insert
-- would fail against a column that does not exist.
--
-- ⚠️ VALIDATE BEFORE APPLYING:
--
--   scripts/check-migration.sh supabase/migrations/0124_crm_tasks_opportunity.sql \
--     supabase/migrations/smoke/0124_crm_tasks_opportunity.smoke.sql
-- ---------------------------------------------------------------------------

alter table public.crm_tasks
  add column if not exists opportunity_id uuid;

/*
 * ⚠️ COMPOSITE FK, MATCHING ITS TWO SIBLINGS. `(opportunity_id, workspace_id)`
 * against `crm_opportunities (id, workspace_id)` is what makes a cross-tenant
 * reference unrepresentable rather than merely discouraged: a task in workspace
 * A cannot point at a deal in workspace B, because no such row exists to
 * satisfy the constraint. 0071 established this pattern and §2 asks for it by
 * name.
 *
 * ⚠️ `on delete cascade`, THE SAME AS contact_id AND company_id, and chosen
 * rather than inherited. `set null` was the alternative — it keeps the task and
 * drops only the link — but `crm_tasks` has no has-subject constraint, so a
 * task whose only subject was the deleted deal would survive attached to
 * nothing, which no view lists and nobody can find. Opportunities are soft
 * deleted in practice (`deleted_at`), so this fires mainly when a workspace
 * goes, and then everything goes anyway.
 */
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'crm_tasks_opportunity_fk'
  ) then
    alter table public.crm_tasks
      add constraint crm_tasks_opportunity_fk
      foreign key (opportunity_id, workspace_id)
      references public.crm_opportunities (id, workspace_id)
      on delete cascade;
  end if;
end $$;

comment on column public.crm_tasks.opportunity_id is
  'The deal this task advances, or NULL. Composite FK with workspace_id, so a '
  'task can never reference another tenant''s deal.';

/*
 * Mirrors `crm_tasks_contact_idx`: partial on the same two predicates, because
 * every query that will use this asks for OPEN work on a LIVE deal — "what is
 * the next action on this deal" and "which deals have none".
 */
create index if not exists crm_tasks_opportunity_idx
  on public.crm_tasks (workspace_id, opportunity_id)
  where opportunity_id is not null and deleted_at is null;
