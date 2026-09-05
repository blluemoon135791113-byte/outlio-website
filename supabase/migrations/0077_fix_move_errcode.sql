-- 0077 — stop the optimistic-lock rejection from hanging the client
--
-- 0076 raised `serialization_failure` (SQLSTATE 40001) when a caller passed a
-- stale version. That code has protocol meaning: PostgREST reads 40001 as a
-- transient conflict and RETRIES the request.
--
-- An optimistic-lock rejection is the opposite of transient. The caller is
-- holding a card that has since moved; retrying will fail identically every
-- time. So the symptom was not an error reaching the client — it was a HANG,
-- until the request timed out. The three neighbouring refusals (same stage,
-- wrong pipeline, lost-without-reason) all used `check_violation` and returned
-- instantly, which is what isolated it.
--
-- Nothing else in the function changes.
--
-- ⚠️ Do not "upgrade" this back to 40001 because it reads better. Reserve
-- 40001 for genuine serialization conflicts that a retry could actually
-- resolve.

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
  --
  -- ⚠️ errcode IS 'check_violation', NOT 'serialization_failure', AND THAT IS
  -- LOAD-BEARING.
  --
  -- SQLSTATE 40001 has protocol meaning: PostgREST treats it as a transient
  -- conflict and RETRIES the request. An optimistic-lock rejection is not
  -- transient — the caller is holding a stale card and retrying will fail
  -- identically, forever. 0076 used 40001 and the symptom was not an error
  -- but a HANG: every stale-version call sat until the client timed out,
  -- while the three refusals below returned instantly.
  if v_opp.version <> p_expected_version then
    raise exception
      'crm_move_opportunity_stage: opportunity % changed since you loaded it (expected version %, found %)',
      p_opportunity_id, p_expected_version, v_opp.version
      using errcode = 'check_violation';
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
