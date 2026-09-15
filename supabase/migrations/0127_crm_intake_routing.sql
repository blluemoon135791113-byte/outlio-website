-- ---------------------------------------------------------------------------
-- 0127 — intake routing: rules, availability, a decision record, and a
-- once-per-intake guard
--
-- §5: "For explicitly unassigned system intake, route using the first matching
-- published rule ... Creator ownership takes precedence for member-added
-- records ... Route only once per intake event; a new enrichment field must not
-- steal an assigned lead."
--
-- "Implement round-robin allocation transactionally with active-membership
-- checks, availability and a configurable maximum open workload. Record the
-- rule version, eligible pool and chosen owner. If nobody is eligible, keep the
-- record in an admin-visible Unassigned queue and explain the reason. Do not
-- silently assign all failures to the workspace owner."
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  ⚠️ WHAT ASSIGNMENT DID BEFORE THIS WAS THE SPEC IN REVERSE.              ║
-- ║                                                                           ║
-- ║  `contact_created` is emitted by exactly one path, createContactManually, ║
-- ║  which makes the CREATOR the owner. CSV import and extractor intake —     ║
-- ║  the leads that arrive UNASSIGNED on purpose — emit nothing at all. The   ║
-- ║  shipped "New lead assignment" template runs ROUND_ROBIN on               ║
-- ║  contact_created, and crm_round_robin_assign reassigned whoever owned the ║
-- ║  contact.                                                                 ║
-- ║                                                                           ║
-- ║  So contacts a member added by hand were taken away from them, and the    ║
-- ║  imported leads the template describes distributing were never routed.   ║
-- ║  Production shows the first half: two contacts added by hand on           ║
-- ║  2026-09-03 were reassigned about two minutes later with                  ║
-- ║  OWNER_ASSIGNED `by: flow`.                                               ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- Decisions taken with the owner, 2026-09-14:
--   • flow assignment steps SKIP a contact that already has an owner
--   • a round-robin pool is the members listed on the rule (no teams exist)
--   • open workload is the count of non-deleted contacts a member owns (no
--     contact lifecycle exists yet to tell open from closed)
--
-- ⚠️ DECISIONS SNAPSHOT, THEY DO NOT REFERENCE. `crm_routing_decisions` is
-- append-only. A foreign key to a rule or to `auth.users` with `on delete set
-- null` is an UPDATE to an append-only row, which the guard refuses — the exact
-- defect 0109 fixed. So the rule, its version, the eligible pool and the chosen
-- owner are stored as values. A decision keeps saying what happened after the
-- rule is edited or the member leaves, which is the point of recording it.
--
-- ⚠️ NO `select` WITH A STAR AND NO DOUBLE-PIPE IN ANY SQL BELOW. This file is
-- pasted into the SQL editor by hand, and a paste has stripped both before.
-- Every read names its columns; arrays are built with array_append.
--
-- ⚠️ VALIDATE BEFORE APPLYING:
--   scripts/check-migration.sh supabase/migrations/0127_crm_intake_routing.sql \
--     supabase/migrations/smoke/0127_crm_intake_routing.smoke.sql
--
-- ⚠️ APPLY THIS BEFORE MERGING THE CODE THAT CALLS IT.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Availability
-- ---------------------------------------------------------------------------
alter table public.workspace_memberships add column if not exists away_until timestamptz;

comment on column public.workspace_memberships.away_until is
  'Not eligible for routed leads until this instant. Null means available. Routing only; it hides nothing and moves nothing already owned.';

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------
create table if not exists public.crm_routing_rules (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,

  name              text not null check (length(btrim(name)) between 1 and 120),
  position          integer not null default 0,
  kind              text not null check (kind in ('company_owner', 'named_user', 'pool')),

  /*
   * Which intake this rule may route. Defaults to the two system intake paths
   * that exist. `manual` is refused by constraint below: a member-added record
   * belongs to its creator, and a rule able to say otherwise is a rule able to
   * take someone's contact away.
   */
  sources           public.crm_record_source[] not null
                      default array['csv_import', 'lead_engine']::public.crm_record_source[],

  /*
   * ⚠️ NO FOREIGN KEYS TO USERS. A member who leaves is handled by the
   * membership check at routing time — they simply stop being eligible. An
   * `on delete set null` here would turn a named_user rule into one that
   * violates its own shape constraint the moment that person's account goes.
   */
  user_id           uuid,
  member_ids        uuid[] not null default '{}',

  max_open_workload integer check (max_open_workload is null or max_open_workload > 0),

  status            text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  version           integer not null default 1,
  published_at      timestamptz,

  created_by        uuid references auth.users(id) on delete set null,
  updated_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,

  constraint crm_routing_rules_kind_shape check (
       (kind = 'named_user'    and user_id is not null and cardinality(member_ids) = 0)
    or (kind = 'pool'          and user_id is null     and cardinality(member_ids) between 1 and 100)
    or (kind = 'company_owner' and user_id is null     and cardinality(member_ids) = 0)
  ),
  constraint crm_routing_rules_sources_present check (cardinality(sources) >= 1),
  constraint crm_routing_rules_never_manual check (
    not ('manual'::public.crm_record_source = any(sources))
  ),
  constraint crm_routing_rules_published_has_time check (
    status <> 'published' or published_at is not null
  )
);

create index if not exists crm_routing_rules_order_idx
  on public.crm_routing_rules (workspace_id, position, created_at)
  where status = 'published' and deleted_at is null;

drop trigger if exists crm_routing_rules_set_updated_at on public.crm_routing_rules;
create trigger crm_routing_rules_set_updated_at
  before update on public.crm_routing_rules
  for each row execute function public.set_updated_at();

create or replace function public.crm_routing_rules_bump_version()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- From OLD, so a writer that sets `version` itself is overridden.
  new.version := old.version + 1;
  return new;
end;
$$;

drop trigger if exists crm_routing_rules_bump_version on public.crm_routing_rules;
create trigger crm_routing_rules_bump_version
  before update on public.crm_routing_rules
  for each row execute function public.crm_routing_rules_bump_version();

-- ---------------------------------------------------------------------------
-- Decisions
-- ---------------------------------------------------------------------------
create table if not exists public.crm_routing_decisions (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  contact_id     uuid not null,

  /*
   * ⚠️ THE ONCE-PER-INTAKE GUARD IS THIS COLUMN'S UNIQUE CONSTRAINT, not a
   * check in a function. A retried import, a double-submitted form or a worker
   * that runs twice produces the same key and replays the first decision
   * instead of routing again.
   */
  intake_key     text not null check (length(intake_key) between 1 and 200),
  source         public.crm_record_source not null,

  outcome        text not null check (outcome in ('assigned', 'already_owned', 'unassigned')),
  reason         text not null check (length(reason) between 1 and 80),

  rule_id        uuid,
  rule_version   integer,
  rule_snapshot  jsonb,
  eligible_pool  uuid[] not null default '{}',
  evaluated      jsonb not null default '[]'::jsonb,
  chosen_owner   uuid,
  activity_id    uuid,

  created_at     timestamptz not null default now(),

  constraint crm_routing_decisions_contact_fk
    foreign key (contact_id, workspace_id)
    references public.crm_contacts (id, workspace_id)
    on delete cascade,
  constraint crm_routing_decisions_once_per_intake unique (workspace_id, intake_key),
  constraint crm_routing_decisions_owner_iff_assigned check (
    (outcome = 'assigned') = (chosen_owner is not null)
  ),
  constraint crm_routing_decisions_assigned_cites_rule check (
    outcome <> 'assigned' or (rule_id is not null and rule_version is not null and rule_snapshot is not null)
  ),
  constraint crm_routing_decisions_evaluated_is_array check (jsonb_typeof(evaluated) = 'array')
);

-- The Unassigned queue reads this: newest unrouted intake first.
create index if not exists crm_routing_decisions_queue_idx
  on public.crm_routing_decisions (workspace_id, outcome, created_at desc);

create index if not exists crm_routing_decisions_contact_idx
  on public.crm_routing_decisions (workspace_id, contact_id);

/*
 * ⚠️ APPEND-ONLY, with the same guard crm_activities uses. Erasure still
 * works: crm_erase_contact sets `outlio.erasure` for its transaction and the
 * decisions cascade from the contact row it deletes.
 */
drop trigger if exists crm_routing_decisions_append_only on public.crm_routing_decisions;
create trigger crm_routing_decisions_append_only
  before update or delete on public.crm_routing_decisions
  for each row execute function public.crm_guard_append_only();

-- ---------------------------------------------------------------------------
-- RLS and grants — the 0075 pattern
-- ---------------------------------------------------------------------------
alter table public.crm_routing_rules enable row level security;
drop policy if exists crm_routing_rules_select_member on public.crm_routing_rules;
create policy crm_routing_rules_select_member on public.crm_routing_rules
  for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_admin());

alter table public.crm_routing_decisions enable row level security;
drop policy if exists crm_routing_decisions_select_member on public.crm_routing_decisions;
create policy crm_routing_decisions_select_member on public.crm_routing_decisions
  for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_admin());

revoke all on table public.crm_routing_rules from public, anon, authenticated;
revoke all on table public.crm_routing_decisions from public, anon, authenticated;
grant select on table public.crm_routing_rules to authenticated;
grant select on table public.crm_routing_decisions to authenticated;

grant select, insert, update, delete on table public.crm_routing_rules to service_role;
-- Insert and select only, for the service role too: an accidental UPDATE fails
-- at the door rather than inside a transaction that has done other work.
grant select, insert on table public.crm_routing_decisions to service_role;

-- ---------------------------------------------------------------------------
-- crm_route_contact
-- ---------------------------------------------------------------------------
create or replace function public.crm_route_contact(
  p_workspace_id uuid,
  p_contact_id   uuid,
  p_intake_key   text,
  p_source       public.crm_record_source
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev_id        uuid;
  v_prev_outcome   text;
  v_prev_reason    text;
  v_prev_owner     uuid;
  v_prev_activity  uuid;

  v_owner          uuid;
  v_company        uuid;
  v_contact_gone   timestamptz;

  v_rule           record;
  v_company_owner  uuid;
  v_candidates     uuid[];
  v_eligible       uuid[];
  v_chosen         uuid;
  v_evaluated      jsonb[] := '{}';
  v_assign         jsonb;
  v_activity       uuid;
  v_decision       uuid;
begin
  if p_intake_key is null or length(btrim(p_intake_key)) = 0 then
    raise exception 'crm_route_contact: an intake key is required'
      using errcode = 'invalid_parameter_value';
  end if;

  /*
   * ⚠️ AN INVARIANT, NOT A RESULT. Member-added records belong to their
   * creator; a caller routing manual intake has a bug, and a quiet no-op
   * would hide it.
   */
  if p_source = 'manual' then
    raise exception 'crm_route_contact: manual intake is never routed'
      using errcode = 'invalid_parameter_value';
  end if;

  /*
   * The SAME lock key as crm_round_robin_assign (0125), so routing and a flow's
   * round-robin step in one workspace serialise against each other instead of
   * both counting stale load.
   */
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0));

  -- Once per intake: a second call with the same key replays the first answer.
  select d.id, d.outcome, d.reason, d.chosen_owner, d.activity_id
    into v_prev_id, v_prev_outcome, v_prev_reason, v_prev_owner, v_prev_activity
    from public.crm_routing_decisions d
   where d.workspace_id = p_workspace_id
     and d.intake_key = p_intake_key;

  if found then
    return jsonb_build_object(
      'decision_id', v_prev_id,
      'outcome', v_prev_outcome,
      'reason', v_prev_reason,
      'chosen_owner', v_prev_owner,
      'activity_id', v_prev_activity,
      'replayed', true
    );
  end if;

  select c.owner_user_id, c.primary_company_id, c.deleted_at
    into v_owner, v_company, v_contact_gone
    from public.crm_contacts c
   where c.id = p_contact_id
     and c.workspace_id = p_workspace_id
   for update;

  if not found then
    raise exception 'crm_route_contact: no such contact in workspace %', p_workspace_id
      using errcode = 'no_data_found';
  end if;

  -- An intake removed before routing ran (an undone import) is not routed.
  if v_contact_gone is not null then
    return jsonb_build_object('outcome', 'skipped', 'reason', 'contact_deleted', 'replayed', false);
  end if;

  /*
   * ⚠️ AN OWNED LEAD IS NEVER TAKEN. "A new enrichment field must not steal an
   * assigned lead" — and a row an import mapped to an owner, or a contact
   * someone claimed between intake and routing, is assigned.
   */
  if v_owner is not null then
    insert into public.crm_routing_decisions (
      workspace_id, contact_id, intake_key, source, outcome, reason
    ) values (
      p_workspace_id, p_contact_id, p_intake_key, p_source, 'already_owned', 'already_owned'
    )
    returning id into v_decision;

    return jsonb_build_object(
      'decision_id', v_decision, 'outcome', 'already_owned', 'reason', 'already_owned',
      'chosen_owner', null, 'activity_id', null, 'replayed', false
    );
  end if;

  for v_rule in
    select r.id, r.version, r.name, r.position, r.kind, r.sources,
           r.user_id, r.member_ids, r.max_open_workload
      from public.crm_routing_rules r
     where r.workspace_id = p_workspace_id
       and r.status = 'published'
       and r.deleted_at is null
       and p_source = any(r.sources)
     order by r.position, r.created_at, r.id
  loop
    v_candidates := '{}';

    if v_rule.kind = 'company_owner' then
      if v_company is null then
        v_evaluated := array_append(v_evaluated, jsonb_build_object(
          'rule_id', v_rule.id, 'rule_version', v_rule.version, 'kind', v_rule.kind,
          'reason', 'contact_has_no_company'));
        continue;
      end if;

      v_company_owner := null;
      select co.owner_user_id into v_company_owner
        from public.crm_companies co
       where co.id = v_company
         and co.workspace_id = p_workspace_id
         and co.deleted_at is null;

      if v_company_owner is null then
        v_evaluated := array_append(v_evaluated, jsonb_build_object(
          'rule_id', v_rule.id, 'rule_version', v_rule.version, 'kind', v_rule.kind,
          'reason', 'company_has_no_owner'));
        continue;
      end if;

      v_candidates := array[v_company_owner];
    elsif v_rule.kind = 'named_user' then
      v_candidates := array[v_rule.user_id];
    else
      v_candidates := v_rule.member_ids;
    end if;

    /*
     * ⚠️ ELIGIBILITY, IN THE ORDER THE RULE LISTS PEOPLE:
     *   • still a member of the workspace — someone who left is skipped, never
     *     handed a lead they cannot open
     *   • not away
     *   • under the rule's workload cap, if it has one
     */
    select coalesce(array_agg(cand.uid order by cand.ord), '{}')
      into v_eligible
      from unnest(v_candidates) with ordinality as cand(uid, ord)
      join public.workspace_memberships m
        on m.workspace_id = p_workspace_id
       and m.user_id = cand.uid
     where (m.away_until is null or m.away_until <= now())
       and (
         v_rule.max_open_workload is null
         or (select count(k.id)
               from public.crm_contacts k
              where k.workspace_id = p_workspace_id
                and k.owner_user_id = cand.uid
                and k.deleted_at is null) < v_rule.max_open_workload
       );

    if cardinality(v_eligible) = 0 then
      v_evaluated := array_append(v_evaluated, jsonb_build_object(
        'rule_id', v_rule.id, 'rule_version', v_rule.version, 'kind', v_rule.kind,
        'reason', 'no_eligible_owner', 'candidates', to_jsonb(v_candidates)));
      continue;
    end if;

    if v_rule.kind = 'pool' then
      -- Least loaded; ties break on the rule's own order. `left join`, so a
      -- member who owns nothing yet is counted as zero rather than dropped.
      select e.uid
        into v_chosen
        from unnest(v_eligible) with ordinality as e(uid, ord)
        left join public.crm_contacts owned
          on owned.workspace_id  = p_workspace_id
         and owned.owner_user_id = e.uid
         and owned.deleted_at is null
       group by e.uid, e.ord
       order by count(owned.id), e.ord
       limit 1;
    else
      v_chosen := v_eligible[1];
    end if;

    -- The audited write, inside THIS transaction and under the lock above.
    v_assign := public.crm_assign_contact_owner(p_workspace_id, p_contact_id, v_chosen, null);
    v_activity := (v_assign ->> 'activity_id')::uuid;

    insert into public.crm_routing_decisions (
      workspace_id, contact_id, intake_key, source, outcome, reason,
      rule_id, rule_version, rule_snapshot, eligible_pool, evaluated,
      chosen_owner, activity_id
    ) values (
      p_workspace_id, p_contact_id, p_intake_key, p_source, 'assigned', 'rule_matched',
      v_rule.id, v_rule.version,
      jsonb_build_object(
        'name', v_rule.name,
        'kind', v_rule.kind,
        'position', v_rule.position,
        'sources', to_jsonb(v_rule.sources),
        'user_id', v_rule.user_id,
        'member_ids', to_jsonb(v_rule.member_ids),
        'max_open_workload', v_rule.max_open_workload
      ),
      v_eligible, to_jsonb(v_evaluated),
      v_chosen, v_activity
    )
    returning id into v_decision;

    return jsonb_build_object(
      'decision_id', v_decision, 'outcome', 'assigned', 'reason', 'rule_matched',
      'rule_id', v_rule.id, 'chosen_owner', v_chosen, 'activity_id', v_activity,
      'replayed', false
    );
  end loop;

  /*
   * ⚠️ NOBODY ELIGIBLE STAYS UNASSIGNED, WITH ITS REASON. Never the workspace
   * owner by default: that is how one person silently inherits every lead the
   * rules could not place, and nobody learns the rules are wrong.
   */
  insert into public.crm_routing_decisions (
    workspace_id, contact_id, intake_key, source, outcome, reason, evaluated
  ) values (
    p_workspace_id, p_contact_id, p_intake_key, p_source, 'unassigned',
    case when cardinality(v_evaluated) = 0 then 'no_rule_matched' else 'no_eligible_owner' end,
    to_jsonb(v_evaluated)
  )
  returning id into v_decision;

  return jsonb_build_object(
    'decision_id', v_decision, 'outcome', 'unassigned',
    'reason', case when cardinality(v_evaluated) = 0 then 'no_rule_matched' else 'no_eligible_owner' end,
    'chosen_owner', null, 'activity_id', null, 'replayed', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- crm_route_batch
-- ---------------------------------------------------------------------------
create or replace function public.crm_route_batch(
  p_workspace_id uuid,
  p_batch_id     uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row         record;
  v_result      jsonb;
  v_assigned    integer := 0;
  v_unassigned  integer := 0;
  v_owned       integer := 0;
  v_items       jsonb[] := '{}';
begin
  if not exists (
    select 1 from public.crm_lead_batches b
     where b.id = p_batch_id and b.workspace_id = p_workspace_id
  ) then
    raise exception 'crm_route_batch: no such batch in workspace %', p_workspace_id
      using errcode = 'no_data_found';
  end if;

  /*
   * ⚠️ ONLY CONTACTS THIS BATCH CREATED. A matched member is somebody the
   * workspace already had; routing them would re-assign a relationship that
   * may have been worked for months. `created_contact` is recorded by
   * crm_ingest_contacts at the moment of ingest, so it cannot drift.
   */
  for v_row in
    select bm.contact_id, c.source
      from public.crm_batch_members bm
      join public.crm_contacts c
        on c.id = bm.contact_id
       and c.workspace_id = bm.workspace_id
     where bm.workspace_id = p_workspace_id
       and bm.batch_id = p_batch_id
       and bm.created_contact
       and c.deleted_at is null
       and c.source <> 'manual'
     order by bm.created_at, bm.contact_id
  loop
    v_result := public.crm_route_contact(
      p_workspace_id,
      v_row.contact_id,
      format('batch:%s:%s', p_batch_id, v_row.contact_id),
      v_row.source
    );

    if v_result ->> 'outcome' = 'assigned' then
      v_assigned := v_assigned + 1;
      /*
       * Only NEW assignments are listed, so a replayed batch does not announce
       * the same handovers twice — the caller emits one event per entry.
       */
      if not coalesce((v_result ->> 'replayed')::boolean, false) then
        v_items := array_append(v_items, jsonb_build_object(
          'contact_id', v_row.contact_id,
          'owner', v_result ->> 'chosen_owner',
          'activity_id', v_result ->> 'activity_id'
        ));
      end if;
    elsif v_result ->> 'outcome' = 'unassigned' then
      v_unassigned := v_unassigned + 1;
    elsif v_result ->> 'outcome' = 'already_owned' then
      v_owned := v_owned + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'assigned', v_assigned,
    'unassigned', v_unassigned,
    'already_owned', v_owned,
    'assignments', to_jsonb(v_items)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- crm_round_robin_assign — now skips an owned contact, inside the lock
-- ---------------------------------------------------------------------------
create or replace function public.crm_round_robin_assign(
  p_workspace_id uuid,
  p_contact_id   uuid,
  p_user_ids     uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_chosen   uuid;
  v_result   jsonb;
  v_owner    uuid;
begin
  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    raise exception 'crm_round_robin_assign: empty candidate pool'
      using errcode = 'invalid_parameter_value';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0));

  select c.owner_user_id
    into v_owner
    from public.crm_contacts c
   where c.id = p_contact_id
     and c.workspace_id = p_workspace_id
   for update;

  if not found then
    raise exception 'crm_round_robin_assign: no such contact in workspace %', p_workspace_id
      using errcode = 'no_data_found';
  end if;

  /*
   * ⚠️ AN OWNED CONTACT IS SKIPPED — owner decision, 2026-09-14. The shipped
   * "New lead assignment" template fires on contact_created, which only the
   * manual path emits, so this step was taking contacts away from the members
   * who added them. Checked here, under the lock, so a contact claimed a moment
   * earlier is not reassigned by a step that read it as free.
   */
  if v_owner is not null then
    return jsonb_build_object(
      'changed', false,
      'skipped', true,
      'reason', 'already_owned',
      'activity_id', null,
      'from', v_owner
    );
  end if;

  select pool.user_id
    into v_chosen
    from unnest(p_user_ids) with ordinality as pool(user_id, ord)
    left join public.crm_contacts owned
      on owned.workspace_id  = p_workspace_id
     and owned.owner_user_id = pool.user_id
     and owned.deleted_at is null
   group by pool.user_id, pool.ord
   order by count(owned.id), pool.ord
   limit 1;

  if v_chosen is null then
    raise exception 'crm_round_robin_assign: no candidate could be chosen'
      using errcode = 'no_data_found';
  end if;

  v_result := public.crm_assign_contact_owner(p_workspace_id, p_contact_id, v_chosen, null);

  return jsonb_set(v_result, '{assigned_to}', to_jsonb(v_chosen));
end;
$$;

comment on function public.crm_route_contact(uuid, uuid, text, public.crm_record_source) is
  'Routes one unassigned system-intake contact by the first published rule with an eligible owner, once per intake key. Records every decision.';
comment on function public.crm_route_batch(uuid, uuid) is
  'Routes the contacts a batch created. Returns counts and the new assignments to announce.';
comment on function public.crm_round_robin_assign(uuid, uuid, uuid[]) is
  'Least-loaded assignment under a workspace advisory lock. Skips a contact that already has an owner.';

/*
 * ⚠️ SERVICE ROLE ONLY. security definer, trusting its arguments: the server
 * actions gate on crm.import before any batch is routed.
 */
revoke all on function public.crm_route_contact(uuid, uuid, text, public.crm_record_source) from public;
revoke all on function public.crm_route_contact(uuid, uuid, text, public.crm_record_source) from anon;
revoke all on function public.crm_route_contact(uuid, uuid, text, public.crm_record_source) from authenticated;
grant execute on function public.crm_route_contact(uuid, uuid, text, public.crm_record_source) to service_role;

revoke all on function public.crm_route_batch(uuid, uuid) from public;
revoke all on function public.crm_route_batch(uuid, uuid) from anon;
revoke all on function public.crm_route_batch(uuid, uuid) from authenticated;
grant execute on function public.crm_route_batch(uuid, uuid) to service_role;

revoke all on function public.crm_round_robin_assign(uuid, uuid, uuid[]) from public;
revoke all on function public.crm_round_robin_assign(uuid, uuid, uuid[]) from anon;
revoke all on function public.crm_round_robin_assign(uuid, uuid, uuid[]) from authenticated;
grant execute on function public.crm_round_robin_assign(uuid, uuid, uuid[]) to service_role;
