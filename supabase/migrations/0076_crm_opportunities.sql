-- 0076 — opportunities, pipelines and stage history (M3 Phase 6)
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  AN OPPORTUNITY IS NOT A CONTACT, AND NOT A FIELD ON ONE.                 ║
-- ║                                                                           ║
-- ║  One person can be sold to twice — a renewal, a second department, a new  ║
-- ║  role at a new company. Stage on the contact caps them at one deal        ║
-- ║  forever and makes "how many deals did we run at Acme" unanswerable.      ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- OPTIMISTIC LOCKING IS BUILT IN FROM THE START (A3: "row versioning on Kanban
-- moves"). Two people dragging one card is the normal case in a shared
-- pipeline, not an edge case, and last-write-wins silently discards one of
-- them. `version` and `crm_move_opportunity_stage` land here rather than in
-- Phase 7 so the Kanban is built against a store that already refuses lost
-- updates.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'crm_opportunity_status') then
    create type public.crm_opportunity_status as enum ('open', 'won', 'lost');
  end if;

  if not exists (select 1 from pg_type where typname = 'crm_stage_kind') then
    /* What reaching this stage MEANS, as opposed to what it is called. A
       workspace may name its closing stage anything; reporting needs to know
       which stages end a deal, and how. */
    create type public.crm_stage_kind as enum ('open', 'won', 'lost');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- crm_pipelines
-- ---------------------------------------------------------------------------

create table if not exists public.crm_pipelines (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  name         text not null check (length(trim(name)) between 1 and 120),
  description  text,
  /* Where a new opportunity lands when nobody chose. */
  is_default   boolean not null default false,
  sort_order   integer not null default 0,

  /* Archived, never deleted: a pipeline's stages are referenced by every deal
     that ever passed through them, and closed history must stay readable. */
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,

  unique (id, workspace_id)
);

drop trigger if exists crm_pipelines_set_updated_at on public.crm_pipelines;
create trigger crm_pipelines_set_updated_at
  before update on public.crm_pipelines
  for each row execute function public.set_updated_at();

-- At most one default per workspace, so "the default pipeline" is never a
-- question the application has to break a tie on.
create unique index if not exists crm_pipelines_default_uniq
  on public.crm_pipelines (workspace_id)
  where is_default and archived_at is null;

create index if not exists crm_pipelines_workspace_idx
  on public.crm_pipelines (workspace_id, sort_order) where archived_at is null;

-- ---------------------------------------------------------------------------
-- crm_pipeline_stages
-- ---------------------------------------------------------------------------

create table if not exists public.crm_pipeline_stages (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  pipeline_id  uuid not null,

  name         text not null check (length(trim(name)) between 1 and 120),
  kind         public.crm_stage_kind not null default 'open',
  sort_order   integer not null,

  /* The DEFAULT likelihood for deals in this stage, 0–100. Copied onto an
     opportunity when it arrives; the deal keeps its own value afterwards, so
     retuning a stage does not silently restate every forecast already made. */
  default_probability integer not null default 0
    check (default_probability between 0 and 100),

  /* Days after which a deal sitting here is "rotting" on the Kanban (Phase 7).
     NULL means never. */
  stale_after_days integer check (stale_after_days is null or stale_after_days > 0),

  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (id, workspace_id),
  constraint crm_pipeline_stages_pipeline_fk
    foreign key (pipeline_id, workspace_id)
    references public.crm_pipelines (id, workspace_id)
    on delete cascade
);

drop trigger if exists crm_pipeline_stages_set_updated_at on public.crm_pipeline_stages;
create trigger crm_pipeline_stages_set_updated_at
  before update on public.crm_pipeline_stages
  for each row execute function public.set_updated_at();

create index if not exists crm_pipeline_stages_order_idx
  on public.crm_pipeline_stages (workspace_id, pipeline_id, sort_order)
  where archived_at is null;

-- ---------------------------------------------------------------------------
-- crm_opportunities
-- ---------------------------------------------------------------------------

create table if not exists public.crm_opportunities (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,

  title         text not null check (length(trim(title)) between 1 and 200),

  contact_id    uuid,
  company_id    uuid,
  owner_user_id uuid references auth.users(id) on delete set null,

  pipeline_id   uuid not null,
  stage_id      uuid not null,

  /* ⚠️ NUMERIC, NEVER float. Binary floating point cannot represent 0.1, and a
     pipeline total is a sum of thousands of these — the error compounds and
     the forecast stops reconciling with the deals behind it. */
  value_amount  numeric(14, 2) check (value_amount is null or value_amount >= 0),
  /* ISO 4217. Stored per deal because one workspace sells in several. */
  currency      char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),

  /* This deal's own likelihood, seeded from the stage and editable after. */
  probability   integer not null default 0 check (probability between 0 and 100),
  expected_close_date date,

  status        public.crm_opportunity_status not null default 'open',
  /* Required when lost: "why did we lose" is the single most useful field in a
     pipeline review, and it is never filled in retrospectively. */
  lost_reason   text,
  closed_at     timestamptz,

  /* ⚠️ OPTIMISTIC LOCK. Incremented by every stage move. A caller that has not
     seen the current value is holding a stale card and must be told, not
     allowed to overwrite. */
  version       integer not null default 1,

  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null,

  unique (id, workspace_id),

  constraint crm_opportunities_closed_consistent check (
    (status = 'open'  and closed_at is null and lost_reason is null)
    or (status = 'won'  and closed_at is not null and lost_reason is null)
    or (status = 'lost' and closed_at is not null)
  ),

  constraint crm_opportunities_contact_fk
    foreign key (contact_id, workspace_id)
    references public.crm_contacts (id, workspace_id)
    on delete set null,
  constraint crm_opportunities_company_fk
    foreign key (company_id, workspace_id)
    references public.crm_companies (id, workspace_id)
    on delete set null,
  constraint crm_opportunities_pipeline_fk
    foreign key (pipeline_id, workspace_id)
    references public.crm_pipelines (id, workspace_id),
  constraint crm_opportunities_stage_fk
    foreign key (stage_id, workspace_id)
    references public.crm_pipeline_stages (id, workspace_id)
);

drop trigger if exists crm_opportunities_set_updated_at on public.crm_opportunities;
create trigger crm_opportunities_set_updated_at
  before update on public.crm_opportunities
  for each row execute function public.set_updated_at();

-- The Kanban's own query: one pipeline, one column, oldest first within it.
create index if not exists crm_opportunities_board_idx
  on public.crm_opportunities (workspace_id, pipeline_id, stage_id, updated_at desc)
  where deleted_at is null and status = 'open';

-- "My deals" for a setter, and the owner filter on the board.
create index if not exists crm_opportunities_owner_idx
  on public.crm_opportunities (workspace_id, owner_user_id, status)
  where deleted_at is null;

create index if not exists crm_opportunities_contact_idx
  on public.crm_opportunities (workspace_id, contact_id)
  where contact_id is not null and deleted_at is null;

create index if not exists crm_opportunities_company_idx
  on public.crm_opportunities (workspace_id, company_id)
  where company_id is not null and deleted_at is null;

-- Forecasting by close period (M4 Phase 10.5).
create index if not exists crm_opportunities_close_idx
  on public.crm_opportunities (workspace_id, expected_close_date)
  where deleted_at is null and status = 'open';

-- ---------------------------------------------------------------------------
-- crm_opportunity_stage_history
--
-- APPEND-ONLY, using the guard from 0075.
--
-- "Full stage history" is not a nice-to-have: velocity, conversion per stage
-- and time-to-close are all derived from it, and a stage a deal passed through
-- last quarter cannot be reconstructed from its current position.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_opportunity_stage_history (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  opportunity_id uuid not null,

  from_stage_id  uuid,
  to_stage_id    uuid not null,

  /* Same frozen attribution as crm_activities (0075). A pipeline report asks
     who owned the deal WHEN it moved. */
  actor_user_id          uuid references auth.users(id) on delete set null,
  owner_user_id_at_event uuid references auth.users(id) on delete set null,

  /* How long it sat in the previous stage. Stored at move time because
     recomputing it later means replaying the whole history for every deal in
     every velocity report. */
  seconds_in_previous_stage integer
    check (seconds_in_previous_stage is null or seconds_in_previous_stage >= 0),

  occurred_at    timestamptz not null default now(),

  constraint crm_osh_opportunity_fk
    foreign key (opportunity_id, workspace_id)
    references public.crm_opportunities (id, workspace_id)
    on delete cascade
);

create index if not exists crm_osh_opportunity_idx
  on public.crm_opportunity_stage_history (workspace_id, opportunity_id, occurred_at desc);
create index if not exists crm_osh_stage_idx
  on public.crm_opportunity_stage_history (workspace_id, to_stage_id, occurred_at desc);

drop trigger if exists crm_osh_append_only on public.crm_opportunity_stage_history;
create trigger crm_osh_append_only
  before update or delete on public.crm_opportunity_stage_history
  for each row execute function public.crm_guard_append_only();

-- ---------------------------------------------------------------------------
-- crm_move_opportunity_stage
--
-- ⚠️ THE ONLY WAY A DEAL CHANGES STAGE.
--
-- One statement does five things that must not come apart: check the caller
-- is not holding a stale card, move the deal, write stage history, write the
-- activity, and bump the version.
--
-- M3 acceptance criterion 2 is "a stage change emits exactly one activity and
-- one domain event, verified under retry". That holds here because the version
-- check is the idempotency key: a retry of a move that already succeeded
-- arrives with the OLD version and is refused, so it cannot write a second
-- activity.
--
-- ⚠️ `p_expected_version` is not optional by accident. A caller that does not
-- know what it is moving has no business moving it.
-- ---------------------------------------------------------------------------

create or replace function public.crm_move_opportunity_stage(
  p_workspace_id     uuid,
  p_opportunity_id   uuid,
  p_to_stage_id      uuid,
  p_expected_version integer,
  p_actor_id         uuid default null,
  p_lost_reason      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_opp      public.crm_opportunities%rowtype;
  v_stage    public.crm_pipeline_stages%rowtype;
  v_since    timestamptz;
  v_seconds  integer;
  v_status   public.crm_opportunity_status;
  v_closed   timestamptz;
  v_activity public.crm_activity_type;
begin
  select * into v_opp
    from public.crm_opportunities
   where id = p_opportunity_id and workspace_id = p_workspace_id
   for update;

  if v_opp.id is null then
    raise exception 'crm_move_opportunity_stage: no such opportunity in workspace %',
      p_workspace_id using errcode = 'no_data_found';
  end if;

  if v_opp.deleted_at is not null then
    raise exception 'crm_move_opportunity_stage: opportunity % is deleted',
      p_opportunity_id using errcode = 'check_violation';
  end if;

  -- THE LOST-UPDATE GUARD. Two people dragged the same card; the second is
  -- told rather than silently overwriting the first.
  if v_opp.version <> p_expected_version then
    raise exception
      'crm_move_opportunity_stage: opportunity % changed since you loaded it (expected version %, found %)',
      p_opportunity_id, p_expected_version, v_opp.version
      using errcode = 'serialization_failure';
  end if;

  select * into v_stage
    from public.crm_pipeline_stages
   where id = p_to_stage_id and workspace_id = p_workspace_id;

  if v_stage.id is null then
    raise exception 'crm_move_opportunity_stage: no such stage in workspace %',
      p_workspace_id using errcode = 'no_data_found';
  end if;

  -- Moving between pipelines is a different operation with different meaning
  -- for every velocity metric. Refused here rather than silently allowed.
  if v_stage.pipeline_id <> v_opp.pipeline_id then
    raise exception
      'crm_move_opportunity_stage: stage % belongs to a different pipeline',
      p_to_stage_id using errcode = 'check_violation';
  end if;

  if v_stage.kind = 'lost' and nullif(trim(coalesce(p_lost_reason, '')), '') is null then
    -- Asked for at the moment of losing, because it is never filled in later.
    raise exception 'crm_move_opportunity_stage: a lost deal needs a reason'
      using errcode = 'check_violation';
  end if;

  -- No-op moves are refused rather than quietly recorded: a card dropped back
  -- where it started is not a stage change, and counting it corrupts velocity.
  if v_opp.stage_id = p_to_stage_id then
    raise exception 'crm_move_opportunity_stage: opportunity % is already in that stage',
      p_opportunity_id using errcode = 'check_violation';
  end if;

  -- Time in the previous stage: since the last move, or since creation.
  select max(occurred_at) into v_since
    from public.crm_opportunity_stage_history
   where workspace_id = p_workspace_id and opportunity_id = p_opportunity_id;

  v_seconds := greatest(
    0,
    extract(epoch from (now() - coalesce(v_since, v_opp.created_at)))::integer
  );

  v_status := case v_stage.kind
                when 'won'  then 'won'::public.crm_opportunity_status
                when 'lost' then 'lost'::public.crm_opportunity_status
                else 'open'::public.crm_opportunity_status
              end;
  v_closed := case when v_stage.kind = 'open' then null else now() end;

  update public.crm_opportunities
     set stage_id    = p_to_stage_id,
         status      = v_status,
         closed_at   = v_closed,
         lost_reason = case when v_stage.kind = 'lost' then trim(p_lost_reason) else null end,
         -- A won deal is 100% by definition, a lost one 0%. Otherwise the
         -- stage's default applies only while the deal is still open.
         probability = case v_stage.kind
                         when 'won'  then 100
                         when 'lost' then 0
                         else v_stage.default_probability
                       end,
         version     = version + 1
   where id = p_opportunity_id and workspace_id = p_workspace_id;

  insert into public.crm_opportunity_stage_history (
    workspace_id, opportunity_id, from_stage_id, to_stage_id,
    actor_user_id, owner_user_id_at_event, seconds_in_previous_stage
  ) values (
    p_workspace_id, p_opportunity_id, v_opp.stage_id, p_to_stage_id,
    p_actor_id, v_opp.owner_user_id, v_seconds
  );

  v_activity := case v_stage.kind
                  when 'won'  then 'OPPORTUNITY_WON'::public.crm_activity_type
                  when 'lost' then 'OPPORTUNITY_LOST'::public.crm_activity_type
                  else 'STAGE_CHANGED'::public.crm_activity_type
                end;

  -- EXACTLY ONE activity, in the same transaction as the move. If the insert
  -- fails the move rolls back with it, so the event stream can never disagree
  -- with the board.
  insert into public.crm_activities (
    workspace_id, activity_type, channel, contact_id, company_id,
    actor_user_id, owner_user_id_at_event, refs, metadata
  ) values (
    p_workspace_id, v_activity, 'system', v_opp.contact_id, v_opp.company_id,
    p_actor_id, v_opp.owner_user_id,
    jsonb_build_object('opportunity_id', p_opportunity_id),
    jsonb_build_object(
      'from_stage_id', v_opp.stage_id,
      'to_stage_id', p_to_stage_id,
      'seconds_in_previous_stage', v_seconds,
      'value_amount', v_opp.value_amount,
      'currency', v_opp.currency
    )
  );

  return jsonb_build_object(
    'opportunity_id', p_opportunity_id,
    'version', v_opp.version + 1,
    'status', v_status,
    'stage_id', p_to_stage_id,
    'seconds_in_previous_stage', v_seconds
  );
end;
$$;

revoke all on function public.crm_move_opportunity_stage(uuid, uuid, uuid, integer, uuid, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'crm_pipelines', 'crm_pipeline_stages', 'crm_opportunities',
    'crm_opportunity_stage_history'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_member', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.is_workspace_member(workspace_id) or public.is_admin())',
      t || '_select_member', t
    );
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end
$$;

grant select, insert, update, delete on table public.crm_pipelines to service_role;
grant select, insert, update, delete on table public.crm_pipeline_stages to service_role;
grant select, insert, update, delete on table public.crm_opportunities to service_role;
-- Append-only, like every other history table here.
grant select, insert on table public.crm_opportunity_stage_history to service_role;

-- ---------------------------------------------------------------------------
-- Documentation
-- ---------------------------------------------------------------------------

comment on table public.crm_opportunities is
  'A deal. Separate from the contact because one person can be sold to twice — '
  'a renewal, a second department, a new role at a new company.';

comment on column public.crm_opportunities.version is
  'Optimistic lock. Every stage move increments it; a caller passing a stale '
  'value is refused rather than allowed to overwrite someone else''s move.';

comment on column public.crm_opportunities.value_amount is
  'NUMERIC, never float. A pipeline total sums thousands of these and binary '
  'floating point error compounds until the forecast stops reconciling.';

comment on function public.crm_move_opportunity_stage(uuid, uuid, uuid, integer, uuid, text) is
  'The only way a deal changes stage. Version check, move, stage history, one '
  'activity and a version bump, in one transaction.';
