-- ---------------------------------------------------------------------------
-- 0132 — step settings, and the hole 0130 left in ADD_TAG.
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  ⚠️ `ADD_TAG` COULD NOT SAY WHICH TAG.                                    ║
-- ║                                                                           ║
-- ║  0130 gave every step a `body`, then forbade one on `ADD_TAG` via          ║
-- ║  `linkedin_workflow_steps_bodyless` — correctly, since a tag name is not a ║
-- ║  message. But that left the step with nowhere to record its only setting,  ║
-- ║  so a workflow could contain an `ADD_TAG` that named no tag.               ║
-- ║                                                                           ║
-- ║  Found while building the walker: the code that had to EXECUTE the step    ║
-- ║  had nothing to execute. Either it silently skipped — a step the customer  ║
-- ║  added doing nothing, forever, with no error — or it failed at run time on ║
-- ║  a workflow that had passed validation. Both are worse than a column.      ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠️ `jsonb`, AND THE WIDTH IS DELIBERATE RATHER THAN LAZY. Per-action settings
-- are exactly the shape that grows: the deferred voice-note step will carry a
-- voice id and a mode. A `tag_name text` column would be right today and would
-- become the first of five nullable columns, four of which are null on any given
-- row.
--
-- What keeps it from becoming a junk drawer is that NOTHING reads it loosely:
-- `lib/linkedin/steps.ts` declares a Zod schema per action, `compileWorkflow`
-- refuses a step whose config does not parse, and the CHECK below makes the one
-- case that matters today impossible to store at all.
-- ---------------------------------------------------------------------------

alter table public.linkedin_workflow_steps
  add column if not exists config jsonb not null default '{}'::jsonb;

/*
 * ⚠️ THE DATABASE REFUSES A TAGLESS `ADD_TAG`, rather than trusting the
 * validator. 0130 established the pattern for the owner's comment-draft rule and
 * it is the same argument: a constraint in TypeScript alone is a constraint that
 * holds until somebody writes a row another way — a backfill, a support script,
 * a future importer.
 *
 * `->>` yields NULL for a missing key and for a JSON null alike, so `btrim(...)
 * <> ''` covers absent, null, empty and whitespace in one expression.
 */
do $$ begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'linkedin_workflow_steps_tag_configured'
  ) then
    alter table public.linkedin_workflow_steps
      add constraint linkedin_workflow_steps_tag_configured check (
        action <> 'ADD_TAG'
        or btrim(coalesce(config ->> 'tag', '')) <> ''
      );
  end if;
end $$;

/*
 * ⚠️ AND EVERY OTHER ACTION MUST CARRY AN EMPTY CONFIG. Without this the column
 * accepts anything on any step, and a setting written against the wrong action
 * would sit there looking meaningful — the same failure mode as a `wait_days` on
 * a message step, which 0130 refuses for the same reason.
 *
 * This constraint is expected to be RELAXED when the voice-note step lands. That
 * is the correct direction: a new action arrives with its settings declared,
 * rather than every action having always been able to carry anything.
 */
do $$ begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'linkedin_workflow_steps_config_shape'
  ) then
    alter table public.linkedin_workflow_steps
      add constraint linkedin_workflow_steps_config_shape check (
        action = 'ADD_TAG' or config = '{}'::jsonb
      );
  end if;
end $$;

comment on column public.linkedin_workflow_steps.config is
  'Per-action settings. Only ADD_TAG uses it today ({"tag": "..."}), and the '
  'CHECK constraints keep it empty everywhere else so a setting cannot sit on '
  'an action that ignores it (0132).';
