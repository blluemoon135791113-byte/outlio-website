-- 0108 — a flow run's working state
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  A RUN HAD NOWHERE TO KEEP A COMPUTED VALUE.                             ║
-- ║                                                                           ║
-- ║  `DATE_CALC` and `TEXT_TRANSFORM` were in the action catalogue and were   ║
-- ║  the last two with no handler — not for want of effort, but because a     ║
-- ║  handler would have produced the right answer and then discarded it.      ║
-- ║  `gatherFacts` reads only the contact, and Hubble's `storeAs` wrote an    ║
-- ║  activity row that nothing ever read back.                                ║
-- ║                                                                           ║
-- ║  One JSONB column is the whole feature: a step writes a key, later steps  ║
-- ║  and branch conditions read it as `vars.<key>`.                           ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- ⚠️ NOT NULL WITH A DEFAULT, so every run already in flight reads as `{}`
-- rather than null. `advanceRun` merges this into the fact set on every step,
-- and a null there would make `vars.anything` throw instead of being absent.
alter table public.flow_runs
  add column if not exists variables jsonb not null default '{}'::jsonb;

/*
 * ⚠️ AN OBJECT, NOT AN ARRAY OR A SCALAR. The engine spreads it into the fact
 * map, so anything else would either lose keys silently or blow up mid-run —
 * and a run that fails at step four because step two wrote a number is a
 * miserable thing to debug.
 */
alter table public.flow_runs
  drop constraint if exists flow_runs_variables_is_object;

alter table public.flow_runs
  add constraint flow_runs_variables_is_object
  check (jsonb_typeof(variables) = 'object');

comment on column public.flow_runs.variables is
  'Working state for one run. A step writes a key via its `storeAs` config; '
  'later steps and branch conditions read it as `vars.<key>`. Object only.';
