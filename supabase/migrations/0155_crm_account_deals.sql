-- ---------------------------------------------------------------------------
-- 0155 — Deals for accounts: "Move to pipeline" from the Accounts list
--
-- A deal could always belong to a company with no person on it
-- (crm_opportunities.contact_id and company_id are both nullable, 0076); the
-- product just never offered it. This adds the BULK path: one deal per ticked
-- account, in one pipeline stage.
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  AN ACCOUNT THAT ALREADY HAS AN OPEN DEAL IN THAT PIPELINE IS SKIPPED,   ║
-- ║  NEVER DUPLICATED — AND THAT CHECK IS MADE UNDER THE ACCOUNT'S ROW LOCK. ║
-- ║                                                                           ║
-- ║  Checking from the app and then inserting were two statements: two       ║
-- ║  people moving the same accounts at once would each see "no open deal"   ║
-- ║  and both insert. Here each account row is locked (in id order, so two   ║
-- ║  overlapping runs cannot deadlock) before its check and insert.          ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- WHAT A BULK DEAL IS, EXACTLY: named after the account (its name, else its
-- domain; an account with neither is skipped — a deal is never given an
-- invented name), no value (unknown is NULL, not zero), the workspace's
-- currency (so 0130's trigger records the identity rate), the stage's default
-- probability, owned by whoever moved it. Every one of those is a fact already
-- in the database or a choice the person made.
--
-- Only OPEN stages: a deal does not start life won or lost (0076's
-- closed_consistent check would refuse a won deal with no closed_at anyway).
--
-- ⚠️ VALIDATE BEFORE APPLYING:
--   scripts/check-migration.sh supabase/migrations/0155_crm_account_deals.sql \
--     supabase/migrations/smoke/0155_crm_account_deals.smoke.sql
--
-- APPLY BEFORE DEPLOYING the code that calls it. Nothing deployed calls it.
--
-- ROLLBACK (no table is modified):
--   drop function if exists public.crm_create_account_deals(uuid, uuid, uuid[], uuid, uuid);
-- ---------------------------------------------------------------------------

create or replace function public.crm_create_account_deals(
  p_workspace_id  uuid,
  p_stage_id      uuid,
  p_company_ids   uuid[],
  p_owner_user_id uuid,
  p_actor_id      uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pipeline_id uuid;
  v_kind        public.crm_stage_kind;
  v_probability integer;
  v_currency    char(3);
  v_company     record;
  v_title       text;
  v_deal        uuid;
  v_seen        uuid[] := '{}';
  v_created     jsonb := '[]'::jsonb;
  v_skipped     jsonb := '[]'::jsonb;
  v_unnamed     jsonb := '[]'::jsonb;
begin
  if p_company_ids is null or cardinality(p_company_ids) = 0 then
    raise exception 'crm_create_account_deals: no accounts given' using errcode = 'check_violation';
  end if;
  if cardinality(p_company_ids) > 100 then
    raise exception 'crm_create_account_deals: at most 100 accounts at once' using errcode = 'check_violation';
  end if;

  select s.pipeline_id, s.kind, s.default_probability
    into v_pipeline_id, v_kind, v_probability
    from public.crm_pipeline_stages s
    join public.crm_pipelines p on p.id = s.pipeline_id and p.workspace_id = s.workspace_id
   where s.id = p_stage_id
     and s.workspace_id = p_workspace_id
     and s.archived_at is null
     and p.archived_at is null;
  if v_pipeline_id is null then
    raise exception 'crm_create_account_deals: no such stage in workspace %', p_workspace_id
      using errcode = 'check_violation';
  end if;
  if v_kind <> 'open' then
    raise exception 'crm_create_account_deals: a new deal starts in an open stage'
      using errcode = 'check_violation';
  end if;

  select w.default_currency into v_currency from public.workspaces w where w.id = p_workspace_id;

  for v_company in
    select c.id, c.name, c.domain
      from public.crm_companies c
     where c.workspace_id = p_workspace_id
       and c.deleted_at is null
       and c.id = any (p_company_ids)
     order by c.id
       for update
  loop
    v_seen := v_seen || v_company.id;

    if exists (
      select 1 from public.crm_opportunities o
       where o.workspace_id = p_workspace_id
         and o.company_id = v_company.id
         and o.pipeline_id = v_pipeline_id
         and o.status = 'open'
         and o.deleted_at is null
    ) then
      v_skipped := v_skipped || to_jsonb(v_company.id);
      continue;
    end if;

    v_title := left(coalesce(nullif(btrim(v_company.name), ''), nullif(btrim(v_company.domain), '')), 200);
    if v_title is null then
      v_unnamed := v_unnamed || to_jsonb(v_company.id);
      continue;
    end if;

    insert into public.crm_opportunities (
      workspace_id, title, company_id, owner_user_id, pipeline_id, stage_id,
      value_amount, currency, probability, created_by
    ) values (
      p_workspace_id, v_title, v_company.id, p_owner_user_id, v_pipeline_id, p_stage_id,
      null, coalesce(v_currency, 'USD'), v_probability, p_actor_id
    )
    returning id into v_deal;

    v_created := v_created || jsonb_build_object('company_id', v_company.id, 'opportunity_id', v_deal);
  end loop;

  return jsonb_build_object(
    'pipeline_id', v_pipeline_id,
    'created', v_created,
    'skipped_open', v_skipped,
    'skipped_unnamed', v_unnamed,
    -- Not in this workspace, deleted, or never an account: named so the
    -- caller can count them, never so it can tell which existed.
    'missing', (select count(*) from unnest(p_company_ids) x where not x = any (v_seen))
  );
end;
$$;

revoke all on function public.crm_create_account_deals(uuid, uuid, uuid[], uuid, uuid) from public, anon, authenticated;
grant execute on function public.crm_create_account_deals(uuid, uuid, uuid[], uuid, uuid) to service_role;
