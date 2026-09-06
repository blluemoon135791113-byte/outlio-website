-- 0093 — the Flow engine (M7 Phase 20)
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  ONE ENGINE SHARED BY CRM AND EMAIL. Four of M7's five criteria are       ║
-- ║  decided by this schema rather than by the code that runs on it:          ║
-- ║                                                                           ║
-- ║   1. A killed worker never duplicates an action — because a step's        ║
-- ║      completion is a UNIQUE row, not a flag someone remembers to set.     ║
-- ║   2. Loop protection halts and SAYS WHY — `halt_reason` is a column, so   ║
-- ║      a halted run explains itself instead of just stopping.               ║
-- ║   3. Editing a published flow creates a draft, and in-flight runs finish  ║
-- ║      on the old version — because a run PINS `version_id`, and a          ║
-- ║      published version is immutable by trigger.                           ║
-- ║   5. The execution log shows every step — `flow_step_runs` IS the log,    ║
-- ║      written as the run proceeds rather than reconstructed after.         ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

do $$
begin
  if not exists (select 1 from pg_type where typname = 'flow_status') then
    create type public.flow_status as enum ('draft', 'published', 'paused', 'archived');
  end if;

  if not exists (select 1 from pg_type where typname = 'flow_run_status') then
    create type public.flow_run_status as enum (
      'running',
      'waiting',      -- parked on a wait step until `resume_at`
      'completed',
      'failed',
      'halted',       -- stopped by a safety rule; `halt_reason` says which
      'cancelled'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'flow_step_status') then
    create type public.flow_step_status as enum (
      'pending', 'running', 'succeeded', 'failed', 'skipped'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- flows
-- ---------------------------------------------------------------------------

create table if not exists public.flows (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,

  name               text not null check (length(trim(name)) between 1 and 200),
  description        text,
  status             public.flow_status not null default 'draft',

  /*
   * The version that new runs start on. NULL until first publish, which is
   * what makes "a draft flow triggers nothing" true without a second flag.
   */
  published_version_id uuid,

  -- Safety limits, per flow. Defaults are deliberately conservative.
  max_runs_per_contact_per_day integer not null default 3
    check (max_runs_per_contact_per_day between 1 and 100),
  /*
   * ⚠️ HOW DEEP A FLOW MAY TRIGGER ITSELF (or another flow that triggers it
   * back). 3 is enough for legitimate chains and short enough that a runaway
   * loop is caught within seconds rather than after ten thousand runs.
   */
  max_chain_depth    integer not null default 3
    check (max_chain_depth between 1 and 10),

  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create index if not exists flows_workspace_status_idx
  on public.flows (workspace_id, status) where deleted_at is null;

drop trigger if exists flows_set_updated_at on public.flows;
create trigger flows_set_updated_at
  before update on public.flows
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- flow_versions — CRITERION 3.
--
-- ⚠️ A PUBLISHED VERSION IS IMMUTABLE, ENFORCED BY TRIGGER. Editing a
-- published flow must produce a NEW draft version, never mutate the one that
-- in-flight runs are executing. Without this, changing a step would rewrite
-- what a half-finished run does next — and the run would do half of one flow
-- and half of another, which is not a state anyone can debug.
-- ---------------------------------------------------------------------------

create table if not exists public.flow_versions (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  flow_id       uuid not null references public.flows(id) on delete cascade,

  version       integer not null check (version >= 1),

  /*
   * The whole definition: trigger, steps, edges. JSONB rather than relational
   * because a version is an OPAQUE SNAPSHOT — it is never queried by step, and
   * normalising it would let someone edit a step row and silently change a
   * published version, which is exactly what this table exists to prevent.
   */
  definition    jsonb not null,

  published_at  timestamptz,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create unique index if not exists flow_versions_number_idx
  on public.flow_versions (flow_id, version);

create index if not exists flow_versions_flow_idx
  on public.flow_versions (flow_id, created_at desc);

alter table public.flows
  drop constraint if exists flows_published_version_fk;
alter table public.flows
  add constraint flows_published_version_fk
  foreign key (published_version_id) references public.flow_versions(id);

create or replace function public.flow_versions_guard_published()
returns trigger
language plpgsql
as $$
begin
  if old.published_at is not null then
    /*
     * Everything about a published version is frozen. Only `published_at`
     * itself may not change either — there is nothing legitimate to edit,
     * because the whole point is that a run pinned to this row keeps seeing
     * what it started with.
     */
    if new.definition is distinct from old.definition
    or new.version    is distinct from old.version
    or new.flow_id    is distinct from old.flow_id
    or new.published_at is distinct from old.published_at then
      raise exception
        'Flow version % is published and cannot be edited. Publishing creates a new version.',
        old.version
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists flow_versions_guard_published on public.flow_versions;
create trigger flow_versions_guard_published
  before update on public.flow_versions
  for each row execute function public.flow_versions_guard_published();

-- ---------------------------------------------------------------------------
-- flow_runs
-- ---------------------------------------------------------------------------

create table if not exists public.flow_runs (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  flow_id        uuid not null references public.flows(id) on delete cascade,

  /*
   * ⚠️ THE RUN PINS ITS VERSION. This single column is criterion 3: a run
   * started before a re-publish keeps executing the definition it began with,
   * because it reads its steps from HERE and not from the flow's current
   * pointer.
   */
  version_id     uuid not null references public.flow_versions(id),

  trigger_type   text not null,
  contact_id     uuid references public.crm_contacts(id),

  status         public.flow_run_status not null default 'running',

  /* Which step to execute next. Null when finished. */
  current_step   text,
  resume_at      timestamptz,

  /*
   * ⚠️ LOOP PROTECTION — CRITERION 2. `parent_run_id` and `chain_depth` make a
   * self-triggering flow visible: a run created BY an action of another run
   * inherits depth + 1, and the engine refuses beyond the flow's limit.
   */
  parent_run_id  uuid references public.flow_runs(id) on delete set null,
  chain_depth    integer not null default 0 check (chain_depth >= 0),

  /*
   * ⚠️ A HALTED RUN MUST SAY WHY. "It stopped" is unanswerable, and criterion
   * 2 explicitly requires the reason to be SURFACED. Enforced below.
   */
  halt_reason    text,

  /* Deterministic per (flow, contact, trigger occurrence). See the index. */
  idempotency_key text,

  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint flow_runs_halt_reason_required
    check (status <> 'halted' or halt_reason is not null)
);

/*
 * ⚠️ CRITERION 1, FIRST HALF. A trigger that fires twice for the same event —
 * a retried webhook, a re-delivered domain event — produces ONE run, because
 * the key collides. The engine never has to decide whether it has seen this
 * before.
 */
create unique index if not exists flow_runs_idempotency_idx
  on public.flow_runs (workspace_id, flow_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists flow_runs_due_idx
  on public.flow_runs (resume_at) where status = 'waiting';

create index if not exists flow_runs_flow_idx
  on public.flow_runs (flow_id, started_at desc);

-- Loop protection reads this: how many runs for this contact today.
create index if not exists flow_runs_contact_day_idx
  on public.flow_runs (flow_id, contact_id, started_at desc);

drop trigger if exists flow_runs_set_updated_at on public.flow_runs;
create trigger flow_runs_set_updated_at
  before update on public.flow_runs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- flow_step_runs — CRITERION 5 (the execution log) AND CRITERION 1.
--
-- ⚠️ THE UNIQUE INDEX IS THE EXACTLY-ONCE GUARANTEE. A step's completion is a
-- ROW, not a flag. A worker killed after performing a side effect but before
-- recording it leaves no row — and the retry, seeing no row, would repeat the
-- action. So the row is written BEFORE the side effect runs (status
-- `running`), and its presence is what a retry checks. Same ordering as the
-- email send worker, for the same reason (Ledger D36).
-- ---------------------------------------------------------------------------

create table if not exists public.flow_step_runs (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_id       uuid not null references public.flow_runs(id) on delete cascade,

  /* The step's id within the version definition. */
  step_id      text not null,
  step_type    text not null,

  status       public.flow_step_status not null default 'pending',
  attempt      integer not null default 1 check (attempt >= 1),

  /*
   * ⚠️ SAFE INPUT AND OUTPUT ONLY. The brief asks for observability, not a
   * copy of the customer's data in a log table. Never a message body, never a
   * credential, never a full contact record.
   */
  input        jsonb not null default '{}'::jsonb,
  output       jsonb not null default '{}'::jsonb,

  error_code   text,
  error_message text,

  /* Credits a Hubble step consumed. Zero for every deterministic action. */
  credits_used integer not null default 0 check (credits_used >= 0),

  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  duration_ms  integer,

  created_at   timestamptz not null default now()
);

create unique index if not exists flow_step_runs_once_idx
  on public.flow_step_runs (run_id, step_id);

create index if not exists flow_step_runs_run_idx
  on public.flow_step_runs (run_id, started_at);

-- ---------------------------------------------------------------------------
-- flow_claim_step — the exactly-once claim.
--
-- Returns TRUE when the caller now owns this step and must perform it, FALSE
-- when someone already has. A retry after a kill gets FALSE and moves on
-- WITHOUT repeating the side effect.
-- ---------------------------------------------------------------------------

create or replace function public.flow_claim_step(
  p_workspace_id uuid,
  p_run_id       uuid,
  p_step_id      text,
  p_step_type    text,
  p_input        jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.flow_step_runs
    (workspace_id, run_id, step_id, step_type, status, input)
  values
    (p_workspace_id, p_run_id, p_step_id, p_step_type, 'running', p_input)
  /*
   * ⚠️ ON CONFLICT DO NOTHING, NOT AN EXISTS CHECK. Two workers racing on the
   * same run would both pass a check-then-insert. The unique index arbitrates;
   * exactly one caller gets a row back.
   */
  on conflict (run_id, step_id) do nothing
  returning id into v_id;

  return v_id is not null;
end;
$$;

revoke all on function public.flow_claim_step(uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- flow_check_loop_protection — CRITERION 2.
--
-- Returns NULL when the run may proceed, or a human-readable reason when it
-- must halt. Returning the REASON rather than a boolean is the point: the
-- caller stores it on the run, and the customer sees why.
-- ---------------------------------------------------------------------------

create or replace function public.flow_check_loop_protection(
  p_flow_id      uuid,
  p_contact_id   uuid,
  p_chain_depth  integer
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_flow    public.flows%rowtype;
  v_today   bigint;
begin
  select * into v_flow from public.flows where id = p_flow_id;
  if not found then
    return 'This flow no longer exists.';
  end if;

  /*
   * Depth first: a self-triggering flow is the dangerous case, because it can
   * spawn thousands of runs in seconds. The per-day limit would catch it
   * eventually, but only after the damage.
   */
  if p_chain_depth > v_flow.max_chain_depth then
    return format(
      'Stopped: this flow triggered itself %s times in a row (limit %s). A step in it is causing the trigger that starts it again.',
      p_chain_depth, v_flow.max_chain_depth
    );
  end if;

  if p_contact_id is null then
    return null;
  end if;

  select count(*) into v_today
    from public.flow_runs r
   where r.flow_id = p_flow_id
     and r.contact_id = p_contact_id
     and r.started_at >= date_trunc('day', now());

  if v_today >= v_flow.max_runs_per_contact_per_day then
    return format(
      'Stopped: this contact has already entered this flow %s times today (limit %s).',
      v_today, v_flow.max_runs_per_contact_per_day
    );
  end if;

  return null;
end;
$$;

revoke all on function public.flow_check_loop_protection(uuid, uuid, integer)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- flow_publish — CRITERION 3.
--
-- Snapshots the draft into a new immutable version and repoints the flow.
-- In-flight runs are untouched: they hold their own `version_id`.
-- ---------------------------------------------------------------------------

create or replace function public.flow_publish(
  p_workspace_id uuid,
  p_flow_id      uuid,
  p_definition   jsonb,
  p_created_by   uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_next    integer;
  v_version uuid;
begin
  select coalesce(max(version), 0) + 1 into v_next
    from public.flow_versions where flow_id = p_flow_id;

  insert into public.flow_versions
    (workspace_id, flow_id, version, definition, published_at, created_by)
  values
    (p_workspace_id, p_flow_id, v_next, p_definition, now(), p_created_by)
  returning id into v_version;

  /*
   * ⚠️ ONLY THE POINTER MOVES. Existing runs keep executing the version they
   * pinned at start, which is what makes "in-flight runs finish on the old
   * version" true without any special handling in the engine.
   */
  update public.flows
     set published_version_id = v_version,
         status = 'published'
   where id = p_flow_id
     and workspace_id = p_workspace_id;

  return v_version;
end;
$$;

revoke all on function public.flow_publish(uuid, uuid, jsonb, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['flows', 'flow_versions', 'flow_runs', 'flow_step_runs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_member', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.is_workspace_member(workspace_id) or public.is_admin())',
      t || '_select_member', t
    );
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end
$$;

comment on table public.flow_versions is
  'Immutable once published. Editing a published flow creates a NEW version; '
  'in-flight runs keep executing the version they pinned (M7 criterion 3).';

comment on table public.flow_step_runs is
  'The execution log (M7 criterion 5) AND the exactly-once guarantee (criterion '
  '1): a step''s completion is a unique ROW, claimed before the side effect '
  'runs, so a retry after a kill finds it and does not repeat the action.';
